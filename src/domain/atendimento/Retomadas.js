// =============================================================
//  RETOMADAS — lead que parou de responder (spec 0003, secao 06).
//
//  No maximo tres: 30 min, 1 dia e 3 dias depois da ultima fala do lead. A
//  terceira deixa a porta aberta e encerra. Nada sai entre 21h e 8h.
//
//  Antes era uma unica mensagem, "Oi! Ainda por ai?", 30 min depois.
//
//  Modulo puro. Natal-RN e UTC-3 fixo (sem horario de verao).
// =============================================================

const MIN = 60 * 1000;
const PRAZOS_MS = [30 * MIN, 24 * 60 * MIN, 3 * 24 * 60 * MIN];
const MAX_RETOMADAS = PRAZOS_MS.length;
const OFFSET_NATAL_MS = -3 * 60 * MIN;
const SILENCIO_INICIO = 21;
const SILENCIO_FIM = 8;

// Instante dentro do silencio (21h-8h) vai para as 8h seguintes.
function foraDoSilencio(ts) {
    const local = new Date(ts + OFFSET_NATAL_MS);
    const h = local.getUTCHours();
    if (h >= SILENCIO_FIM && h < SILENCIO_INICIO) return ts;
    const alvo = new Date(local);
    if (h >= SILENCIO_INICIO) alvo.setUTCDate(alvo.getUTCDate() + 1);
    alvo.setUTCHours(SILENCIO_FIM, 0, 0, 0);
    return alvo.getTime() - OFFSET_NATAL_MS;
}

function proximaRetomadaEm(lead) {
    const n = lead.retomadasEnviadas || 0;
    if (n >= MAX_RETOMADAS || !lead.ultimaFalaDoLeadEm) return null;
    return foraDoSilencio(lead.ultimaFalaDoLeadEm + PRAZOS_MS[n]);
}

const ehUltimaRetomada = (n) => n === MAX_RETOMADAS - 1;

const PORTA_ABERTA = 'Vou deixar a conversa por aqui pra não te incomodar. Quando fizer sentido, é só me chamar que a gente retoma de onde parou.';

// Texto pronto, usado quando a IA falha ou quebra regra. `campoPendente` e o
// que falta perguntar; null quando a qualificacao terminou.
const PENDENTE = {
    empresa: 'Pra eu te mostrar o que faz sentido pro seu caso: qual o nome da sua empresa?',
    decisor: 'Me conta: quem decide isso aí com você?',
    urgencia: 'Você pensa em começar quando?'
};

function retomadaPadrao(n, campoPendente) {
    if (ehUltimaRetomada(n)) return PORTA_ABERTA;
    if (campoPendente && PENDENTE[campoPendente]) return PENDENTE[campoPendente];
    return 'Ainda consigo um horário com o especialista pra te mostrar como ficaria no seu caso. Quer que eu veja os próximos?';
}

module.exports = { proximaRetomadaEm, foraDoSilencio, ehUltimaRetomada, retomadaPadrao, PORTA_ABERTA, PRAZOS_MS, MAX_RETOMADAS };
