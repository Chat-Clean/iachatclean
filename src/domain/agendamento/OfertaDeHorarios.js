// =============================================================
//  OFERTA DE HORARIOS — dois horarios em texto corrido, escolha em
//  qualquer formato e confirmacao com dia, data e hora (spec 0003).
//
//  Antes: tres horarios numerados e so o numero era entendido. O lead que
//  respondia "10 h" ouvia de novo a pergunta.
//
//  Modulo puro. Natal-RN nao tem horario de verao (UTC-3 fixo).
// =============================================================

const TZ = 'America/Recife';
const DIAS = { Sun: 'domingo', Mon: 'segunda', Tue: 'terça', Wed: 'quarta', Thu: 'quinta', Fri: 'sexta', Sat: 'sábado' };
const DIAS_SEM_ACENTO = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];

// Horario que comeca em menos que isto ja nao e oferecido nem agendado.
const ANTECEDENCIA_MINIMA_MS = 5 * 60 * 1000;

const FORMATO = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
});

function partesLocais(data) {
    const p = Object.fromEntries(FORMATO.formatToParts(new Date(data)).map((x) => [x.type, x.value]));
    return {
        ymd: `${p.year}-${p.month}-${p.day}`,
        dia: DIAS[p.weekday],
        diaSemAcento: DIAS_SEM_ACENTO[Object.keys(DIAS).indexOf(p.weekday)],
        dd: p.day,
        mm: p.month,
        h: Number(p.hour) % 24,
        min: Number(p.minute)
    };
}

const periodo = (h) => (h < 12 ? 'manha' : 'tarde');
const rotuloHora = ({ h, min }) => `${h}h${min ? String(min).padStart(2, '0') : ''}`;

function diasEntre(ymdA, ymdB) {
    return Math.round((Date.parse(ymdB + 'T00:00:00Z') - Date.parse(ymdA + 'T00:00:00Z')) / 86400000);
}

function diaRelativo(slot, agora) {
    const s = partesLocais(slot.start);
    const dif = diasEntre(partesLocais(agora).ymd, s.ymd);
    if (dif === 0) return 'hoje';
    if (dif === 1) return 'amanhã';
    return s.dia;
}

const maiuscula = (t) => t.charAt(0).toUpperCase() + t.slice(1);

// Dois horarios que deem escolha de verdade: o primeiro livre e o primeiro do
// outro periodo no mesmo dia; sem isso, o primeiro do dia seguinte. 10h e 10h40
// nao sao escolha.
function escolherDoisHorarios(slots) {
    if (slots.length <= 2) return slots.slice();
    const [primeiro] = slots;
    const p = partesLocais(primeiro.start);
    const info = slots.map((s) => partesLocais(s.start));
    const outroPeriodo = slots.find((s, i) => i > 0 && info[i].ymd === p.ymd && periodo(info[i].h) !== periodo(p.h));
    const outroDia = slots.find((s, i) => info[i].ymd !== p.ymd);
    return [primeiro, outroPeriodo || outroDia || slots[1]];
}

// "Amanha as 10h ou as 14h?" / "Hoje as 16h ou amanha as 10h?"
function textoDaOferta(slots, agora = new Date()) {
    if (!slots.length) return '';
    const [a, b] = slots;
    const ra = diaRelativo(a, agora);
    const ha = rotuloHora(partesLocais(a.start));
    if (!b) return `${maiuscula(ra)} às ${ha}, pode ser?`;
    const rb = diaRelativo(b, agora);
    const hb = rotuloHora(partesLocais(b.start));
    return rb === ra
        ? `${maiuscula(ra)} às ${ha} ou às ${hb}?`
        : `${maiuscula(ra)} às ${ha} ou ${rb} às ${hb}?`;
}

function textoDaConfirmacao(slot, nomeEspecialista = '') {
    const p = partesLocais(slot.start);
    const quem = String(nomeEspecialista || '').trim() || 'Um especialista do time';
    return `Fechado: ${p.dia}, ${p.dd}/${p.mm}, às ${rotuloHora(p)}. ${quem} te chama aqui 5 min antes. Até lá!`;
}

function slotVencido(slot, agora = new Date()) {
    return new Date(slot.start).getTime() - new Date(agora).getTime() < ANTECEDENCIA_MINIMA_MS;
}

