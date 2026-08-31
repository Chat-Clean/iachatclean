// =============================================================
//  GRADE DE HORÁRIOS — quais minutos do dia viram reunião oferecida.
//
//  Extraído do calendar.js porque a regra do passo estava errada e não havia
//  como testá-la sem falar com o Google. O bug: o passo era
//
//      const passo = DURACAO_MIN >= 60 ? DURACAO_MIN : 30;
//
//  que só é correto quando a reunião dura exatamente 30 ou 60 minutos. Com 40
//  minutos o passo virava 30 e a grade saía SOBREPOSTA — 10:00-10:40 e
//  10:30-11:10 eram oferecidos como opções distintas ao mesmo lead.
//
//  Módulo puro: trabalha em minutos desde a meia-noite, sem fuso e sem I/O.
// =============================================================

/**
 * Gera os minutos de início das reuniões de um dia.
 *
 * @param {object} p
 * @param {number} p.inicioMin   Primeiro horário possível (min desde 00:00).
 * @param {number} p.fimMin      A reunião precisa TERMINAR até aqui.
 * @param {number} p.duracaoMin  Duração da reunião.
 * @param {number} [p.passoMin]  Intervalo entre inícios. Padrão: a própria
 *                               duração, que é o único valor que nunca sobrepõe.
 * @param {number} [p.almocoIni] Início do bloqueio de almoço.
 * @param {number} [p.almocoFim] Fim do bloqueio de almoço.
 * @returns {number[]} minutos de início, em ordem.
 */
function gerarMinutosDoDia({ inicioMin, fimMin, duracaoMin, passoMin, almocoIni = 0, almocoFim = 0 }) {
    if (!(duracaoMin > 0)) return [];
    // Passo menor que a duração produz sobreposição. Aceitamos um passo maior
    // (grade mais esparsa), mas nunca menor.
    const passo = Math.max(passoMin || duracaoMin, duracaoMin);

    const minutos = [];
    for (let m = inicioMin; m + duracaoMin <= fimMin; m += passo) {
        // Sobreposição de intervalos com o almoço.
        if (almocoFim > almocoIni && m < almocoFim && m + duracaoMin > almocoIni) continue;
        minutos.push(m);
    }
    return minutos;
}

/**
 * true se algum par da grade se sobrepõe. Usado em teste e no diagnóstico —
 * uma grade sobreposta é sempre defeito de configuração.
 */
function temSobreposicao(minutos, duracaoMin) {
    for (let i = 1; i < minutos.length; i++) {
        if (minutos[i] < minutos[i - 1] + duracaoMin) return true;
    }
    return false;
}

// "HH:MM" -> minutos desde 00:00. Devolve `padrao` quando o formato não bate.
function parseHHMM(s, padrao) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
    if (!m) return padrao;
    const h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    if (h > 23 || min > 59) return padrao;
    return h * 60 + min;
}

function formatarHHMM(minutos) {
    const h = Math.floor(minutos / 60);
    const m = minutos % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

module.exports = { gerarMinutosDoDia, temSobreposicao, parseHHMM, formatarHHMM };
