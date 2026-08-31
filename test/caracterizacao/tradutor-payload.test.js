// Congela o comportamento do parse de payload. Cada caso aqui foi observado em
// produção ou reproduzido contra o servidor real antes de virar teste.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { traduzir, normalizarCorpo } = require('../../src/infrastructure/chatclean/acl/tradutor.js');
const { MOTIVOS } = require('../../src/domain/mensageria/MotivoDeDescarte.js');

// Payload real do ChatClean chegando pelo n8n: array de itens, com o corpo
// verdadeiro em [0].body, ao lado de headers/query/webhookUrl.
function payloadN8n(sobrescrever = {}) {
    const msg = {
        id: 'ac6c2974-eddd-48ce-ae0d-9d0f5c9face2',
        body: 'teste',
        fromMe: false,
        note: false,
        mediaType: 'text',
        contactId: 437918,
        messageId: '3EB03144C9B9DE4AC8F5D1',
        raw: {
            Info: {
                Chat: '14079406125304@lid',
                IsGroup: false,
                SenderAlt: '558494610845:60@s.whatsapp.net',
                PushName: 'Fabrício Weslley 𓅃'
            }
        },
        ticket: {
            id: 844943,
            status: 'pending',
            isGroup: false,
            userId: null,
            contactId: 437918,
            contact: { id: 437918, name: 'Fabrício Weslley', number: '558494610845' }
        },
        ...sobrescrever
    };
    return [
        {
            headers: { 'content-type': 'application/json' },
            params: {},
            query: {},
            body: { message: msg, tenantId: 2, sessionId: 129, event: 'NewMessage' },
            webhookUrl: 'https://exemplo.invalido/webhook-test/abc',
            executionMode: 'test'
        }
    ];
}

describe('normalizarCorpo', () => {
    it('desembrulha array + envelope do n8n', () => {
        const corpo = normalizarCorpo(payloadN8n());
        expect(corpo.event).toBe('NewMessage');
        expect(corpo.message.body).toBe('teste');
    });

    it('desembrulha JSON entregue como string', () => {
        const corpo = normalizarCorpo('{"number":"5511999998888","body":"oi"}');
        expect(corpo.number).toBe('5511999998888');
    });

    it('desembrulha envelope data/payload', () => {
        expect(normalizarCorpo({ data: { number: '5511999998888', body: 'oi' } }).number).toBe('5511999998888');
        expect(normalizarCorpo({ payload: { number: '5511999998888', body: 'oi' } }).number).toBe('5511999998888');
    });

    it('devolve o corpo intacto quando nao ha envelope', () => {
        const plano = { number: '5511999998888', body: 'oi' };
        expect(normalizarCorpo(plano)).toBe(plano);
    });

    it('nao quebra com string que nao e JSON, array vazio ou nulo', () => {
        expect(normalizarCorpo('nao sou json')).toBe('nao sou json');
        expect(normalizarCorpo([])).toEqual([]);
        expect(normalizarCorpo(null)).toBe(null);
    });

    it('nao entra em laco infinito com aninhamento absurdo', () => {
        let b = { number: '5511999998888', body: 'oi' };
        for (let i = 0; i < 50; i++) b = [{ headers: {}, body: b }];
        expect(() => normalizarCorpo(b)).not.toThrow();
    });
});

describe('traduzir — formato ChatClean via n8n', () => {
    it('aceita e extrai os campos uteis', () => {
        const m = traduzir(payloadN8n());
        expect(m.aceita).toBe(true);
        expect(m.chatId).toBe('558494610845');
        expect(m.texto).toBe('teste');
        expect(m.tipo).toBe('text');
        expect(m.contactId).toBe(437918);
        expect(m.msgId).toBe('ac6c2974-eddd-48ce-ae0d-9d0f5c9face2');
    });

    // O nome limpo esta no ticket.contact; o PushName vem com enfeite.
    it('prefere o nome do contato ao PushName', () => {
        expect(traduzir(payloadN8n()).nomeContato).toBe('Fabrício Weslley');
    });

    it('cai no PushName quando nao ha contato', () => {
        const p = payloadN8n();
        delete p[0].body.message.ticket.contact;
        expect(traduzir(p).nomeContato).toBe('Fabrício Weslley 𓅃');
    });

    // Regressao: o ':60' do dispositivo nao pode grudar no numero.
    it('limpa o id do dispositivo do SenderAlt', () => {
        const p = payloadN8n();
        delete p[0].body.message.ticket.contact;
        expect(traduzir(p).chatId).toBe('558494610845');
    });

    it('usa raw.from quando e WABA (sem SenderAlt)', () => {
        const p = payloadN8n({ raw: { from: '5511977776666' } });
        delete p[0].body.message.ticket.contact;
        expect(traduzir(p).chatId).toBe('5511977776666');
    });
});

