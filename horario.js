// =============================================================
//  HORÁRIO — expediente do time ChatClean
//  Atendimento humano: segunda a sexta, 09h–18h (horário de Natal-RN).
//  Fora disso (noite + fim de semana) o bot entra em MODO PLANTÃO
//  (secretária): não promete atendimento imediato e agenda retorno.
//
//  estaEmExpediente(date?) → { aberto, motivo, proximoExpediente }
//  Aceita uma data (para testes); por padrão usa a hora atual.
// =============================================================

const TZ = 'America/Recife'; // Natal-RN — UTC-3, sem horário de verão
const ABRE = 9;   // 09h
const FECHA = 18; // 18h (atende enquanto hora < 18)

// Converte um instante para a hora/dia LOCAL de Natal-RN.
function tzParts(date) {
    const local = new Date(date.toLocaleString('en-US', { timeZone: TZ }));
    return { dia: local.getDay(), hora: local.getHours() }; // dia: 0=domingo .. 6=sábado
}

function proximoExpediente(dia, hora) {
    if (dia >= 1 && dia <= 5 && hora < ABRE) return 'hoje às 9h';          // dia útil, de madrugada/manhã cedo
    if (dia >= 1 && dia <= 4 && hora >= FECHA) return 'amanhã às 9h';       // seg–qui à noite
    if (dia === 5 && hora >= FECHA) return 'segunda-feira às 9h';           // sexta à noite
    if (dia === 6) return 'segunda-feira às 9h';                            // sábado
    if (dia === 0) return 'segunda-feira às 9h';                            // domingo
    return 'no próximo dia útil às 9h';
}

function estaEmExpediente(date = new Date()) {
    const { dia, hora } = tzParts(date);
    const fimDeSemana = (dia === 0 || dia === 6);
    const comercial = hora >= ABRE && hora < FECHA;
    const aberto = !fimDeSemana && comercial;

    let motivo = null;
    if (fimDeSemana) motivo = 'fim de semana';
    else if (hora < ABRE) motivo = 'antes do horário';
    else if (hora >= FECHA) motivo = 'fora do horário (noite)';

    return { aberto, motivo, proximoExpediente: aberto ? null : proximoExpediente(dia, hora) };
}

module.exports = { estaEmExpediente, TZ };
