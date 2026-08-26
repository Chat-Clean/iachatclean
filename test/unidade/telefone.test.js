import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { normalizarPhone, nucleoNumero, contatoPermitido } = require('../../src/shared/telefone.js');

describe('normalizarPhone', () => {
    it('mantem um numero que ja vem limpo', () => {
        expect(normalizarPhone('5584994610845')).toBe('5584994610845');
    });

    it('corta o servidor do JID', () => {
        expect(normalizarPhone('558494610845@s.whatsapp.net')).toBe('558494610845');
    });

    // Regressao: sem cortar o ':60' antes de limpar, o 60 grudaria no numero e
    // o lead viraria outro registro no Redis. E o formato que o webhook do
    // ChatClean entrega em raw.Info.SenderAlt.
    it('corta o id do dispositivo antes de limpar', () => {
        expect(normalizarPhone('558494610845:60@s.whatsapp.net')).toBe('558494610845');
        expect(normalizarPhone('558491756446:24@s.whatsapp.net')).toBe('558491756446');
    });

    it('descarta mascara e espacos', () => {
        expect(normalizarPhone('+55 (84) 99461-0845')).toBe('5584994610845');
    });

    it('nao explode com valor ausente', () => {
        expect(normalizarPhone(null)).toBe('');
        expect(normalizarPhone(undefined)).toBe('');
    });
});

describe('nucleoNumero', () => {
    it('remove o nono digito de celular BR de 13 digitos', () => {
        expect(nucleoNumero('5584994610845')).toBe('558494610845');
    });

    it('deixa intacto o numero de 12 digitos', () => {
        expect(nucleoNumero('558494610845')).toBe('558494610845');
    });

    it('faz as duas formas do mesmo celular convergirem', () => {
        expect(nucleoNumero('5584994610845')).toBe(nucleoNumero('558494610845'));
    });

    it('nao mexe em numero que nao e BR', () => {
        expect(nucleoNumero('14079406125304')).toBe('14079406125304');
    });

    it('nao remove digito quando a posicao 4 nao e 9', () => {
        expect(nucleoNumero('5584812345678')).toBe('5584812345678');
    });
});

describe('contatoPermitido', () => {
    it('libera todos quando a lista esta vazia ou ausente', () => {
        expect(contatoPermitido('5511999998888', [])).toBe(true);
        expect(contatoPermitido('5511999998888', null)).toBe(true);
        expect(contatoPermitido('5511999998888', undefined)).toBe(true);
    });

    it('aceita quem esta na lista', () => {
        expect(contatoPermitido('5584994610845', ['5584994610845'])).toBe(true);
    });

    it('recusa quem nao esta', () => {
        expect(contatoPermitido('5511999998888', ['5584994610845'])).toBe(false);
    });

    it('tolera o nono digito nos dois lados da comparacao', () => {
        expect(contatoPermitido('558494610845', ['5584994610845'])).toBe(true);
        expect(contatoPermitido('5584994610845', ['558494610845'])).toBe(true);
    });
});
