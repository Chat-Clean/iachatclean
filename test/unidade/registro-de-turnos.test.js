import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { criarRegistroDeTurnos } = require('../../src/shared/registroDeTurnos.js');

// Incidente real: o n8n desistia do turno (agrupamento 2s + chamada ao modelo)
// e reenviava a mesma mensagem. O dedupe antigo devolvia `respostas: []` e o
// lead ficava sem resposta nenhuma.
describe('registro de turnos em voo', () => {
    it('o reenvio recebe a MESMA resposta do turno original', async () => {
        const registro = criarRegistroDeTurnos();
        let execucoes = 0;
        const fabrica = () => {
            execucoes++;
            return new Promise((r) => setTimeout(() => r({ status: 'ok', resposta: 'oi!' }), 20));
        };

        const primeira = registro.obterOuCriar('msg-1', fabrica);
        const segunda = registro.obterOuCriar('msg-1', fabrica);

        expect(primeira.reenvio).toBe(false);
        expect(segunda.reenvio).toBe(true);
        expect(execucoes).toBe(1); // o turno NAO roda duas vezes

        expect(await segunda.promessa).toEqual({ status: 'ok', resposta: 'oi!' });
        expect(await primeira.promessa).toEqual(await segunda.promessa);
    });

    it('mensagem diferente executa um turno proprio', () => {
        const registro = criarRegistroDeTurnos();
        let execucoes = 0;
        const fabrica = () => { execucoes++; return Promise.resolve({}); };
        registro.obterOuCriar('msg-1', fabrica);
        registro.obterOuCriar('msg-2', fabrica);
        expect(execucoes).toBe(2);
        expect(registro.tamanho()).toBe(2);
    });

    it('sem msgId nao da para reconhecer reenvio: sempre executa', () => {
        const registro = criarRegistroDeTurnos();
        let execucoes = 0;
        const fabrica = () => { execucoes++; return Promise.resolve({}); };
        expect(registro.obterOuCriar(null, fabrica).reenvio).toBe(false);
        expect(registro.obterOuCriar(null, fabrica).reenvio).toBe(false);
        expect(execucoes).toBe(2);
        expect(registro.tamanho()).toBe(0);
    });

    it('esquece o turno depois do TTL: reenvio tardio vira turno novo', () => {
        let relogio = 1000;
        const registro = criarRegistroDeTurnos({ ttlMs: 100, agora: () => relogio });
        const fabrica = () => Promise.resolve({});
        registro.obterOuCriar('msg-1', fabrica);
        expect(registro.obterOuCriar('msg-1', fabrica).reenvio).toBe(true);
        relogio += 500; // passou do TTL
        registro.obterOuCriar('msg-2', fabrica); // dispara a poda
        expect(registro.obterOuCriar('msg-1', fabrica).reenvio).toBe(false);
    });

    it('nao cresce sem limite: respeita o maximo', () => {
        const registro = criarRegistroDeTurnos({ max: 3 });
        const fabrica = () => Promise.resolve({});
        for (let i = 0; i < 20; i++) registro.obterOuCriar('msg-' + i, fabrica);
        expect(registro.tamanho()).toBeLessThanOrEqual(3);
    });

    it('turno que falha nao vira unhandledRejection e propaga no reenvio', async () => {
        const registro = criarRegistroDeTurnos();
        const fabrica = () => Promise.reject(new Error('turno falhou'));
        const primeira = registro.obterOuCriar('msg-1', fabrica);
        const segunda = registro.obterOuCriar('msg-1', fabrica);
        expect(segunda.reenvio).toBe(true);
        await expect(primeira.promessa).rejects.toThrow('turno falhou');
        await expect(segunda.promessa).rejects.toThrow('turno falhou');
    });
});
