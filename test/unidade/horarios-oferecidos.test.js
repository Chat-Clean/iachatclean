import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const o = require('../../src/domain/agendamento/OfertaDeHorarios.js');

// Spec 0003, secao 05. Datas em UTC; Natal-RN e UTC-3.
// 2026-11-10 e terca; 11:00Z = 08h em Natal.
const AGORA = new Date('2026-11-10T11:00:00Z');
const slot = (iso) => ({ start: new Date(iso), end: new Date(new Date(iso).getTime() + 40 * 60000) });

// Grade livre de quarta: 10h, 10h40, 11h20, 14h. Quinta: 10h.
const LIVRES = ['2026-11-11T13:00:00Z', '2026-11-11T13:40:00Z', '2026-11-11T14:20:00Z', '2026-11-11T17:00:00Z', '2026-11-12T13:00:00Z'].map(slot);
const OFERTA = o.escolherDoisHorarios(LIVRES); // quarta 10h e quarta 14h

describe('oferta com dois horarios (CA-012)', () => {
    it('oferece 2, nao 3: o primeiro livre e o primeiro do outro periodo', () => {
        expect(OFERTA).toHaveLength(2);
        expect(OFERTA.map((s) => s.start.toISOString())).toEqual(['2026-11-11T13:00:00.000Z', '2026-11-11T17:00:00.000Z']);
    });

    it('sem outro periodo no dia, vai para o dia seguinte', () => {
        const manhas = ['2026-11-11T13:00:00Z', '2026-11-11T13:40:00Z', '2026-11-12T13:00:00Z'].map(slot);
        expect(o.escolherDoisHorarios(manhas).map((s) => s.start.toISOString()))
            .toEqual(['2026-11-11T13:00:00.000Z', '2026-11-12T13:00:00.000Z']);
    });

    it('texto corrido, como no documento: "Amanha as 10h ou as 14h?"', () => {
        expect(o.textoDaOferta(OFERTA, AGORA)).toBe('Amanhã às 10h ou às 14h?');
    });

    it('dias diferentes citam cada dia; depois de amanha vira dia da semana', () => {
        const dois = ['2026-11-11T13:00:00Z', '2026-11-12T17:40:00Z'].map(slot);
        expect(o.textoDaOferta(dois, AGORA)).toBe('Amanhã às 10h ou quinta às 14h40?');
    });
});

describe('escolha em qualquer formato (CA-013)', () => {
    const escolha = (texto, extraido = {}) => o.interpretarEscolha(texto, OFERTA, extraido, AGORA);

    it.each([
        ['1', 0], ['2', 1], ['opção 2', 1],
        ['10h', 0], ['10 h', 0], ['às 14', 1], ['14:00', 1], ['pode ser as 10h', 0],
        ['de manhã', 0], ['à tarde', 1],
        ['o primeiro', 0], ['o segundo', 1],
        ['amanhã às 14h', 1], ['quarta', 0]
    ])('"%s" -> horario %i', (texto, indice) => {
        expect(escolha(texto)).toEqual({ indice });
    });

    it('caso real: lead responde "10 h" e o horario e aceito, sem nova pergunta', () => {
        expect(escolha('10 h')).toEqual({ indice: 0 });
    });

    it('resposta ambigua fica com o horario mais proximo', () => {
        expect(escolha('pode ser')).toEqual({ indice: 0 });
        expect(escolha('ok, fechado!')).toEqual({ indice: 0 });
        expect(escolha('qualquer um', { aceitouHorario: true })).toEqual({ indice: 0 });
    });

    it('a posicao que a extracao devolveu tambem vale', () => {
        expect(escolha('esse ultimo ai', { slotEscolhido: 2 })).toEqual({ indice: 1 });
    });

    it('hora fora da oferta vira pedido, so com a extracao confirmando preferencia', () => {
        expect(escolha('16h', { horarioPreferido: '16h' })).toEqual({ pedido: { dia: null, hora: { h: 16, min: null }, periodo: null } });
        expect(escolha('16h')).toBe(null);
    });

    it('nao e escolha: pergunta, ressalva ou conversa longa', () => {
        expect(escolha('sim, quanto custa?')).toBe(null);
        expect(escolha('ok, mas agora não')).toBe(null);
        expect(escolha('qual o preço?')).toBe(null);
        expect(escolha('perco 3h por dia respondendo cliente no whatsapp e ninguem me ajuda com isso, é muito cansativo')).toBe(null);
    });

    it('filtrarPorPedido acha o horario pedido na grade livre', () => {
        const pedido = { dia: { semana: 'quarta' }, hora: { h: 11, min: 20 }, periodo: null };
        expect(o.filtrarPorPedido(LIVRES, pedido, AGORA)).toEqual([2]);
    });
});

describe('confirmacao (CA-014)', () => {
    it('dia da semana, data e hora, quem chama e quando', () => {
        expect(o.textoDaConfirmacao(OFERTA[0], 'Lucas')).toBe('Fechado: quarta, 11/11, às 10h. Lucas te chama aqui 5 min antes. Até lá!');
    });

    it('sem nome configurado, fala do especialista do time', () => {
        expect(o.textoDaConfirmacao(OFERTA[1])).toBe('Fechado: quarta, 11/11, às 14h. Um especialista do time te chama aqui 5 min antes. Até lá!');
    });
});

describe('horario vencido (CA-015)', () => {
    it('horario que ja passou, ou comeca em menos de 5 min, esta vencido', () => {
        const s = slot('2026-11-10T13:00:00Z'); // 10h de terca
        expect(o.slotVencido(s, new Date('2026-11-10T12:00:00Z'))).toBe(false);
        expect(o.slotVencido(s, new Date('2026-11-10T12:57:00Z'))).toBe(true);
        expect(o.slotVencido(s, new Date('2026-11-10T15:00:00Z'))).toBe(true);
    });
});
