import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const a = require('../../src/domain/qualidade/analisadores.js');

// Atalho: roda um analisador e devolve so o ok.
const ok = (fn, texto, ctx) => fn(texto, ctx).ok;

describe('estilo', () => {
    it('aceita ate duas linhas e recusa tres', () => {
        expect(ok(a.noMaximoDuasLinhas, 'uma linha')).toBe(true);
        expect(ok(a.noMaximoDuasLinhas, 'uma\nduas')).toBe(true);
        expect(ok(a.noMaximoDuasLinhas, 'uma\nduas\ntres')).toBe(false);
    });

    it('ignora linhas em branco na contagem', () => {
        expect(ok(a.noMaximoDuasLinhas, 'uma\n\n\nduas')).toBe(true);
    });

    it('conta emoji por code point, nao por par substituto', () => {
        expect(a.contarEmojis('oi 😊')).toBe(1);
        expect(a.contarEmojis('oi 😊 tudo bem 🙂')).toBe(2);
    });

    // O negocio pediu ZERO emoji: um ja e violacao.
    it('nao tolera nenhum emoji', () => {
        expect(ok(a.semEmoji, 'oi, tudo bem?')).toBe(true);
        expect(ok(a.semEmoji, 'oi 😊')).toBe(false);
        expect(ok(a.semEmoji, 'oi 😊🙂')).toBe(false);
    });

    it('pega markdown que o WhatsApp nao renderiza', () => {
        expect(ok(a.semMarkdown, 'texto normal')).toBe(true);
        expect(ok(a.semMarkdown, 'texto **negrito**')).toBe(false);
        expect(ok(a.semMarkdown, '- item um\n- item dois')).toBe(false);
        expect(ok(a.semMarkdown, '## titulo')).toBe(false);
    });
});

describe('experiencia', () => {
    it('recusa frase de dispensa', () => {
        expect(ok(a.semFraseDeDispensa, 'Qual o nome da sua empresa?')).toBe(true);
        expect(ok(a.semFraseDeDispensa, 'Posso ajudar em mais alguma coisa?')).toBe(false);
        expect(ok(a.semFraseDeDispensa, 'Ficou alguma dúvida?')).toBe(false);
        expect(ok(a.semFraseDeDispensa, 'Se precisar é só falar!')).toBe(false);
    });

    it('recusa despedida', () => {
        expect(ok(a.naoSeDespede, 'Vou te passar pro especialista, ok?')).toBe(true);
        expect(ok(a.naoSeDespede, 'Até mais!')).toBe(false);
    });

    // SINAL, nao violacao: o prompt permite terminar so com a informacao.
    it('mede se terminou com pergunta, sem tratar como violacao', () => {
        expect(ok(a.terminaComPergunta, 'Show! Qual seu segmento?')).toBe(true);
        expect(ok(a.terminaComPergunta, 'Entendi, obrigado.')).toBe(false);
        expect(a.terminaComPergunta('Entendi, obrigado.').gravidade).toBe('info');
        // Nao pode contaminar o placar de violacoes.
        const r = a.analisar('Entendi, obrigado.');
        expect(r.ok).toBe(true);
        expect(r.sinais.map((s) => s.id)).toContain('termina-com-pergunta');
    });
});

