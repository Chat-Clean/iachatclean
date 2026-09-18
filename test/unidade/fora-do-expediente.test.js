import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    analisar,
    naoPrometeAtendenteForaDoExpediente,
    naoInventaHorario
} = require('../../src/domain/qualidade/analisadores.js');
const { avaliar } = require('../../src/domain/qualidade/guarda.js');
const {
    SYSTEM_SDR,
    promptResposta,
    promptPosEncaminhamento,
    respostaPadraoPosEncaminhamento,
    mensagemEncaminhamentoSuporte
} = require('../../prompts.js');

// Queixa real: depois das 18h o bot dizia "ele entra aqui rapidinho" e o lead
// ficava esperando um atendente que so aparecia no dia seguinte.
const FECHADO = { aberto: false, motivo: 'fora do horário (noite)', proximoExpediente: 'amanhã às 9h' };
const ABERTO = { aberto: true, motivo: null, proximoExpediente: null };
const CTX_FECHADO = { expedienteAberto: false, proximoExpediente: 'amanhã às 9h' };
const CTX_ABERTO = { expedienteAberto: true, proximoExpediente: null };

const ID = 'nao-promete-atendente-fora-do-expediente';
const prometeAlguem = (texto, ctx = CTX_FECHADO) => !naoPrometeAtendenteForaDoExpediente(texto, ctx).ok;

describe('fora do expediente, o bot nao promete atendente a caminho', () => {
    it('barra as frases do roteiro antigo', () => {
        expect(prometeAlguem('Perfeito! Já estou repassando tudo para um especialista da ChatClean. Ele entra aqui rapidinho para te atender melhor, combinado?')).toBe(true);
        expect(prometeAlguem('Já repassei tudo pro nosso especialista, ele entra em contato aqui rapidinho.')).toBe(true);
        expect(prometeAlguem('Fico por aqui enquanto o especialista chega.')).toBe(true);
    });

    it('barra outras formas de chegada imediata', () => {
        expect(prometeAlguem('O especialista já vai falar com você pra resolver isso.')).toBe(true);
        expect(prometeAlguem('Nosso time já te chama por aqui.')).toBe(true);
        expect(prometeAlguem('Ele já está a caminho!')).toBe(true);
        expect(prometeAlguem('Em instantes alguém do time fala com você.')).toBe(true);
        expect(prometeAlguem('Daqui a pouco o especialista responde.')).toBe(true);
    });

    it('permite dizer quando o time volta', () => {
        expect(prometeAlguem('Deixei tudo registrado. Nosso time retorna amanhã às 9h e fala com você por aqui.')).toBe(false);
        expect(prometeAlguem('Já estou repassando tudo para um especialista.')).toBe(false);
    });

    it('nao confunde conversa comum com promessa', () => {
        expect(prometeAlguem('Oi! Sou do time comercial da ChatClean. Como posso te ajudar rapidinho?')).toBe(false);
        expect(prometeAlguem('Você já falou com alguém do nosso time antes?')).toBe(false);
    });

    it('dentro do expediente, nada muda', () => {
        expect(prometeAlguem('Ele entra aqui rapidinho para te atender melhor.', CTX_ABERTO)).toBe(false);
    });

    it('sem contexto de expediente (eval, chamadas antigas), nao reprova', () => {
        expect(naoPrometeAtendenteForaDoExpediente('Ele entra aqui rapidinho.').ok).toBe(true);
    });
});

describe('guarda fora do expediente', () => {
    it('trata a promessa como critica e pede correcao com o horario de retorno', () => {
        const r = avaliar('Ele entra aqui rapidinho pra te atender melhor.', CTX_FECHADO);
        expect(r.ok).toBe(false);
        expect(r.corrigiveis.map((v) => v.id)).toContain(ID);
        expect(r.instrucaoDeCorrecao).toMatch(/amanhã às 9h/);
    });

    it('a resposta segura diz quando o time volta e nao quebra nenhuma regra critica', () => {
        const r = avaliar('Ele entra aqui rapidinho pra te atender melhor.', CTX_FECHADO);
        expect(r.respostaSegura).toMatch(/amanhã às 9h/);
        expect(avaliar(r.respostaSegura, CTX_FECHADO).ok).toBe(true);
    });
});

