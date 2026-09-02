import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { removerEmojis } = require('../../src/shared/semEmoji.js');

describe('remocao de emoji do texto ao lead', () => {
    it('tira o emoji do fim da frase sem deixar espaco solto', () => {
        expect(removerEmojis('Tudo bem? 😊')).toBe('Tudo bem?');
        expect(removerEmojis('Beleza! 🙂')).toBe('Beleza!');
    });

    it('tira emoji do meio da frase', () => {
        expect(removerEmojis('Opa 😅 pode repetir?')).toBe('Opa pode repetir?');
    });

    it('tira sequencias compostas (tom de pele, ZWJ, bandeira)', () => {
        expect(removerEmojis('Oi 👋🏽 tudo bem?')).toBe('Oi tudo bem?');
        expect(removerEmojis('Time 👨‍💻 pronto')).toBe('Time pronto');
    });

    it('preserva acento, pontuacao e quebra de linha', () => {
        expect(removerEmojis('Olá, João!\nComo vai?')).toBe('Olá, João!\nComo vai?');
    });

    it('nao mexe em texto sem emoji', () => {
        const t = 'Vou confirmar a agenda do time e já te retorno.';
        expect(removerEmojis(t)).toBe(t);
    });

    it('tolera vazio, nulo e nao-string', () => {
        expect(removerEmojis('')).toBe('');
        expect(removerEmojis(null)).toBe(null);
        expect(removerEmojis(undefined)).toBe(undefined);
    });
});
