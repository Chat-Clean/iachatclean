// Verifica que a propria rede de seguranca funciona. Um setup que nao bloqueia
// a rede da falsa confianca a todos os outros testes.
import { describe, it, expect } from 'vitest';

describe('ferramental da suite', () => {
    it('bloqueia chamada de rede', () => {
        expect(() => globalThis.fetch('https://exemplo.invalido')).toThrow(/rede/i);
    });

    it('roda com NODE_ENV de teste', () => {
        expect(process.env.NODE_ENV).toBe('test');
    });
});
