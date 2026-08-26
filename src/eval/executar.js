// =============================================================
//  EXECUTOR DE AVALIAÇÃO
//
//  Roda um roteiro pelo MESMO cérebro do bot (prompts.js + flow.js) e passa cada
//  resposta pelos analisadores determinísticos. O resultado é um número, não uma
//  impressão: dá para comparar modelos e versões de prompt lado a lado.
//
//  O cliente de LLM entra por PARÂMETRO (porta). Assim o executor é testável com
//  um fake, sem rede e sem crédito — é o que `test/unidade/executar-eval.test.js`
//  faz. Só o CLI (eval.js) monta o cliente real.
// =============================================================

const { analisar, extrairPergunta } = require('../domain/qualidade/analisadores');

/**
 * @param {object} deps
 * @param {(args: {system: string, mensagens: Array, prompt: string, temperatura: number}) => Promise<string>} deps.conversar
 *        Porta do LLM: recebe o pedido e devolve o texto da resposta.
 * @param {object} deps.prompts  { SYSTEM_SDR, promptExtracao, promptResposta }
 * @param {object} deps.flow     { determinarProximoCampo, aplicarCampos, detectarSegmento }
 * @param {object} [deps.expediente] Expediente fixo, para o resultado não variar com a hora do dia.
 */
function criarExecutor({ conversar, prompts, flow, expediente }) {
    const exp = expediente || { aberto: true, proximoExpediente: 'amanhã de manhã' };

    async function extrair(mensagem, campoAtual, historico) {
        const prompt = prompts.promptExtracao({
            mensagemSanitizada: String(mensagem).replace(/[<>]/g, '').substring(0, 1000),
            campoAtual
        });
        const cru = await conversar({ system: null, mensagens: historico.slice(-4), prompt, temperatura: 0 });
        try {
            const limpo = String(cru).replace(/```json?/g, '').replace(/```/g, '').trim();
            return JSON.parse(limpo);
        } catch (_) {
            // Extração que não volta JSON é falha de qualidade, não exceção: o
            // turno continua e a violação aparece no relatório.
            return null;
        }
    }

    async function responder(mensagem, proximoCampo, leadData, historico) {
        const prompt = prompts.promptResposta({
            isInicioConversa: leadData.conversationHistory.length === 0,
            mensagemSanitizada: String(mensagem).replace(/[<>]/g, '').substring(0, 1000),
            proximoCampo,
            leadData,
            expediente: exp
        });
        return conversar({
            system: prompts.SYSTEM_SDR,
            mensagens: historico.slice(-10),
            prompt,
            temperatura: 0.7
        });
    }

    /**
     * Roda um roteiro inteiro e devolve os turnos com as violações de cada um.
     */
    async function rodarRoteiro(roteiro) {
        const leadData = { conversationHistory: [] };
        const turnos = [];
        const perguntasAnteriores = [];
        let extracoesFalhas = 0;

        for (const fala of roteiro.falas) {
            const proximoAntes = flow.determinarProximoCampo(leadData);
            const historico = leadData.conversationHistory
                .slice(-10)
                .map((h) => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content }));

            const extraido = await extrair(fala, proximoAntes?.campo, historico);
            if (!extraido) extracoesFalhas++;

            leadData.objecaoAtiva = null;
            leadData.perguntouAgora = null;
            if (extraido) {
                flow.aplicarCampos(leadData, extraido);
                leadData.perguntouAgora = extraido.perguntou || null;
                if (extraido.objecao) leadData.objecaoAtiva = extraido.objecao;
                if (!leadData.segmentoKey) {
                    leadData.segmentoKey = flow.detectarSegmento(leadData.segmento || fala);
                }
            }

            const proximoDepois = flow.determinarProximoCampo(leadData);
            const resposta = await responder(fala, proximoDepois, leadData, historico);

            const anterior = turnos[turnos.length - 1];
            const primeiroNome = (leadData.nome || '').split(' ')[0];
            const contexto = {
                primeiroNome,
                usouNomeNaAnterior: Boolean(
                    anterior && primeiroNome.length > 1 && anterior.resposta.toLowerCase().includes(primeiroNome.toLowerCase())
                ),
                perguntasAnteriores: [...perguntasAnteriores]
            };

            const analise = analisar(resposta, contexto);
            const pergunta = extrairPergunta(resposta);
            if (pergunta) perguntasAnteriores.push(pergunta);

            leadData.conversationHistory.push({ role: 'user', content: fala });
            leadData.conversationHistory.push({ role: 'assistant', content: resposta });

            turnos.push({ fala, resposta, violacoes: analise.violacoes, sinais: analise.sinais });
        }

        return { roteiro: roteiro.id, turnos, leadData, extracoesFalhas };
    }

    return { rodarRoteiro };
}

/**
 * Consolida execuções em um placar comparável.
 */
function resumir(execucoes) {
    const porRegra = new Map();
    const porGravidade = { critica: 0, alta: 0, media: 0 };
    let sinais = 0;
    let turnos = 0;
    let turnosLimpos = 0;
    let extracoesFalhas = 0;

    for (const exec of execucoes) {
        extracoesFalhas += exec.extracoesFalhas || 0;
        for (const t of exec.turnos) {
            turnos++;
            if (!t.violacoes.length) turnosLimpos++;
            sinais += (t.sinais || []).length;
            for (const v of t.violacoes) {
                porRegra.set(v.id, (porRegra.get(v.id) || 0) + 1);
                porGravidade[v.gravidade] = (porGravidade[v.gravidade] || 0) + 1;
            }
        }
    }

    return {
        turnos,
        turnosLimpos,
        percentualLimpo: turnos ? Math.round((turnosLimpos / turnos) * 100) : 0,
        porGravidade,
        extracoesFalhas,
        sinais,
        porRegra: [...porRegra.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ id, n }))
    };
}

module.exports = { criarExecutor, resumir };
