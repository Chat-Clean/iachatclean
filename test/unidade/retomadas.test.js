import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const r = require('../../src/domain/atendimento/Retomadas.js');

// Spec 0003, secao 06. Natal-RN e UTC-3: 13:00Z = 10h local.
const MIN = 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();
const ULTIMA_FALA = Date.parse('2026-11-10T13:00:00Z'); // terca, 10h

describe('cadencia de retomadas (CA-016)', () => {
    it('30 min, 1 dia e 3 dias depois da ultima fala do lead', () => {
        const lead = { ultimaFalaDoLeadEm: ULTIMA_FALA };
        expect(iso(r.proximaRetomadaEm({ ...lead, retomadasEnviadas: 0 }))).toBe('2026-11-10T13:30:00.000Z');
        expect(iso(r.proximaRetomadaEm({ ...lead, retomadasEnviadas: 1 }))).toBe('2026-11-11T13:00:00.000Z');
        expect(iso(r.proximaRetomadaEm({ ...lead, retomadasEnviadas: 2 }))).toBe('2026-11-13T13:00:00.000Z');
    });

    it('no maximo 3: depois da terceira nao ha outra', () => {
        expect(r.proximaRetomadaEm({ ultimaFalaDoLeadEm: ULTIMA_FALA, retomadasEnviadas: 3 })).toBe(null);
        expect(r.MAX_RETOMADAS).toBe(3);
    });

    it('a terceira deixa a porta aberta, sem pergunta', () => {
        expect(r.ehUltimaRetomada(2)).toBe(true);
        expect(r.retomadaPadrao(2, 'empresa')).toBe(r.PORTA_ABERTA);
        expect(r.PORTA_ABERTA).not.toMatch(/\?/);
    });

    it('o texto pronto nunca e "ainda por ai?": retoma o que falta perguntar', () => {
        expect(r.retomadaPadrao(0, 'decisor')).toMatch(/quem decide/i);
        expect(r.retomadaPadrao(1, 'urgencia')).toMatch(/começar/);
        expect(r.retomadaPadrao(0, null)).toMatch(/especialista/);
        for (const n of [0, 1, 2]) expect(r.retomadaPadrao(n, 'empresa')).not.toMatch(/ainda por a[ií]/i);
    });
});

describe('silencio entre 21h e 8h (CA-017)', () => {
    it('instante dentro do horario permitido nao muda', () => {
        const ts = Date.parse('2026-11-10T23:30:00Z'); // 20h30
        expect(r.foraDoSilencio(ts)).toBe(ts);
    });

    it('21h vira 8h do dia seguinte', () => {
        expect(iso(r.foraDoSilencio(Date.parse('2026-11-11T00:00:00Z')))).toBe('2026-11-11T11:00:00.000Z');
    });

    it('madrugada vira 8h do mesmo dia', () => {
        expect(iso(r.foraDoSilencio(Date.parse('2026-11-11T06:00:00Z')))).toBe('2026-11-11T11:00:00.000Z'); // 3h -> 8h
    });

    it('lead que parou as 20h50 recebe a primeira retomada as 8h, nao as 21h20', () => {
        const lead = { ultimaFalaDoLeadEm: Date.parse('2026-11-10T23:50:00Z'), retomadasEnviadas: 0 };
        expect(iso(r.proximaRetomadaEm(lead))).toBe('2026-11-11T11:00:00.000Z');
        expect(30 * MIN).toBe(r.PRAZOS_MS[0]);
    });
});
