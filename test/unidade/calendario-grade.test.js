// Testa as REGRAS DE NEGOCIO do agendamento contra a funcao real do
// calendar.js, nao contra uma copia da logica:
//   - reuniao so a partir das 10h
//   - ultima comecando as 16:40
//   - nada entre 12:30 e 13:30
//   - nada em sabado ou domingo
//
// Nao faz chamada ao Google: gerarCandidatos e pura, so o freebusy sai na rede.
import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let cal;
beforeAll(() => {
    // A janela e lida no carregamento do modulo, entao o ambiente vem antes.
    process.env.AGENDA_INICIO = '10:00';
    process.env.AGENDA_FIM = '17:20';
    process.env.REUNIAO_DURACAO_MIN = '40';
    process.env.ALMOCO_INICIO = '12:30';
    process.env.ALMOCO_FIM = '13:30';
    cal = require('../../calendar.js');
});

const TZ = 'America/Recife';
const horaLocal = (d) =>
    new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
const diaLocal = (d) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(d);
const minutos = (d) => {
    const [h, m] = horaLocal(d).split(':').map(Number);
    return h * 60 + m;
};

// Segunda-feira as 00:05 de Natal, para a grade nascer inteira.
const SEGUNDA = new Date('2026-09-07T03:05:00Z');

function candidatos(dias = 5) {
    return cal.gerarCandidatos({ dias, aPartirDe: SEGUNDA });
}

describe('janela de agendamento', () => {
    it('nao oferece nada antes das 10h', () => {
        for (const s of candidatos()) expect(minutos(s.start)).toBeGreaterThanOrEqual(10 * 60);
    });

    it('a ultima reuniao do dia comeca as 16:40', () => {
        const porDia = new Map();
        for (const s of candidatos()) {
            const dia = s.start.toISOString().slice(0, 10);
            porDia.set(dia, Math.max(porDia.get(dia) || 0, minutos(s.start)));
        }
        for (const ultimo of porDia.values()) expect(ultimo).toBe(16 * 60 + 40);
    });

    it('a grade de um dia util e exatamente a combinada', () => {
        const primeiroDia = candidatos()[0].start.toISOString().slice(0, 10);
        const doDia = candidatos()
            .filter((s) => s.start.toISOString().slice(0, 10) === primeiroDia)
            .map((s) => horaLocal(s.start));
        expect(doDia).toEqual(['10:00', '10:40', '11:20', '14:00', '14:40', '15:20', '16:00', '16:40']);
    });

    it('cada reuniao dura 40 minutos', () => {
        for (const s of candidatos()) expect((s.end - s.start) / 60000).toBe(40);
    });
});

describe('almoco bloqueado', () => {
    it('nenhuma reuniao encosta na janela 12:30-13:30', () => {
        for (const s of candidatos()) {
            const ini = minutos(s.start);
            const fim = ini + 40;
            expect(ini < 13 * 60 + 30 && fim > 12 * 60 + 30).toBe(false);
        }
    });
});

describe('fim de semana', () => {
    it('nao oferece sabado nem domingo', () => {
        // Pede dias suficientes para atravessar um fim de semana.
        for (const s of cal.gerarCandidatos({ dias: 10, aPartirDe: SEGUNDA })) {
            expect(['Sat', 'Sun']).not.toContain(diaLocal(s.start));
        }
    });

    it('atravessa o fim de semana e continua na segunda seguinte', () => {
        const dias = [...new Set(cal.gerarCandidatos({ dias: 7, aPartirDe: SEGUNDA }).map((s) => diaLocal(s.start)))];
        expect(dias).toContain('Mon');
        expect(dias).not.toContain('Sat');
    });
});

describe('so futuro', () => {
    it('descarta horarios que ja passaram no dia corrente', () => {
        // Quinta as 15:00 de Natal: 10:00 e 14:40 do proprio dia ja passaram.
        const quintaTarde = new Date('2026-09-10T18:00:00Z');
        const doDia = cal
            .gerarCandidatos({ dias: 1, aPartirDe: quintaTarde })
            .filter((s) => s.start.toISOString().slice(0, 10) === '2026-09-10')
            .map((s) => horaLocal(s.start));
        expect(doDia).toEqual(['15:20', '16:00', '16:40']);
    });
});
