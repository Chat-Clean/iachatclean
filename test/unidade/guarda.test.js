import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { avaliar, RESPOSTAS_SEGURAS } = require('../../src/domain/qualidade/guarda.js');

describe('guarda de resposta', () => {
    it('aprova resposta que respeita as invariantes', () => {
        const r = avaliar('O investimento varia conforme sua operação. Quer que um especialista te mostre?');
        expect(r.ok).toBe(true);
        expect(r.instrucaoDeCorrecao).toBe(null);
    });

    // Caso real medido no eval: o modelo inventou uma faixa de preco.
    it('barra a faixa de preco inventada e pede correcao', () => {
        const r = avaliar('Os preços ficam entre R$ 200 a R$ 1.000, dependendo do que você precisa. Quer saber mais?');
        expect(r.ok).toBe(false);
        expect(r.instrucaoDeCorrecao).toMatch(/NUNCA cite número/);
        expect(r.respostaSegura).toBe(RESPOSTAS_SEGURAS['nao-revela-preco']);
    });

    it('barra revelacao de ser IA', () => {
        const r = avaliar('Sou uma IA, mas posso te ajudar. O que precisa?');
        expect(r.ok).toBe(false);
        expect(r.respostaSegura).toBeTruthy();
    });

    it('barra afirmacao de agendamento', () => {
        const r = avaliar('Pronto, agendei sua reunião para as 14h!');
        expect(r.ok).toBe(false);
        expect(r.instrucaoDeCorrecao).toMatch(/número/);
    });

    it('corrige a negativa de ler link', () => {
        const r = avaliar('Não consigo acessar esse link, mas posso ajudar de outra forma?');
        expect(r.ok).toBe(false);
        expect(r.instrucaoDeCorrecao).toMatch(/ignore o link/);
        // Nao ha resposta segura pronta: o certo aqui e regerar, nao enlatar.
        expect(r.respostaSegura).toBe(null);
    });

    // Estilo nao justifica uma segunda chamada ao modelo.
    it('nao aciona correcao por violacao apenas de estilo', () => {
        const r = avaliar('Uma\nDuas\nTres linhas 😊🙂');
        expect(r.ok).toBe(true);
        expect(r.violacoes.length).toBeGreaterThan(0);
    });

    it('incluirAltas:false ignora as altas e mantem so as criticas', () => {
        const semAltas = avaliar('Não consigo acessar esse link. Como ajudo?', {}, { incluirAltas: false });
        expect(semAltas.ok).toBe(true);
        const comCritica = avaliar('Custa R$ 500. Não consigo acessar o link.', {}, { incluirAltas: false });
        expect(comCritica.ok).toBe(false);
    });

    it('acumula varias instrucoes numa correcao so', () => {
        const r = avaliar('Sou uma IA e custa R$ 300. Posso ajudar em mais alguma coisa?');
        expect(r.corrigiveis.length).toBeGreaterThanOrEqual(3);
        expect(r.instrucaoDeCorrecao.split('\n- ').length).toBeGreaterThanOrEqual(3);
    });

    it('toda resposta segura termina com pergunta, para nao matar a conversa', () => {
        for (const texto of Object.values(RESPOSTAS_SEGURAS)) {
            expect(texto.trim().endsWith('?')).toBe(true);
        }
    });
});
