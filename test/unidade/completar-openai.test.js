import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { criarCompletar } = require('../../src/infrastructure/openai/completar.js');

// Cliente falso: recusa os parametros listados, como a API faz com status 400.
// Com `soNoModelo`, a recusa vale apenas para aquele modelo.
function clienteQueRecusa(recusa = [], soNoModelo = null) {
    const pedidos = [];
    return {
        pedidos,
        chat: { completions: { create: async (p, opcoes) => {
            pedidos.push({ p, opcoes });
            const r = (!soNoModelo || p.model === soNoModelo) && recusa.find((k) => k in p);
            if (r) throw new Error(`400 Unsupported parameter: '${r}' is not supported with this model.`);
            return { choices: [{ message: { content: 'ok' } }] };
        } } }
    };
}

const enviados = (cliente) => cliente.pedidos.map((x) => x.p);

describe('completar compativel entre geracoes de modelo', () => {
    it('modelo antigo: manda temperature e nao manda reasoning_effort vazio', async () => {
        const cliente = clienteQueRecusa(['reasoning_effort']);
        const { completar } = criarCompletar({ cliente });
        await completar({ model: 'gpt-4.1-mini', messages: [], temperature: 0.7, reasoning_effort: '' });
        expect(enviados(cliente)).toEqual([{ model: 'gpt-4.1-mini', messages: [], temperature: 0.7 }]);
    });

    it('modelo de raciocinio: tira temperature na recusa e mantem o esforco', async () => {
        const cliente = clienteQueRecusa(['temperature']);
        const { completar } = criarCompletar({ cliente });
        const r = await completar({ model: 'gpt-6-luna', messages: [], temperature: 0.7, reasoning_effort: 'max' });
        expect(r.choices[0].message.content).toBe('ok');
        expect(enviados(cliente).at(-1)).toEqual({ model: 'gpt-6-luna', messages: [], reasoning_effort: 'max' });
    });

    it('aprende a recusa: a segunda chamada ao mesmo modelo nao repete o erro', async () => {
        const cliente = clienteQueRecusa(['temperature']);
        const { completar } = criarCompletar({ cliente });
        await completar({ model: 'gpt-6-luna', messages: [], temperature: 0 });
        await completar({ model: 'gpt-6-luna', messages: [], temperature: 0 });
        expect(cliente.pedidos).toHaveLength(3); // 2 na primeira, 1 na segunda
        expect(enviados(cliente)[2]).not.toHaveProperty('temperature');
    });

    it('a recusa de um modelo nao contamina outro', async () => {
        const cliente = clienteQueRecusa(['temperature'], 'gpt-6-luna');
        const { completar } = criarCompletar({ cliente });
        await completar({ model: 'gpt-6-luna', messages: [], temperature: 0 });
        await completar({ model: 'gpt-4o-mini', messages: [], temperature: 0 });
        expect(enviados(cliente).at(-1)).toHaveProperty('temperature', 0);
    });

    it('avisa quando o modelo recusa um parametro', async () => {
        const aviso = vi.fn();
        const { completar } = criarCompletar({ cliente: clienteQueRecusa(['reasoning_effort']), aviso });
        await completar({ model: 'gpt-4o', messages: [], reasoning_effort: 'max' });
        expect(aviso).toHaveBeenCalledWith(expect.stringMatching(/gpt-4o recusou reasoning_effort/));
    });

    // Caso real: mensagem exata da API para o gpt-6-luna na Chat Completions.
    function clienteSemMax() {
        const pedidos = [];
        return {
            pedidos,
            chat: { completions: { create: async (p) => {
                pedidos.push(p);
                if (p.reasoning_effort === 'max') {
                    throw new Error("400 Unsupported value: 'reasoning_effort' does not support 'max' with this model. Supported values are: 'none', 'low', 'medium', 'high', and 'xhigh'.");
                }
                return { choices: [{ message: { content: 'ok' } }] };
            } } }
        };
    }

    it('valor de esforco recusado vira o maior suportado, sem perder o parametro', async () => {
        const cliente = clienteSemMax();
        const aviso = vi.fn();
        const { completar } = criarCompletar({ cliente, aviso });
        await completar({ model: 'gpt-6-luna', messages: [], reasoning_effort: 'max' });
        expect(cliente.pedidos.map((p) => p.reasoning_effort)).toEqual(['max', 'xhigh']);
        expect(aviso).toHaveBeenCalledWith(expect.stringMatching(/nao aceita esforco "max"; usando "xhigh"/));
    });

    it('aprende o substituto e nao contamina os outros esforcos do mesmo modelo', async () => {
        const cliente = clienteSemMax();
        const { completar } = criarCompletar({ cliente });
        await completar({ model: 'gpt-6-luna', messages: [], reasoning_effort: 'max' });
        await completar({ model: 'gpt-6-luna', messages: [], reasoning_effort: 'max' });
        await completar({ model: 'gpt-6-luna', messages: [], reasoning_effort: 'low' });
        expect(cliente.pedidos.map((p) => p.reasoning_effort)).toEqual(['max', 'xhigh', 'xhigh', 'low']);
    });

    it('erro que nao e de parametro opcional sobe para o chamador', async () => {
        const cliente = { chat: { completions: { create: async () => { throw new Error('401 Incorrect API key provided'); } } } };
        const { completar } = criarCompletar({ cliente });
        await expect(completar({ model: 'gpt-6-luna', messages: [], temperature: 0 })).rejects.toThrow(/Incorrect API key/);
    });
});

