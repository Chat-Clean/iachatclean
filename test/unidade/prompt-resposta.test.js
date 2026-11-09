import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { SYSTEM_SDR, promptResposta } = require('../../prompts.js');

const EXP = { aberto: true, proximoExpediente: 'amanhã de manhã' };

function montar(conversationHistory, extra = {}) {
    return promptResposta({
        isInicioConversa: false,
        mensagemSanitizada: 'tô aqui em Natal-RN',
        proximoCampo: { campo: 'dor', pergunta: 'Me fala um pouco no que está acontecendo na sua empresa?' },
        leadData: { conversationHistory, nome: 'Rafael', ...extra },
        expediente: EXP
    });
}

describe('prompt de resposta contra pergunta repetida', () => {
    // CA-004 (spec 0001): caso real do eval com gpt-6-luna.
    it('lista as perguntas ja feitas e manda nao repetir', () => {
        const p = montar([
            { role: 'user', content: 'a gente instala painel solar' },
            { role: 'assistant', content: 'Entendi. O que está acontecendo na empresa e quais são as principais dores?' }
        ]);
        expect(p).toContain('Perguntas que você JÁ fez nesta conversa: "O que está acontecendo na empresa e quais são as principais dores?"');
        expect(p).toMatch(/NÃO repita nenhuma delas/);
    });

    it('sem pergunta anterior, nao inclui a linha', () => {
        const p = montar([{ role: 'assistant', content: 'Oi! Sou do time comercial da ChatClean.' }]);
        expect(p).not.toContain('Perguntas que você JÁ fez');
    });

    it('nao duplica pergunta igual e guarda so as mais recentes', () => {
        const historico = ['A?', 'B?', 'A?', 'C?', 'D?', 'E?'].map((q) => ({ role: 'assistant', content: 'Certo. Pergunta ' + q }));
        const p = montar(historico);
        const linha = p.split('\n').find((l) => l.includes('Perguntas que você JÁ fez'));
        // Ordem de ultima ocorrencia: B, A, C, D, E. Ficam as 4 mais recentes.
        expect(linha.match(/"Pergunta [A-E]\?"/g)).toEqual(['"Pergunta A?"', '"Pergunta C?"', '"Pergunta D?"', '"Pergunta E?"']);
    });

    it('a pergunta do fluxo vai como assunto, nao como texto para copiar', () => {
        expect(montar([])).toMatch(/O texto abaixo diz o ASSUNTO, não é para copiar/);
    });
});

describe('SYSTEM_SDR contra revelacao de IA', () => {
    // CA-005 (spec 0001): "tem um humano do outro lado?" virou "atendimento virtual".
    it('cobre a pergunta sobre humano do outro lado e proibe "atendimento virtual"', () => {
        expect(SYSTEM_SDR).toMatch(/se tem um humano do outro lado/);
        expect(SYSTEM_SDR).toMatch(/"atendimento virtual"/);
    });
});
