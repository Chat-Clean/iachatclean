// =============================================================
//  REGRAS DE PARADA — quando a IA para de responder (spec 0003, secao 07).
//
//  Antes a regra era "nunca encerre a conversa", e o bot trocou 30 mensagens
//  de "Obrigada! Tenha uma otima noite" com o robo de uma loja.
//
//  Modulo puro. Recebe os sinais da mensagem (extracao + tempo de resposta)
//  e atualiza o estado do lead.
// =============================================================

const FECHOS = {
    despedida: 'Combinado! Se precisar, é só chamar aqui.',
    robo: 'Combinado! Se precisar, é só chamar aqui.',
    'sem-interesse': 'Entendi, obrigado por me contar. Se mudar de ideia, é só chamar aqui.',
    'fora-do-perfil': 'Obrigado pelo contato! Por aqui a gente cuida só do comercial da ChatClean. Se um dia fizer sentido pra sua empresa, é só chamar.'
};

// Mensagens seguidas com cara de robo antes de parar. Com o fecho, sao no
// maximo 3 trocas.
const LIMITE_SINAIS_DE_ROBO = 2;
// Ninguem le e digita em menos que isto depois de receber a resposta.
const RESPOSTA_INSTANTANEA_MS = 4000;

/** @typedef {{acao: 'seguir'|'silencio'|'fecho'|'perguntarMotivo', motivo?: string, texto?: string}} Decisao */

/** @type {Decisao} */
const SEGUIR = { acao: 'seguir' };
/** @type {Decisao} */
const SILENCIO = { acao: 'silencio' };
/** @type {Decisao} */
const PERGUNTAR_MOTIVO = { acao: 'perguntarMotivo' };

/** @returns {Decisao} */
function fecho(lead, motivo) {
    lead.encerrado = true;
    lead.fechoEnviado = true;
    lead.motivoEncerramento = motivo;
    return { acao: 'fecho', motivo, texto: FECHOS[motivo] };
}

// Mensagem que chegou enquanto a IA ainda respondia a anterior (rajada do
// proprio lead) tem intervalo negativo e nao conta: isso e gente digitando.
function respostaInstantanea(lead, recebidaEm) {
    if (!lead.ultimaRespostaEm || !recebidaEm) return false;
    const intervalo = recebidaEm - lead.ultimaRespostaEm;
    return intervalo >= 0 && intervalo < RESPOSTA_INSTANTANEA_MS;
}

/**
 * @param {object} lead  Estado do lead (mutado).
 * @param {object} s     Sinais: despedida, soAgradecimento, semInteresse,
 *                       foraDoPerfil, pareceRobo, respostaInstantanea.
 * @returns {Decisao}
 */
function decidirParada(lead, s = {}) {
    if (lead.roboDetectado) return SILENCIO;

    lead.sinaisDeRobo = (s.pareceRobo || s.respostaInstantanea) ? (lead.sinaisDeRobo || 0) + 1 : 0;
    if (lead.sinaisDeRobo >= LIMITE_SINAIS_DE_ROBO) {
        lead.roboDetectado = true;
        return fecho(lead, 'robo');
    }

    // Despedida nao se responde com despedida.
    if (lead.fechoEnviado && (s.despedida || s.soAgradecimento)) return SILENCIO;

    if (lead.encerrado) {
        if (s.foraDoPerfil || s.semInteresse) return SILENCIO;
        lead.encerrado = false; // voltou com assunto novo
    }
    lead.fechoEnviado = false;

    if (s.foraDoPerfil) return fecho(lead, 'fora-do-perfil');
    if (s.semInteresse) {
        lead.negativas = (lead.negativas || 0) + 1;
        return lead.negativas >= 2 ? fecho(lead, 'sem-interesse') : PERGUNTAR_MOTIVO;
    }
    if (s.despedida) return fecho(lead, 'despedida');
    return SEGUIR;
}

module.exports = { decidirParada, respostaInstantanea, FECHOS, LIMITE_SINAIS_DE_ROBO, RESPOSTA_INSTANTANEA_MS };
