import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { naoInventaHorario } = require('../../src/domain/qualidade/analisadores.js');
const { avaliar, RESPOSTAS_SEGURAS } = require('../../src/domain/qualidade/guarda.js');

// Caso real de producao: o Calendar nao devolveu grade, o fluxo entregou a
// conversa ao modelo e ele respondeu "Temos horarios disponiveis para reuniao:
// 10h, 14h e 16h" — inventados, e ja passava das 14h.
describe('bot nao inventa horario de reuniao', () => {
    it('barra o caso real', () => {
        const r = naoInventaHorario('Temos horários disponíveis para reunião: 10h, 14h e 16h. Qual funciona melhor?');
        expect(r.ok).toBe(false);
    });

    it('barra outros formatos de hora', () => {
        expect(naoInventaHorario('Consigo às 14:30, pode ser?').ok).toBe(false);
        expect(naoInventaHorario('Tenho 9 horas livre amanhã.').ok).toBe(false);
    });

    it('permite quando o SISTEMA ja ofereceu a grade numerada', () => {
        const ctx = { sistemaOfereceuHorarios: true };
        expect(naoInventaHorario('O horário das 10h ficou bom pra você?', ctx).ok).toBe(true);
    });

    it('nao confunde duracao nem "24h" com horario de reuniao', () => {
        expect(naoInventaHorario('Nosso suporte não é 24h, funciona em horário comercial.').ok).toBe(true);
        expect(naoInventaHorario('Respondemos em até 30 minutos.').ok).toBe(true);
        expect(naoInventaHorario('A gente atende de segunda a sexta.').ok).toBe(true);
    });

    it('a guarda trata como critica e devolve resposta segura', () => {
        const v = avaliar('Temos 10h, 14h e 16h disponíveis. Qual prefere?');
        expect(v.ok).toBe(false);
        expect(v.respostaSegura).toBe(RESPOSTAS_SEGURAS['nao-inventa-horario']);
        expect(v.instrucaoDeCorrecao).toMatch(/NUNCA invente horário/);
    });

    it('resposta sem horario passa', () => {
        const r = naoInventaHorario('Vou confirmar a agenda do time e já te retorno com os horários.');
        expect(r.ok).toBe(true);
    });
});
