import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resumoSeguro, PROIBIDOS } = require('../../src/shared/resumoDePayload.js');

// Payload real de producao (WABA via ChatClean), reduzido. O log de payload
// bruto despejava tudo isto no stdout, a cada mensagem.
const PAYLOAD = {
    message: {
        id: 'f04f84bd-36b4-4f1a-966e-7c41a4f3eeb0',
        body: '/reset',
        fromMe: false,
        note: false,
        mediaType: 'text',
        messageId: 'wamid.HBgMNTU4NDk0NjEwODQ1FQIAEhgg',
        contactId: 623328,
        raw: { from: '558494610845', type: 'text', text: { body: '/reset' } },
        ticket: {
            status: 'pending',
            channel: 'waba',
            lastMessage: 'Eae',
            contact: {
                name: 'Fabrício Weslley',
                number: '558494610845',
                lid: '14079406125304',
                profilePicUrl: 'https://exemplo.invalid/contact-558494610845.jpg'
            }
        }
    }
};

describe('resumo seguro do payload', () => {
    const resumo = resumoSeguro(PAYLOAD, 'application/json');
    const serializado = JSON.stringify(resumo);

    it('nao vaza o telefone do lead', () => {
        expect(serializado).not.toContain('558494610845');
    });

    it('nao vaza o nome, a foto nem o wamid', () => {
        expect(serializado).not.toContain('Fabrício');
        expect(serializado).not.toContain('profilePicUrl');
        expect(serializado).not.toContain('wamid');
    });

    it('nao vaza o conteudo da mensagem', () => {
        expect(serializado).not.toContain('/reset');
        expect(serializado).not.toContain('Eae');
    });

    it('nenhum campo proibido aparece no resumo', () => {
        for (const campo of PROIBIDOS) {
            expect(serializado).not.toContain('"' + campo + '"');
        }
    });

    it('preserva o que serve para diagnosticar', () => {
        expect(resumo.tipo).toBe('text');
        expect(resumo.canal).toBe('waba');
        expect(resumo.statusTicket).toBe('pending');
        expect(resumo.temRaw).toBe(true);
        expect(resumo.temMessage).toBe(true);
        expect(resumo.fromMe).toBe(false);
        expect(resumo.idInterno).toBe('f04f84bd-36b4-4f1a-966e-7c41a4f3eeb0');
        expect(resumo.bytes).toBeGreaterThan(0);
    });

    it('nao quebra com payload vazio, nulo ou de formato estranho', () => {
        expect(() => resumoSeguro(null)).not.toThrow();
        expect(() => resumoSeguro('texto solto')).not.toThrow();
        expect(resumoSeguro({}).temMessage).toBe(false);
        expect(resumoSeguro(null).contentType).toBe('sem content-type');
    });
});