describe('traduzir — descartes', () => {
    const casos = [
        ['eco do proprio bot', payloadN8n({ fromMe: true }), MOTIVOS.ECO],
        ['nota interna', payloadN8n({ note: true }), MOTIVOS.NOTA_INTERNA],
        [
            'grupo pelo ticket',
            payloadN8n({ ticket: { status: 'pending', isGroup: true, userId: null, contact: {} } }),
            MOTIVOS.GRUPO
        ],
        [
            'humano assumiu o ticket',
            payloadN8n({ ticket: { status: 'pending', isGroup: false, userId: 282, contact: {} } }),
            MOTIVOS.TICKET_ASSUMIDO
        ],
        [
            'ticket encerrado',
            payloadN8n({ ticket: { status: 'closed', isGroup: false, userId: null, contact: {} } }),
            MOTIVOS.TICKET_ASSUMIDO
        ]
    ];

    for (const [nome, payload, motivo] of casos) {
        it(`descarta: ${nome}`, () => {
            const r = traduzir(payload);
            expect(r.aceita).toBe(false);
            expect(r.motivo).toBe(motivo);
        });
    }

    it('descarta evento que nao e NewMessage', () => {
        const p = payloadN8n();
        p[0].body.event = 'MessageAck';
        const r = traduzir(p);
        expect(r.aceita).toBe(false);
        expect(r.motivo).toBe(MOTIVOS.EVENTO_IGNORADO);
        expect(r.detalhe).toBe('MessageAck');
    });

    it('descarta grupo pelo JID @g.us', () => {
        const r = traduzir({ number: '5511999998888', body: 'oi', remoteJid: '123456@g.us' });
        expect(r.motivo).toBe(MOTIVOS.GRUPO);
    });

    it('descarta o disparo duplicado do ChatBot', () => {
        const r = traduzir({ numero_cliente: '5511999998888', mensagem_cliente: 'oi' });
        expect(r.motivo).toBe(MOTIVOS.FORMATO_DUPLICADO);
    });

    it('descarta payload sem telefone utilizavel', () => {
        const r = traduzir({ message: { body: 'oi', fromMe: false } });
        expect(r.motivo).toBe(MOTIVOS.SEM_TELEFONE);
    });

    it('descarta formato desconhecido, inclusive corpo vazio', () => {
        expect(traduzir({}).motivo).toBe(MOTIVOS.FORMATO_DESCONHECIDO);
        expect(traduzir({ foo: 'bar' }).motivo).toBe(MOTIVOS.FORMATO_DESCONHECIDO);
        expect(traduzir(null).motivo).toBe(MOTIVOS.FORMATO_DESCONHECIDO);
    });

    it('todo descarte traz descricao legivel para o log', () => {
        expect(traduzir({}).descricao).toBe('Payload não reconhecido');
        expect(traduzir(payloadN8n({ note: true })).descricao).toBe('Nota interna ignorada');
    });
});

describe('traduzir — opcoes de politica', () => {
    it('ignorarGrupos:false deixa passar mensagem de grupo', () => {
        const r = traduzir({ number: '5511999998888', body: 'oi', remoteJid: '123@g.us' }, { ignorarGrupos: false });
        expect(r.aceita).toBe(true);
    });

    it('soPendentes:false responde mesmo com humano no ticket', () => {
        const p = payloadN8n({ ticket: { status: 'pending', userId: 282, isGroup: false, contact: {} } });
        expect(traduzir(p, { soPendentes: false }).aceita).toBe(true);
    });
});

describe('traduzir — formato plano', () => {
    it('aceita o formato plano simples', () => {
        const m = traduzir({
            number: '5584994610845',
            body: 'opa, tudo bem',
            type: 'text',
            id: 'msg-1',
            contactName: 'Felix'
        });
        expect(m.aceita).toBe(true);
        expect(m.chatId).toBe('5584994610845');
        expect(m.texto).toBe('opa, tudo bem');
        expect(m.nomeContato).toBe('Felix');
    });

    it('aceita quando so ha type, sem body', () => {
        const m = traduzir({ number: '5511999998888', type: 'image', mediaUrl: 'https://exemplo.invalido/a.jpg' });
        expect(m.aceita).toBe(true);
        expect(m.tipo).toBe('image');
        expect(m.texto).toBe('');
    });

    it('normaliza o tipo "chat" para "text"', () => {
        expect(traduzir({ number: '5511999998888', body: 'oi', type: 'chat' }).tipo).toBe('text');
    });

    it('mantem tipo desconhecido para o chamador decidir', () => {
        expect(traduzir({ number: '5511999998888', body: '', type: 'sticker' }).tipo).toBe('sticker');
    });
});
