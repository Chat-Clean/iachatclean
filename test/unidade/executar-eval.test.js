import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { criarExecutor, resumir } = require('../../src/eval/executar.js');
const flow = require('../../flow.js');

// Fake do LLM: nenhuma rede, nenhum credito. A extracao devolve JSON valido e a
// resposta e controlada pelo teste, para exercitar o executor de ponta a ponta.
function fakeLLM(respostas) {
    let i = 0;
    return async ({ temperatura }) => {
        if (temperatura === 0) return JSON.stringify({ perguntou: false });
        return respostas[i++ % respostas.length];
    };
}

const promptsFake = {
    SYSTEM_SDR: 'sistema',
    promptExtracao: () => 'extraia',
    promptResposta: () => 'responda'
};

describe('executor de eval', () => {
    it('roda um roteiro sem tocar a rede e devolve um turno por fala', async () => {
        const executor = criarExecutor({
            conversar: fakeLLM(['Qual seu nome?']),
            prompts: promptsFake,
            flow
        });
        const r = await executor.rodarRoteiro({ id: 'teste', falas: ['oi', 'tudo bem'] });
        expect(r.turnos).toHaveLength(2);
        expect(r.turnos[0].fala).toBe('oi');
    });

    it('acusa as violacoes de cada resposta', async () => {
        const executor = criarExecutor({
            conversar: fakeLLM(['Sou uma IA. Custa R$ 500. Posso ajudar em mais alguma coisa?']),
            prompts: promptsFake,
            flow
        });
        const r = await executor.rodarRoteiro({ id: 'ruim', falas: ['oi'] });
        const ids = r.turnos[0].violacoes.map((v) => v.id);
        expect(ids).toContain('nao-revela-ser-ia');
        expect(ids).toContain('nao-revela-preco');
        expect(ids).toContain('sem-dispensa');
    });

    it('conta extracao que nao devolveu JSON', async () => {
        const executor = criarExecutor({
            conversar: async ({ temperatura }) => (temperatura === 0 ? 'isso nao e json' : 'Qual seu nome?'),
            prompts: promptsFake,
            flow
        });
        const r = await executor.rodarRoteiro({ id: 'x', falas: ['oi', 'oi'] });
        expect(r.extracoesFalhas).toBe(2);
    });

    it('detecta pergunta repetida entre turnos', async () => {
        const executor = criarExecutor({
            conversar: fakeLLM(['Qual o nome da sua empresa?']),
            prompts: promptsFake,
            flow
        });
        const r = await executor.rodarRoteiro({ id: 'repete', falas: ['oi', 'oi de novo'] });
        expect(r.turnos[0].violacoes.map((v) => v.id)).not.toContain('nao-repete-pergunta');
        expect(r.turnos[1].violacoes.map((v) => v.id)).toContain('nao-repete-pergunta');
    });
});

describe('resumir', () => {
    it('consolida o placar por regra e por gravidade', () => {
        const execucoes = [
            {
                turnos: [
                    { violacoes: [] },
                    { violacoes: [{ id: 'sem-dispensa', gravidade: 'alta' }] },
                    { violacoes: [{ id: 'sem-dispensa', gravidade: 'alta' }, { id: 'max-1-emoji', gravidade: 'media' }] }
                ],
                extracoesFalhas: 1
            }
        ];
        const r = resumir(execucoes);
        expect(r.turnos).toBe(3);
        expect(r.turnosLimpos).toBe(1);
        expect(r.percentualLimpo).toBe(33);
        expect(r.porGravidade.alta).toBe(2);
        expect(r.porRegra[0]).toEqual({ id: 'sem-dispensa', n: 2 });
        expect(r.extracoesFalhas).toBe(1);
    });

    it('nao divide por zero sem turnos', () => {
        expect(resumir([]).percentualLimpo).toBe(0);
    });
});