describe('invariantes criticas', () => {
    it('recusa revelar que e IA', () => {
        expect(ok(a.naoRevelaSerIA, 'Nossa plataforma utiliza inteligência artificial baseada em ChatGPT.')).toBe(true);
        expect(ok(a.naoRevelaSerIA, 'Sou uma IA treinada pela OpenAI.')).toBe(false);
        expect(ok(a.naoRevelaSerIA, 'Como modelo de linguagem, nao posso.')).toBe(false);
    });

    it('recusa revelar preco', () => {
        expect(ok(a.naoRevelaPreco, 'Os valores variam conforme a necessidade.')).toBe(true);
        expect(ok(a.naoRevelaPreco, 'Custa R$ 500 por mês.')).toBe(false);
        expect(ok(a.naoRevelaPreco, 'Fica 1.200 reais.')).toBe(false);
        expect(ok(a.naoRevelaPreco, 'custa 300 no plano basico')).toBe(false);
    });

    // Nao pode confundir numero de horario/volume com preco.
    it('nao acusa preco em numero que nao e valor', () => {
        expect(ok(a.naoRevelaPreco, 'Tenho horário às 14h ou 15h, qual prefere?')).toBe(true);
        expect(ok(a.naoRevelaPreco, 'Você recebe uns 400 atendimentos por mês?')).toBe(true);
    });

    it('recusa afirmar que agendou', () => {
        expect(ok(a.naoAfirmaAgendamento, 'Escolha um dos horários pelo número, pode ser?')).toBe(true);
        expect(ok(a.naoAfirmaAgendamento, 'Pronto, agendei para as 14h!')).toBe(false);
        expect(ok(a.naoAfirmaAgendamento, 'Sua reunião está marcada.')).toBe(false);
    });

    it('recusa negar leitura de link e de imagem', () => {
        expect(ok(a.naoNegaLerLinks, 'Sobre o que você perguntou, funciona sim!')).toBe(true);
        expect(ok(a.naoNegaLerLinks, 'Não consigo acessar esse link.')).toBe(false);
        expect(ok(a.naoNegaVerImagens, 'Vi o print, é uma conversa de atendimento.')).toBe(true);
        expect(ok(a.naoNegaVerImagens, 'Desculpe, não consigo ver imagens.')).toBe(false);
    });
});

describe('analisadores com contexto', () => {
    it('recusa nome repetido em mensagens seguidas', () => {
        const ctx = { primeiroNome: 'Rafael', usouNomeNaAnterior: true };
        expect(ok(a.naoRepeteNomeSeguidamente, 'Rafael, qual seu segmento?', ctx)).toBe(false);
        expect(ok(a.naoRepeteNomeSeguidamente, 'Qual seu segmento?', ctx)).toBe(true);
    });

    it('aceita o nome quando nao foi usado na anterior', () => {
        const ctx = { primeiroNome: 'Rafael', usouNomeNaAnterior: false };
        expect(ok(a.naoRepeteNomeSeguidamente, 'Rafael, qual seu segmento?', ctx)).toBe(true);
    });

    it('nao aplica a regra sem nome conhecido', () => {
        expect(ok(a.naoRepeteNomeSeguidamente, 'qualquer coisa', { primeiroNome: '' })).toBe(true);
    });

    it('detecta pergunta repetida com outras palavras', () => {
        const ctx = { perguntasAnteriores: ['Qual o nome da sua empresa?'] };
        expect(ok(a.naoRepetePergunta, 'Me diz o nome da empresa?', ctx)).toBe(false);
        expect(ok(a.naoRepetePergunta, 'Qual seu segmento de atuação?', ctx)).toBe(true);
    });
});

describe('semelhantes', () => {
    it('reconhece a mesma pergunta reescrita', () => {
        expect(a.semelhantes('Qual o nome da sua empresa?', 'Qual o nome da empresa?')).toBe(true);
    });

    it('separa perguntas de assuntos diferentes', () => {
        expect(a.semelhantes('Qual seu nome?', 'Qual sua cidade?')).toBe(false);
    });
});

describe('analisar (execucao completa)', () => {
    it('aprova uma resposta ideal', () => {
        const r = a.analisar('Show! Me conta o que mais te incomoda hoje?');
        expect(r.ok).toBe(true);
        expect(r.violacoes).toHaveLength(0);
    });

    it('acumula multiplas violacoes e classifica gravidade', () => {
        const r = a.analisar('Sou uma IA. Custa R$ 500.\n**negrito**\nPosso ajudar em mais alguma coisa? 😊🙂');
        const ids = r.violacoes.map((v) => v.id);
        expect(ids).toContain('nao-revela-ser-ia');
        expect(ids).toContain('nao-revela-preco');
        expect(ids).toContain('sem-dispensa');
        expect(ids).toContain('max-2-linhas');
        expect(ids).toContain('sem-emoji');
        expect(r.violacoes.some((v) => v.gravidade === 'critica')).toBe(true);
    });

    it('todo resultado traz id e gravidade', () => {
        for (const res of a.analisar('Qual seu nome?').resultados) {
            expect(res.id).toBeTruthy();
            expect(['critica', 'alta', 'media', 'info']).toContain(res.gravidade);
        }
    });
});