// Fora do expediente o bot PRECISA dizer "o time retorna amanha as 9h". A guarda
// de horario inventado barrava isso e trocava por "ja te passo os horarios".
describe('horas do expediente nao sao horario de reuniao inventado', () => {
    it('fora do expediente, permite citar a volta do time e o horario comercial', () => {
        expect(naoInventaHorario('Nosso time retorna amanhã às 9h.', CTX_FECHADO).ok).toBe(true);
        expect(naoInventaHorario('A gente atende de segunda a sexta, das 9h às 18h.', CTX_FECHADO).ok).toBe(true);
    });

    it('fora do expediente, continua barrando horario de reuniao inventado', () => {
        expect(naoInventaHorario('Tenho 10h ou 14h livres amanhã, qual prefere?', CTX_FECHADO).ok).toBe(false);
    });

    it('dentro do expediente, a regra segue como era', () => {
        expect(naoInventaHorario('Nosso time retorna amanhã às 9h.', CTX_ABERTO).ok).toBe(false);
    });
});

describe('mensagens fixas respeitam o expediente', () => {
    const semViolacaoCritica = (texto) => avaliar(texto, CTX_FECHADO).ok;

    it('resposta padrao pos-encaminhamento, fora do horario, diz quando o time volta', () => {
        const msg = respostaPadraoPosEncaminhamento(FECHADO);
        expect(msg).toMatch(/amanhã às 9h/);
        expect(semViolacaoCritica(msg)).toBe(true);
    });

    it('resposta padrao pos-encaminhamento, no horario, segue a de sempre', () => {
        expect(respostaPadraoPosEncaminhamento(ABERTO)).toMatch(/rapidinho/);
    });

    it('encaminhamento ao Suporte, fora do horario, nao promete que ja cuida', () => {
        const msg = mensagemEncaminhamentoSuporte(FECHADO);
        expect(msg).not.toMatch(/já cuida/);
        expect(msg).toMatch(/amanhã às 9h/);
        expect(semViolacaoCritica(msg)).toBe(true);
    });

    it('encaminhamento ao Suporte, no horario, segue o de sempre', () => {
        expect(mensagemEncaminhamentoSuporte(ABERTO)).toMatch(/já cuida disso com você/);
    });
});

describe('prompts respeitam o expediente', () => {
    it('pos-encaminhamento fora do horario proibe prometer atendimento agora', () => {
        const p = promptPosEncaminhamento({ mensagemCliente: 'e o preco?', expediente: FECHADO });
        expect(p).toMatch(/FORA do horário/);
        expect(p).toMatch(/amanhã às 9h/);
        expect(p).not.toMatch(/já vai falar com o cliente/);
    });

    it('pos-encaminhamento no horario segue mandando dizer que o especialista ja vai falar', () => {
        const p = promptPosEncaminhamento({ mensagemCliente: 'e o preco?', expediente: ABERTO });
        expect(p).toMatch(/já vai falar com o cliente/);
        expect(p).not.toMatch(/FORA do horário/);
    });

    it('resposta no meio da conversa, fora do horario, ganha a restricao', () => {
        const lead = { nome: 'Joao', conversationHistory: [] };
        const fechado = promptResposta({ isInicioConversa: false, mensagemSanitizada: 'tem alguem ai?', proximoCampo: null, leadData: lead, expediente: FECHADO });
        const aberto = promptResposta({ isInicioConversa: false, mensagemSanitizada: 'tem alguem ai?', proximoCampo: null, leadData: lead, expediente: ABERTO });
        expect(fechado).toMatch(/FORA do horário do time/);
        expect(aberto).not.toMatch(/FORA do horário do time/);
    });

    it('o prompt-mestre nao ensina mais "enquanto o especialista chega"', () => {
        expect(SYSTEM_SDR).not.toMatch(/enquanto o especialista chega/);
    });
});

describe('analisar inclui a regra nova', () => {
    it('aparece entre as violacoes quando fora do expediente', () => {
        const ids = analisar('Ele entra aqui rapidinho.', CTX_FECHADO).violacoes.map((v) => v.id);
        expect(ids).toContain(ID);
    });
});