function normalizar(texto) {
    return String(texto || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

// Hora citada pelo lead: "10h", "10h40", "10:00", "as 10", "10" sozinho.
function horaDoTexto(t, nSlots) {
    let m = t.match(/(?<!\d)([01]?\d|2[0-3])\s*(?:h|:)\s*([0-5]\d)?(?!\d)/);
    if (!m) m = t.match(/\bas\s+([01]?\d|2[0-3])(?!\d)/);
    if (!m) {
        const solto = t.match(/^(?:pode ser\s+)?([01]?\d|2[0-3])$/);
        if (solto && Number(solto[1]) > nSlots) m = solto;
    }
    if (!m) return null;
    let h = Number(m[1]);
    if (h >= 1 && h <= 6) h += 12; // "as 2" = 14h
    return { h, min: m[2] !== undefined ? Number(m[2]) : null };
}

function diaDoTexto(t, info) {
    if (/\bhoje\b/.test(t)) return { relativo: 0 };
    if (/\bamanha\b/.test(t)) return { relativo: 1 };
    for (const d of ['terca', 'quarta', 'quinta', 'sexta']) {
        if (new RegExp(`\\b${d}\\b`).test(t)) return { semana: d };
    }
    // "segunda" e dia da semana ou ordinal. So vale como dia quando ha segunda na oferta.
    if (/\bsegunda\b(?!\s*(opcao|opção|horario))/.test(t) && info.some((i) => i.diaSemAcento === 'segunda')) {
        return { semana: 'segunda' };
    }
    return null;
}

function periodoDoTexto(t) {
    if (/\bmanha\b/.test(t)) return 'manha';
    if (/\btarde\b/.test(t)) return 'tarde';
    return null;
}

function indiceExplicito(t, nSlots, extraido) {
    const n = Number(extraido && extraido.slotEscolhido);
    if (Number.isInteger(n) && n >= 1 && n <= nSlots) return n - 1;
    const dig = t.match(/^(?:opcao\s*|o\s*|a\s*)?([1-9])$/) || t.match(/\bopcao\s*([1-9])\b/);
    if (dig && Number(dig[1]) <= nSlots) return Number(dig[1]) - 1;
    if (/\bprimeir[oa]\b/.test(t)) return 0;
    if (/\bsegund[oa]\s*(opcao|horario)\b|\bo segundo\b/.test(t) && nSlots >= 2) return 1;
    if (/\bultim[oa]\b/.test(t)) return nSlots - 1;
    return null;
}

// Aceite sem dizer qual: a mensagem inteira e so isso ("pode ser", "ok, fechado").
// "sim, quanto custa?" ou "ok, mas agora nao" nao e aceite.
const PALAVRA_DE_ACEITE = '(?:sim|ok|okay|pode ser|pode|fechado|beleza|blz|perfeito|bora|claro|combinado|show|top|otimo|isso|obrigad[oa]|valeu)';
const ACEITE = new RegExp(`^${PALAVRA_DE_ACEITE}(?:[\\s,.!]+${PALAVRA_DE_ACEITE})*[\\s.!]*$`);
// Mensagem longa e conversa, nao resposta a oferta ("perco 3h por dia").
const MAX_CHARS_DE_ESCOLHA = 80;

// Pedido do lead (dia, hora, periodo) aplicado a uma lista de horarios.
// Devolve os indices compativeis, do mais proximo para o mais distante.
function filtrarPorPedido(slots, pedido, agora = new Date()) {
    const hoje = partesLocais(agora).ymd;
    return slots
        .map((s, i) => ({ i, p: partesLocais(s.start) }))
        .filter(({ p }) => {
            if (pedido.dia && pedido.dia.relativo !== undefined && diasEntre(hoje, p.ymd) !== pedido.dia.relativo) return false;
            if (pedido.dia && pedido.dia.semana && p.diaSemAcento !== pedido.dia.semana) return false;
            if (pedido.hora && (p.h !== pedido.hora.h || (pedido.hora.min !== null && p.min !== pedido.hora.min))) return false;
            if (pedido.periodo && periodo(p.h) !== pedido.periodo) return false;
            return true;
        })
        .map(({ i }) => i);
}

/**
 * Entende a resposta do lead a uma oferta de horarios.
 *
 * @returns {{indice:number}|{pedido:object}|null}
 *   indice -> um dos horarios oferecidos (resposta ambigua cai no mais proximo);
 *   pedido -> o lead pediu dia/hora/periodo que nao esta na oferta (so com
 *             extraido.horarioPreferido confirmando);
 *   null   -> nao e uma escolha de horario.
 */
function interpretarEscolha(texto, slots, extraido = {}, agora = new Date()) {
    if (!slots || !slots.length) return null;
    const t = normalizar(texto);
    if (t.length > MAX_CHARS_DE_ESCOLHA) return null;
    const info = slots.map((s) => partesLocais(s.start));

    const pedido = {
        dia: diaDoTexto(t, info),
        hora: horaDoTexto(t, slots.length),
        periodo: periodoDoTexto(t)
    };
    if (pedido.dia || pedido.hora || pedido.periodo) {
        const compativeis = filtrarPorPedido(slots, pedido, agora);
        if (compativeis.length) return { indice: compativeis[0] };
        // Fora da oferta, so com a extracao confirmando que e preferencia de
        // horario: "tenho 2 lojas" ou "abro as 8h" nao viram reuniao.
        return extraido && extraido.horarioPreferido ? { pedido } : null;
    }

    const explicito = indiceExplicito(t, slots.length, extraido);
    if (explicito !== null) return { indice: explicito };

    if ((extraido && extraido.aceitouHorario) || ACEITE.test(t)) return { indice: 0 };
    return null;
}

module.exports = {
    escolherDoisHorarios,
    textoDaOferta,
    textoDaConfirmacao,
    interpretarEscolha,
    filtrarPorPedido,
    slotVencido,
    partesLocais
};