describe('completarNoPrazo', () => {
    afterEach(() => vi.useRealTimers());

    // Cliente falso que "demora": estoura o timeout pedido quando o esforco e lento.
    function clienteComDemora(demoraPorEsforco) {
        const pedidos = [];
        return {
            pedidos,
            chat: { completions: { create: async (p, opcoes) => {
                pedidos.push({ p, opcoes });
                const demora = demoraPorEsforco[p.reasoning_effort] ?? 0;
                if (opcoes?.timeout && demora > opcoes.timeout) throw new Error('Request timed out.');
                vi.advanceTimersByTime(demora);
                return { choices: [{ message: { content: `resposta ${p.reasoning_effort}` } }] };
            } } }
        };
    }

    it('usa o esforco maximo quando ele cabe no prazo', async () => {
        vi.useFakeTimers();
        const cliente = clienteComDemora({ max: 20000, low: 3000 });
        const { completarNoPrazo } = criarCompletar({ cliente });
        const r = await completarNoPrazo(
            { model: 'gpt-6-luna', messages: [], reasoning_effort: 'max' },
            { ate: Date.now() + 30000, reservaMs: 8000 }
        );
        expect(r.choices[0].message.content).toBe('resposta max');
        expect(cliente.pedidos[0].opcoes).toEqual({ timeout: 22000, maxRetries: 0 });
    });

    it('estourou o prazo: refaz com o esforco rapido dentro da reserva', async () => {
        vi.useFakeTimers();
        const cliente = clienteComDemora({ max: 60000, low: 3000 });
        const aviso = vi.fn();
        const { completarNoPrazo } = criarCompletar({ cliente, aviso });
        const r = await completarNoPrazo(
            { model: 'gpt-6-luna', messages: [], reasoning_effort: 'max' },
            { ate: Date.now() + 30000, reservaMs: 8000 }
        );
        expect(r.choices[0].message.content).toBe('resposta low');
        expect(cliente.pedidos.map((x) => x.p.reasoning_effort)).toEqual(['max', 'low']);
        expect(aviso).toHaveBeenCalledWith(expect.stringMatching(/refazendo com "low"/));
    });

    it('prazo ja no fim: vai direto para o esforco rapido', async () => {
        vi.useFakeTimers();
        const cliente = clienteComDemora({ max: 20000, low: 3000 });
        const { completarNoPrazo } = criarCompletar({ cliente });
        await completarNoPrazo(
            { model: 'gpt-6-luna', messages: [], reasoning_effort: 'max' },
            { ate: Date.now() + 5000, reservaMs: 8000 }
        );
        expect(cliente.pedidos.map((x) => x.p.reasoning_effort)).toEqual(['low']);
    });

    it('erro que nao e de prazo nao dispara a tentativa rapida', async () => {
        const cliente = { chat: { completions: { create: async () => { throw new Error('500 Internal error'); } } } };
        const { completarNoPrazo } = criarCompletar({ cliente });
        await expect(completarNoPrazo(
            { model: 'gpt-6-luna', messages: [], reasoning_effort: 'max' },
            { ate: Date.now() + 30000, reservaMs: 8000 }
        )).rejects.toThrow(/500/);
    });
});
