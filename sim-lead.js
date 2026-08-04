// =============================================================
//  SIMULAÇÃO — roda uma conversa de qualificação COMPLETA no mesmo
//  cérebro do bot (prompts + flow), sequencialmente, e imprime o
//  resumo que iria para a equipe. Sem WhatsApp/ChatClean.
//
//  Rodar:  node sim-lead.js   (ou: npm run sim)
//  Precisa de OPENAI_API_KEY no .env.
// =============================================================

require('dotenv').config();
const OpenAI = require('openai');
const { SYSTEM_SDR, promptExtracao, promptResposta } = require('./prompts');
const { SEGMENTOS, DEPARTAMENTOS } = require('./data');
const { determinarProximoCampo, aplicarCampos, detectarSegmento, escolhaDeSlot } = require('./flow');
const { estaEmExpediente } = require('./horario');
const cal = require('./calendar');

const createdEvents = []; // eventos de teste criados (apagados no fim)

// Força um horário para testar o modo plantão: SIM_DATA="2026-07-25T21:00:00-03:00"
const exp = process.env.SIM_DATA ? estaEmExpediente(new Date(process.env.SIM_DATA)) : estaEmExpediente();

if (!process.env.OPENAI_API_KEY) { console.error('❌ Defina OPENAI_API_KEY no .env'); process.exit(1); }
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const chatId = '5584999990000';
const leadData = { conversationHistory: [] };
let tokensEntrada = 0, tokensSaida = 0;

// Roteiro do "cliente" (lead de energia solar). Inclui uma pergunta de preço no meio.
const ROTEIRO = [
    'oi',
    'quero melhorar minhas vendas',
    'sou o Rafael',
    'é da Liv Energia Solar',
    'a gente instala painel solar pra residência e empresa',
    'vocês têm API oficial do WhatsApp?',                             // <- pergunta: deve RESPONDER
    'e no Instagram funciona igual? consigo responder comentário automático?', // <- pergunta
    'e quanto custa a ChatClean?',                                    // <- preço: não pode revelar
    'tô aqui em Natal-RN',
    'atendo pelo WhatsApp e Instagram',
    'chega uns 400 lead por mês',
    'meu problema é que demoro pra responder e perco lead à noite',
    'quero resolver isso agora',
    'sou eu que decido, sou o dono',
    'pode ser o primeiro horário mesmo'   // <- escolha do horário (quando o bot oferecer)
];

async function extrair(mensagem, campoAtual, hist) {
    const prompt = promptExtracao({ mensagemSanitizada: mensagem.substring(0, 1000), campoAtual });
    const c = await openai.chat.completions.create({
        model: 'gpt-4o-mini', temperature: 0,
        messages: [...hist, { role: 'user', content: prompt }]
    });
    tokensEntrada += c.usage.prompt_tokens; tokensSaida += c.usage.completion_tokens;
    let res = c.choices[0].message.content.trim();
    if (res.includes('```')) res = res.replace(/```json?/g, '').replace(/```/g, '').trim();
    try { return JSON.parse(res); } catch { return null; }
}

async function responder(mensagem, proximoCampo, hist) {
    const isInicioConversa = leadData.conversationHistory.length === 0;
    const prompt = promptResposta({ isInicioConversa, mensagemSanitizada: mensagem.substring(0, 1000), proximoCampo, leadData, expediente: exp });
    const c = await openai.chat.completions.create({
        model: 'gpt-4o-mini', temperature: 0.7,
        messages: [{ role: 'system', content: SYSTEM_SDR }, ...hist, { role: 'user', content: prompt }]
    });
    tokensEntrada += c.usage.prompt_tokens; tokensSaida += c.usage.completion_tokens;
    return c.choices[0].message.content.trim();
}

function resumoEquipe() {
    const segNome = leadData.segmentoKey && SEGMENTOS[leadData.segmentoKey] ? SEGMENTOS[leadData.segmentoKey].nome : (leadData.segmento || 'Não informado');
    return [
        '🎯 LEAD QUALIFICADO — SDR ChatClean',
        '',
        `Contato: ${leadData.nome || 'Lead'} (${chatId})`,
        `Empresa: ${leadData.empresa || 'Não informado'}`,
        `Segmento: ${segNome}`,
        `Cidade/UF: ${leadData.cidadeEstado || 'Não informado'}`,
        `Objetivo: ${leadData.objetivo || 'Não informado'}`,
        `Canais hoje: ${leadData.canais || 'Não informado'}`,
        `Volume: ${leadData.volume || 'Não informado'}`,
        `Dor principal: ${leadData.dor || 'Não informado'}`,
        `Urgência: ${leadData.urgencia || 'Não informado'}`,
        `Decisor: ${leadData.decisor || 'Não informado'}`,
        leadData.reuniaoAgendada ? `📅 Reunião agendada: ${leadData.reuniaoAgendada.label}` : null,
        leadData.horarioPreferido ? `Horário preferido p/ reunião: ${leadData.horarioPreferido}` : null,
        (!exp.aberto && !leadData.reuniaoAgendada) ? `Retorno sugerido: ${exp.proximoExpediente}` : null,
        '',
        `➡️ Transferir para o departamento ${DEPARTAMENTOS.comercial}${leadData.reuniaoAgendada ? ' [REUNIÃO AGENDADA]' : (exp.aberto ? '' : ' [FORA DE EXPEDIENTE — AGENDAR RETORNO]')}`
    ].filter(l => l !== null).join('\n');
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
        if (extraido.horarioPreferido && !leadData.horarioPreferido) leadData.horarioPreferido = extraido.horarioPreferido;
        if (!leadData.segmentoKey) leadData.segmentoKey = detectarSegmento((extraido.segmento || '') + ' ' + texto);
    }
    const proximoDepois = determinarProximoCampo(leadData);
    // Sub-fluxo de agendamento (mesma lógica do index.js → tratarAgendamento)
    const agend = await agendarSubfluxo(texto, extraido);
    const resposta = agend || await responder(texto, proximoDepois, hist);
    leadData.conversationHistory.push({ role: 'user', content: texto });
    leadData.conversationHistory.push({ role: 'assistant', content: resposta });
    return resposta;
}

