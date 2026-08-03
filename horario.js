// =============================================================
//  HORÁRIO — expediente do time ChatClean
//  Atendimento humano: segunda a sexta, 09h–18h (horário de Natal-RN),
//  exceto feriados. Fora disso (noite + fim de semana + feriado) o bot
//  entra em MODO PLANTÃO (secretária): não promete atendimento imediato
//  e agenda retorno para o próximo dia útil.
//
//  estaEmExpediente(date?) → { aberto, motivo, proximoExpediente }
//  Aceita uma data (para testes); por padrão usa a hora atual.
//
//  Feriados: nacionais fixos embutidos + extras via env FERIADOS
//  (lista separada por vírgula, "YYYY-MM-DD" ou "MM-DD"). Feriados
//  MÓVEIS (Carnaval, Sexta-feira Santa, Corpus Christi) mudam a cada
//  ano — coloque-os no FERIADOS do ano corrente.
// =============================================================

const TZ = 'America/Recife'; // Natal-RN — UTC-3, sem horário de verão
const ABRE = 9;   // 09h
const FECHA = 18; // 18h (atende enquanto hora < 18)

// Feriados nacionais de data fixa (MM-DD). Consciência Negra (11-20) é
// feriado nacional desde 2024.
const FERIADOS_FIXOS = new Set([
    '01-01', // Confraternização Universal
    '04-21', // Tiradentes
    '05-01', // Dia do Trabalho
    '09-07', // Independência
    '10-12', // Nossa Senhora Aparecida
    '11-02', // Finados
    '11-15', // Proclamação da República
    '11-20', // Consciência Negra
    '12-25'  // Natal
]);
// Extras/móveis por env (YYYY-MM-DD para um ano específico, ou MM-DD recorrente).
const FERIADOS_EXTRA = new Set(
    (process.env.FERIADOS || '').split(',').map(s => s.trim()).filter(Boolean)
);

const DIAS_SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

// Instante → objeto Date na hora LOCAL de Natal-RN.
function paraLocal(date) {
    return new Date(date.toLocaleString('en-US', { timeZone: TZ }));
}
function ymd(local) {
    const y = local.getFullYear();
    const m = String(local.getMonth() + 1).padStart(2, '0');
    const d = String(local.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}
function ehFeriado(local) {
    const iso = ymd(local);
    const md = iso.slice(5);
    return FERIADOS_FIXOS.has(md) || FERIADOS_EXTRA.has(iso) || FERIADOS_EXTRA.has(md);
}
function ehDiaUtil(local) {
    const dia = local.getDay();
    return dia >= 1 && dia <= 5 && !ehFeriado(local);
}

// Rótulo amigável do próximo momento em que o time abre (09h de um dia útil,
// pulando fins de semana E feriados).
function rotuloProximoExpediente(local) {
    const alvo = new Date(local);
    // Se hoje é dia útil e ainda não abriu, o próximo é hoje às 9h.
    if (!(ehDiaUtil(local) && local.getHours() < ABRE)) {
        // Caso contrário, avança para o próximo dia útil.
        do { alvo.setDate(alvo.getDate() + 1); } while (!ehDiaUtil(alvo));
    }
    alvo.setHours(ABRE, 0, 0, 0);

    // Diferença em dias de calendário (comparando só a data).
    const d0 = new Date(local); d0.setHours(0, 0, 0, 0);
    const d1 = new Date(alvo);  d1.setHours(0, 0, 0, 0);
    const difDias = Math.round((d1 - d0) / 86400000);

    if (difDias === 0) return 'hoje às 9h';
    if (difDias === 1) return 'amanhã às 9h';
    return `na ${DIAS_SEMANA[alvo.getDay()]} às 9h`;
}

function estaEmExpediente(date = new Date()) {
    const local = paraLocal(date);
    const dia = local.getDay();
    const hora = local.getHours();
    const feriado = ehFeriado(local);
    const fimDeSemana = (dia === 0 || dia === 6);
    const comercial = hora >= ABRE && hora < FECHA;
    const aberto = !fimDeSemana && !feriado && comercial;

    let motivo = null;
    if (feriado) motivo = 'feriado';
    else if (fimDeSemana) motivo = 'fim de semana';
    else if (hora < ABRE) motivo = 'antes do horário';
    else if (hora >= FECHA) motivo = 'fora do horário (noite)';

    return { aberto, motivo, proximoExpediente: aberto ? null : rotuloProximoExpediente(local) };
}

module.exports = { estaEmExpediente, ehFeriado, TZ };
