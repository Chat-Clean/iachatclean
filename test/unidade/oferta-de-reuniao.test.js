import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { pediuReuniaoAgora, deveOferecerReuniao, ofertaDepoisDaResposta } = require('../../flow.js');
const { promptExtracao } = require('../../prompts.js');

// Spec 0002. Caso real: o lead demonstrou interesse e pediu reuniao, e o bot
// respondeu que "um especialista ja vai falar com voce e combinar o horario".
describe('pediuReuniaoAgora (CA-001)', () => {
    it('"reuniao com um especialista": a extracao marca humano E agendar -> e reuniao', () => {
        expect(pediuReuniaoAgora({ querFalarComHumano: true, querAgendar: true })).toBe(true);
    });

    it('"gostei, quero conversar com voces pra fechar": interesse -> e reuniao', () => {
        expect(pediuReuniaoAgora({ querFalarComHumano: true, demonstrouInteresse: true })).toBe(true);
    });

    it('"quero falar com uma pessoa de verdade", sem reuniao -> nao e', () => {
        expect(pediuReuniaoAgora({ querFalarComHumano: true, querAgendar: false })).toBe(false);
        expect(pediuReuniaoAgora(null)).toBe(false);
    });
});

describe('deveOferecerReuniao', () => {
    it('CA-002: interesse demonstrado oferece a reuniao no meio da qualificacao', () => {
        expect(deveOferecerReuniao({ demonstrouInteresse: true }, {})).toBe(true);
    });

    it('reuniao ja oferecida e aguardando escolha nao reoferece', () => {
        expect(deveOferecerReuniao({ demonstrouInteresse: true, aguardandoEscolhaSlot: true }, { querAgendar: true })).toBe(false);
    });

    it('CA-004: recusou a reuniao, interesse sozinho nao reoferece; pedido explicito sim', () => {
        const lead = { demonstrouInteresse: true, recusouReuniao: true };
        expect(deveOferecerReuniao(lead, {})).toBe(false);
        expect(deveOferecerReuniao(lead, { querAgendar: true })).toBe(true);
    });

    it('mantem os gatilhos de antes: fim da qualificacao e pedido explicito', () => {
        expect(deveOferecerReuniao({ qualificacaoCompleta: true }, {})).toBe(true);
        expect(deveOferecerReuniao({}, { querAgendar: true })).toBe(true);
        expect(deveOferecerReuniao({}, {})).toBe(false);
    });

    it('reuniao ja agendada nunca reoferece', () => {
        expect(deveOferecerReuniao({ reuniaoAgendada: { id: 'x' }, qualificacaoCompleta: true }, { querAgendar: true })).toBe(false);
    });
});

// CA-003: "tenho interesse, como faco pra contratar?" -> responde e oferece no MESMO turno.
describe('ofertaDepoisDaResposta (CA-003)', () => {
    it('interesse com pergunta: a agenda vai depois da resposta', () => {
        expect(ofertaDepoisDaResposta({ demonstrouInteresse: true }, { perguntou: true })).toBe(true);
    });

    it('interesse sem pergunta: a agenda sai direto, nao depois', () => {
        expect(ofertaDepoisDaResposta({ demonstrouInteresse: true }, { perguntou: false })).toBe(false);
        expect(deveOferecerReuniao({ demonstrouInteresse: true }, { perguntou: false })).toBe(true);
    });

    it('pedido explicito ou qualificacao completa: comportamento de antes, agenda direto', () => {
        expect(ofertaDepoisDaResposta({ demonstrouInteresse: true }, { perguntou: true, querAgendar: true })).toBe(false);
        expect(ofertaDepoisDaResposta({ qualificacaoCompleta: true }, { perguntou: true })).toBe(false);
    });

    it('sem interesse nao ha oferta nenhuma', () => {
        expect(ofertaDepoisDaResposta({}, { perguntou: true })).toBe(false);
    });
});

describe('prompt de resposta com oferta em seguida', () => {
    const { promptResposta } = require('../../prompts.js');
    const montar = (extra) => promptResposta({
        isInicioConversa: false, mensagemSanitizada: 'como faço pra contratar?', proximoCampo: null,
        leadData: { conversationHistory: [], ...extra }, expediente: { aberto: true, proximoExpediente: 'amanhã' }
    });

    it('avisa o modelo para nao terminar com pergunta quando a agenda vem depois', () => {
        expect(montar({ ofertaDeReuniaoEmSeguida: true })).toMatch(/o SISTEMA vai oferecer os horários de reunião/);
        expect(montar({})).not.toMatch(/o SISTEMA vai oferecer os horários de reunião/);
    });
});

describe('prompt de extracao (CA-005)', () => {
    it('pede o campo demonstrouInteresse e liga reuniao com especialista a querAgendar', () => {
        const p = promptExtracao({ mensagemSanitizada: 'gostei', campoAtual: 'dor' });
        expect(p).toMatch(/- demonstrouInteresse:/);
        expect(p).toMatch(/REUNIÃO, call ou conversa marcada com o especialista ou com o time comercial, marque também querAgendar/);
    });
});