// Espelha o tratarAgendamento do index.js, mas cria eventos [TESTE] e os apaga no fim.
async function agendarSubfluxo(texto, extraido) {
    if (!cal.configurado()) return null;
    if (leadData.aguardandoEscolhaSlot) {
        const slots = leadData.slotsOferecidos || [];
        const escolha = escolhaDeSlot(texto, extraido, slots.length);
        if (escolha && slots[escolha - 1]) {
            const s = slots[escolha - 1];
            const ev = await cal.agendarReuniao({
                start: s.start, end: s.end, calendarId: s.calendarId,
                titulo: `[TESTE] Reunião ChatClean — ${leadData.nome || 'Lead'}`, descricao: 'Simulação — evento de teste (será apagado).'
            });
            createdEvents.push({ eventId: ev.id, calendarId: s.calendarId });
            leadData.reuniaoAgendada = { label: ev.label };
            leadData.aguardandoEscolhaSlot = false; leadData.slotsOferecidos = null; leadData.finalizado = true;
            return `Prontinho! Deixei sua reunião marcada para ${ev.label} com um especialista da ChatClean 😊`;
        }
        if (extraido?.recusouReuniao) { leadData.aguardandoEscolhaSlot = false; leadData.slotsOferecidos = null; }
        return null;
    }
    const deveAgendar = leadData.qualificacaoCompleta || extraido?.querAgendar;
    if (deveAgendar && !leadData.reuniaoAgendada) {
        const slots = await cal.horariosLivres({ dias: 5, max: 3 });
        if (!slots.length) return null;
        leadData.slotsOferecidos = slots.map(s => ({ start: s.start, end: s.end, calendarId: s.calendarId, label: s.label }));
        leadData.aguardandoEscolhaSlot = true;
        const lista = slots.map((s, i) => `${i + 1}) ${s.label}`).join('\n');
        const intro = exp.aberto
            ? 'Posso já deixar uma reunião marcada com um especialista. Tenho estes horários:'
            : `Nosso time retorna ${exp.proximoExpediente}. Posso já deixar uma reunião marcada com um especialista. Tenho estes horários:`;
        return `${intro}\n${lista}\nQual fica melhor pra você? (é só me dizer o número)`;
    }
    return null;
}

(async () => {
    console.log('\n════════ SIMULAÇÃO — Qualificação de lead (energia solar) ════════');
    console.log(exp.aberto
        ? '   Modo: EXPEDIENTE (seg–sex 9h–18h) — transfere ao vivo\n'
        : `   Modo: PLANTÃO (${exp.motivo}) — secretária agenda retorno para ${exp.proximoExpediente}\n`);
    for (const msg of ROTEIRO) {
        console.log('CLIENTE > ' + msg);
        const resp = await turno(msg);
        console.log('BOT     > ' + resp + '\n');
        // Finaliza quando qualificou E não está esperando o cliente escolher um horário
        if (leadData.qualificacaoCompleta && !leadData.aguardandoEscolhaSlot && !leadData.finalizado) {
            leadData.finalizado = true;
        }
        if (leadData.finalizado) {
            console.log('──────── ✅ FINALIZADO — resumo enviado à equipe ────────\n');
            console.log(resumoEquipe());
            console.log('\n(no CRM: nota interna no ticket + WhatsApp p/ EQUIPE_NUMERO)\n');
            break;
        }
    }
    // Limpeza: apaga os eventos de teste criados na simulação
    for (const e of createdEvents) {
        try { await cal.cancelarReuniao(e); console.log(`🗑️  evento de teste apagado (${e.eventId})`); } catch (_) {}
    }
    const custo = (tokensEntrada * 0.15 / 1e6) + (tokensSaida * 0.60 / 1e6);
    console.log('──────── custo desta conversa ────────');
    console.log(`tokens: ${tokensEntrada} entrada + ${tokensSaida} saída | ~US$ ${custo.toFixed(4)}`);
})().catch(e => console.error('ERR', e.message));
