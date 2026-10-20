// =============================================================
//  EVAL — mede a qualidade das respostas do SDR contra os roteiros.
//
//  Rodar:  npm run eval
//          MODELO_EVAL=gpt-4o npm run eval        (compara outro modelo)
//          npm run eval -- solar-completo         (um roteiro só)
//
//  ATENÇÃO: gasta crédito real da OpenAI. Cada turno faz 2 chamadas
//  (extração + resposta). O total de turnos aparece no relatório.
// =============================================================

require('dotenv').config();
const OpenAI = require('openai');
const prompts = require('./prompts');
const flow = require('./flow');
const { ROTEIROS, porId } = require('./src/eval/roteiros');
const { criarExecutor, resumir } = require('./src/eval/executar');
const { criarCompletar } = require('./src/infrastructure/openai/completar');

if (!process.env.OPENAI_API_KEY) {
    console.error('Defina OPENAI_API_KEY no .env antes de rodar o eval.');
    process.exit(1);
}

const MODELO = process.env.MODELO_EVAL || 'gpt-4o-mini';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const { completar } = criarCompletar({ cliente: openai });
// Mesmo esforco por tarefa da producao. Sem prazo de proposito: o eval mede
// quanto o esforco escolhido demora de fato.
const ESFORCO = {
    resposta: process.env.MODELO_ESFORCO_RESPOSTA || '',
    extracao: process.env.MODELO_ESFORCO_APOIO || 'low',
};

let chamadas = 0;

// Porta do LLM: o executor não sabe que existe OpenAI.
// Latencia por tarefa: a API e sincrona e o lead espera, entao tempo e
// criterio de escolha de modelo tanto quanto as violacoes.
const latencias = {};
function resumoDeLatencia(ms) {
    const ord = [...ms].sort((a, b) => a - b);
    const p = (q) => ord[Math.min(ord.length - 1, Math.floor(q * ord.length))];
    const s = (v) => (v / 1000).toFixed(1) + 's';
    return `mediana ${s(p(0.5))}, p90 ${s(p(0.9))}, max ${s(ord.at(-1))} (${ms.length} chamadas)`;
}

async function conversar({ system, mensagens, prompt, temperatura, tarefa }) {
    chamadas++;
    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push(...mensagens);
    messages.push({ role: 'user', content: prompt });
    // Mesmo adaptador da producao: modelos de raciocinio perdem a temperatura e
    // recebem o mesmo esforco, entao o eval mede o que o lead vai receber.
    const inicio = Date.now();
    const c = await completar({ model: MODELO, messages, temperature: temperatura, reasoning_effort: ESFORCO[tarefa] || '' });
    (latencias[tarefa] = latencias[tarefa] || []).push(Date.now() - inicio);
    return c.choices[0].message.content.trim();
}

function alvo() {
    const arg = process.argv[2];
    if (!arg) return ROTEIROS;
    const r = porId(arg);
    if (!r) {
        console.error(`Roteiro "${arg}" não existe. Disponíveis: ${ROTEIROS.map((x) => x.id).join(', ')}`);
        process.exit(1);
    }
    return [r];
}

async function main() {
    const roteiros = alvo();
    // Expediente fixo: sem isso o relatório muda conforme a hora em que roda.
    const executor = criarExecutor({
        conversar,
        prompts,
        flow,
        expediente: { aberto: true, proximoExpediente: 'amanhã de manhã' }
    });

    console.log(`\nModelo: ${MODELO} | esforco resposta: ${ESFORCO.resposta || 'padrao'}, extracao: ${ESFORCO.extracao}`);
    console.log(`Roteiros: ${roteiros.map((r) => r.id).join(', ')}\n`);

    const execucoes = [];
    for (const roteiro of roteiros) {
        process.stdout.write(`  ${roteiro.id} ... `);
        const exec = await executor.rodarRoteiro(roteiro);
        execucoes.push(exec);
        const ruins = exec.turnos.filter((t) => t.violacoes.length).length;
        console.log(`${exec.turnos.length} turnos, ${ruins} com violação`);
    }

    const r = resumir(execucoes);

    console.log(`\n--- PLACAR (${MODELO}) ---`);
    console.log(`Turnos limpos: ${r.turnosLimpos}/${r.turnos} (${r.percentualLimpo}%)`);
    console.log(`Violações: ${r.porGravidade.critica} críticas, ${r.porGravidade.alta} altas, ${r.porGravidade.media} médias`);
    for (const [tarefa, ms] of Object.entries(latencias)) console.log(`Latencia ${tarefa}: ${resumoDeLatencia(ms)}`);
    if (r.extracoesFalhas) console.log(`Extrações que não voltaram JSON: ${r.extracoesFalhas}`);
    // Sinal nao e violacao: o prompt permite terminar so com a informacao.
    console.log(`Sinais (nao contam como violacao): ${r.sinais} turnos sem pergunta no final`);

    if (r.porRegra.length) {
        console.log('\nPor regra:');
        for (const { id, n } of r.porRegra) console.log(`  ${String(n).padStart(3)}  ${id}`);
    }

    console.log('\n--- VIOLAÇÕES CRÍTICAS E ALTAS ---');
    let mostradas = 0;
    for (const exec of execucoes) {
        for (const t of exec.turnos) {
            const graves = t.violacoes.filter((v) => v.gravidade !== 'media');
            if (!graves.length) continue;
            mostradas++;
            console.log(`\n[${exec.roteiro}] lead: "${t.fala}"`);
            console.log(`  bot: "${t.resposta.replace(/\n/g, ' | ')}"`);
            for (const v of graves) console.log(`  -> ${v.id}${v.detalhe ? ': ' + v.detalhe : ''}`);
        }
    }
    if (!mostradas) console.log('nenhuma.');

    console.log(`\nChamadas à OpenAI: ${chamadas}\n`);
}

main().catch((e) => {
    console.error('Eval falhou:', e.message);
    process.exit(1);
});
