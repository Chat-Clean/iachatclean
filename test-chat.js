// =============================================================
//  TESTER LOCAL — conversa com o SDR no terminal, SEM WhatsApp e
//  SEM ChatClean. Usa o MESMO cérebro (prompts + flow + OpenAI).
//
//  Precisa só de OPENAI_API_KEY no .env.
//  Rodar:  npm run chat   (ou: node test-chat.js)
//  Comandos: /reset  reinicia a conversa | /estado  mostra o lead |
//            /sair   encerra
// =============================================================

require('dotenv').config();
const readline = require('readline');
const OpenAI = require('openai');
const { SYSTEM_SDR, promptExtracao, promptResposta } = require('./prompts');
const { SEGMENTOS, DEPARTAMENTOS } = require('./data');
const { determinarProximoCampo, aplicarCampos, detectarSegmento } = require('./flow');

if (!process.env.OPENAI_API_KEY) {
    console.error('❌ Defina OPENAI_API_KEY no .env antes de rodar o tester.');
    process.exit(1);
}
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

let leadData = novoLead();
function novoLead() { return { conversationHistory: [] }; }

async function extrair(mensagem, campoAtual, hist) {
    try {
        const prompt = promptExtracao({ mensagemSanitizada: mensagem.replace(/[<>]/g, '').substring(0, 1000), campoAtual });
        const c = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [...hist, { role: 'user', content: prompt }],
            temperature: 0
        });
        let res = c.choices[0].message.content.trim();
        if (res.includes('```')) res = res.replace(/```json?/g, '').replace(/```/g, '').trim();
        return JSON.parse(res);
    } catch (e) { console.error('  (extração falhou:', e.message + ')'); return null; }
}

async function responder(mensagem, proximoCampo, hist) {
    const isInicioConversa = leadData.conversationHistory.length === 0;
    const prompt = promptResposta({ isInicioConversa, mensagemSanitizada: mensagem.replace(/[<>]/g, '').substring(0, 1000), proximoCampo, leadData });
    const c = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'system', content: SYSTEM_SDR }, ...hist, { role: 'user', content: prompt }],
        temperature: 0.7
    });
    return c.choices[0].message.content.trim();
}

async function turno(texto) {
    const proximoAntes = determinarProximoCampo(leadData);
    const hist = leadData.conversationHistory.slice(-10).map(h => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content }));

    const extraido = await extrair(texto, proximoAntes?.campo, hist.slice(-4));
    leadData.objecaoAtiva = null;
    leadData.perguntouAgora = null;
    if (extraido) {
        aplicarCampos(leadData, extraido);
        if (extraido.objecao) leadData.objecaoAtiva = extraido.objecao;
        if (extraido.perguntou) leadData.perguntouAgora = true;
        if (extraido.tipoContato) leadData.tipoContato = extraido.tipoContato;
        if (!leadData.segmentoKey) leadData.segmentoKey = detectarSegmento((extraido.segmento || '') + ' ' + texto);
    }

    const proximoDepois = determinarProximoCampo(leadData);
    const resposta = await responder(texto, proximoDepois, hist);

    leadData.conversationHistory.push({ role: 'user', content: texto });
    leadData.conversationHistory.push({ role: 'assistant', content: resposta });

    // Sinaliza (só no terminal) quando qualificaria/transferiria
    let tag = '';
    if (extraido?.querFalarComHumano) tag = `\n  ➡️  [pediu humano → Transferir para ${DEPARTAMENTOS.comercial}]`;
    else if (extraido?.tipoContato === 'cliente') tag = `\n  ➡️  [cliente atual → Transferir para ${DEPARTAMENTOS.suporte}]`;
    else if (leadData.qualificacaoCompleta && !leadData.finalizado) { tag = `\n  ✅ [qualificação completa → Transferir para ${DEPARTAMENTOS.comercial}]`; leadData.finalizado = true; }

    return resposta + tag;
}

function mostrarEstado() {
    const seg = leadData.segmentoKey && SEGMENTOS[leadData.segmentoKey] ? SEGMENTOS[leadData.segmentoKey].nome : leadData.segmento;
    console.log('\n  📋 Estado do lead:');
    for (const k of ['objetivo', 'nome', 'empresa', 'cidadeEstado', 'canais', 'volume', 'dor', 'urgencia', 'decisor']) {
        if (leadData[k]) console.log(`     ${k}: ${leadData[k]}`);
    }
    if (seg) console.log(`     segmento: ${seg}`);
    console.log(`     qualificado: ${!!leadData.qualificacaoCompleta} | finalizado: ${!!leadData.finalizado}\n`);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
console.log('\n💬 SDR Virtual ChatClean — tester local (gpt-4o-mini)');
console.log('   Digite como se fosse o cliente. Comandos: /reset  /estado  /sair\n');
rl.setPrompt('você > ');
rl.prompt();

rl.on('line', async (linha) => {
    const texto = linha.trim();
    if (!texto) { rl.prompt(); return; }
    if (texto === '/sair') { rl.close(); return; }
    if (texto === '/reset') { leadData = novoLead(); console.log('  🔄 conversa reiniciada\n'); rl.prompt(); return; }
    if (texto === '/estado') { mostrarEstado(); rl.prompt(); return; }

    try {
        process.stdout.write('  ...\r');
        const resp = await turno(texto);
        console.log('bot  > ' + resp + '\n');
    } catch (e) {
        console.error('❌ erro:', e.message, '\n');
    }
    rl.prompt();
});

rl.on('close', () => { console.log('\n👋 encerrado.'); process.exit(0); });
