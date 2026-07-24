// =============================================================
//  GOOGLE CALENDAR — disponibilidade do time + criação de reunião
//  Cenário: contas Gmail comuns. Uma conta "central" recebe o
//  compartilhamento das agendas do time (permissão de editar eventos)
//  e o servidor usa o OAuth dessa conta (refresh token gerado uma vez
//  com google-auth.js).
//
//  Env (.env):
//    GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN
//    GOOGLE_TEAM_CALENDARS   = e-mails das agendas do time (vírgula)
//    GOOGLE_BOOKING_CALENDAR = agenda onde criar o evento (padrão: 1ª do time)
//    REUNIAO_DURACAO_MIN     = duração da reunião em minutos (padrão 30)
//
//  Se não estiver configurado, configurado()=false e o bot cai no
//  comportamento atual (coleta horário preferido e a equipe agenda manual).
// =============================================================

const { google } = require('googleapis');

const TZ = 'America/Recife'; // Natal-RN, UTC-3 fixo (sem horário de verão)
const OFFSET = '-03:00';
const ABRE = 9, FECHA = 18;

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID     || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN || '';
const TEAM_CALENDARS = (process.env.GOOGLE_TEAM_CALENDARS || '').split(',').map(s => s.trim()).filter(Boolean);
const BOOKING_CALENDAR = process.env.GOOGLE_BOOKING_CALENDAR || TEAM_CALENDARS[0] || 'primary';
const DURACAO_MIN = parseInt(process.env.REUNIAO_DURACAO_MIN || '30', 10);

function configurado() {
    return !!(CLIENT_ID && CLIENT_SECRET && REFRESH_TOKEN && TEAM_CALENDARS.length);
}

function auth() {
    const o = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
    o.setCredentials({ refresh_token: REFRESH_TOKEN });
    return o;
}
function api() { return google.calendar({ version: 'v3', auth: auth() }); }

// --- helpers de fuso (Natal-RN é sempre UTC-3) ---
function ymdNatal(date) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
function diaSemanaNatal(date) {
    return new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(date); // Mon..Sun
}
function slotNatal(ymd, h, m) {
    return new Date(`${ymd}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00${OFFSET}`);
}

// Rótulo amigável em pt-BR (ex.: "segunda 27/07 às 14h30")
const DIAS_PT = { Sun: 'domingo', Mon: 'segunda', Tue: 'terça', Wed: 'quarta', Thu: 'quinta', Fri: 'sexta', Sat: 'sábado' };
function rotuloSlot(date) {
    const dia = DIAS_PT[diaSemanaNatal(date)];
    const dm = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit' }).format(date);
    const hm = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
    const [hh, mm] = hm.split(':');
    return `${dia} ${dm} às ${hh}h${mm === '00' ? '' : mm}`;
}

// Gera os slots candidatos (dias úteis, 9h–18h, passo = duração) a partir de agora.
function gerarCandidatos({ dias, aPartirDe }) {
    const slots = [];
    let uteis = 0;
    for (let i = 0; i < dias + 5 && uteis < dias; i++) {
        const d = new Date(aPartirDe.getTime() + i * 86400000);
        const wd = diaSemanaNatal(d);
        if (wd === 'Sat' || wd === 'Sun') continue;
        uteis++;
        const ymd = ymdNatal(d);
        const limite = slotNatal(ymd, FECHA, 0);
        for (let h = ABRE; h < FECHA; h++) {
            for (const m of (DURACAO_MIN >= 60 ? [0] : [0, 30])) {
                const start = slotNatal(ymd, h, m);
                const end = new Date(start.getTime() + DURACAO_MIN * 60000);
                if (end > limite) continue;
                if (start.getTime() <= aPartirDe.getTime()) continue; // só futuro
                slots.push({ start, end });
            }
        }
    }
    return slots;
}

// Retorna os próximos `max` horários livres em ao menos UMA agenda do time.
// Cada item: { start, end, calendarId, label }.
async function horariosLivres({ dias = 5, max = 3, aPartirDe = new Date() } = {}) {
    if (!configurado()) return [];
    const candidatos = gerarCandidatos({ dias, aPartirDe });
    if (!candidatos.length) return [];

    const cal = api();
    const fb = await cal.freebusy.query({
        requestBody: {
            timeMin: candidatos[0].start.toISOString(),
            timeMax: candidatos[candidatos.length - 1].end.toISOString(),
            timeZone: TZ,
            items: TEAM_CALENDARS.map(id => ({ id }))
        }
    });

    const busyPorCal = {};
    for (const id of TEAM_CALENDARS) {
        busyPorCal[id] = (fb.data.calendars?.[id]?.busy || []).map(b => [new Date(b.start), new Date(b.end)]);
    }

    const livres = [];
    for (const s of candidatos) {
        const calLivre = TEAM_CALENDARS.find(id => !busyPorCal[id].some(([bs, be]) => s.start < be && s.end > bs));
        if (calLivre) {
            livres.push({ start: s.start, end: s.end, calendarId: calLivre, label: rotuloSlot(s.start) });
            if (livres.length >= max) break;
        }
    }
    return livres;
}

// Cria o evento (bloqueio na agenda do time — sem convidar o cliente).
async function agendarReuniao({ start, end, calendarId, titulo, descricao }) {
    if (!configurado()) throw new Error('Google Calendar não configurado');
    const cal = api();
    const ev = await cal.events.insert({
        calendarId: calendarId || BOOKING_CALENDAR,
        requestBody: {
            summary: titulo,
            description: descricao,
            start: { dateTime: new Date(start).toISOString(), timeZone: TZ },
            end: { dateTime: new Date(end).toISOString(), timeZone: TZ }
        }
    });
    return { id: ev.data.id, htmlLink: ev.data.htmlLink, label: rotuloSlot(new Date(start)) };
}

// Cancela/remove um evento (para reagendamento ou cancelamento).
async function cancelarReuniao({ eventId, calendarId }) {
    if (!configurado()) throw new Error('Google Calendar não configurado');
    const cal = api();
    await cal.events.delete({ calendarId: calendarId || BOOKING_CALENDAR, eventId });
    return true;
}

// Diagnóstico da config (sem expor valores/segredos) — usado pelo /diag.
function diag() {
    return {
        configurado: configurado(),
        clientId: !!CLIENT_ID,
        clientSecret: !!CLIENT_SECRET,
        refreshToken: !!REFRESH_TOKEN,
        teamCalendarsCount: TEAM_CALENDARS.length,
        bookingCalendarSet: !!process.env.GOOGLE_BOOKING_CALENDAR,
        duracaoMin: DURACAO_MIN
    };
}

module.exports = { configurado, horariosLivres, agendarReuniao, cancelarReuniao, rotuloSlot, diag, DURACAO_MIN, TZ };
