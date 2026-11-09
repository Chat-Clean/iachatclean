import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { SYSTEM_SDR, promptResposta, promptExtracao } = require('../../prompts.js');
const { deveOferecerReuniao, ofertaDepoisDaResposta, pedeEspecialista } = require('../../flow.js');
const a = require('../../src/domain/qualidade/analisadores.js');
const guarda = require('../../src/domain/qualidade/guarda.js');
const { decidirParada, respostaInstantanea, FECHOS } = require('../../src/domain/atendimento/RegrasDeParada.js');
const { montarNota } = require('../../src/domain/atendimento/NotaDoVendedor.js');

// Spec 0003: regras do documento "Como a IA deve responder" (ORB, novembro de 2026).
const montar = (leadData = {}, extra = {}) => promptResposta({
    isInicioConversa: false,
    mensagemSanitizada: 'oi',
    proximoCampo: null,
    leadData: { conversationHistory: [], ...leadData },
    expediente: { aberto: true, proximoExpediente: null },
    ...extra
});

describe('tom e formato', () => {
    it('CA-001: no maximo 3 linhas e uma pergunta por vez', () => {
        expect(SYSTEM_SDR).toMatch(/no máximo 3 linhas por mensagem e UMA pergunta por vez/);
        expect(montar()).toMatch(/máx\. 3 linhas, uma pergunta só/);
    });

    it('CA-001: duas perguntas na mesma mensagem e corrigida pela guarda', () => {
        const r = guarda.avaliar('Show! Qual sua empresa? E quem decide?', {});
        expect(r.ok).toBe(false);
        expect(r.instrucaoDeCorrecao).toMatch(/só UMA pergunta/);
    });

    it('CA-002: o nome do perfil do WhatsApp nao vai para o prompt', () => {
        const p = montar({ nomeContato: 'Chácara Boa Vista' });
        expect(p).not.toMatch(/Chácara/);
        expect(SYSTEM_SDR).toMatch(/Se ele não disse, NÃO use nome nenhum/);
    });

    it('CA-002: chamar o lead pelo nome do perfil e corrigido pela guarda', () => {
        const ctx = { nomeContato: 'Deus', primeiroNome: '' };
        expect(guarda.avaliar('Oi Deus, tudo bem? Qual o nome da sua empresa?', ctx).ok).toBe(false);
        expect(guarda.avaliar('Oi! Qual o nome da sua empresa?', ctx).ok).toBe(true);
        // Perfil com o nome da empresa que o lead disse: citar a empresa e legitimo.
        expect(a.naoUsaNomeDoPerfil('Pizzaria, legal! Quem decide?', { nomeContato: 'Pizzaria 3 Irmãos', empresa: 'Pizzaria 3 Irmãos' }).ok).toBe(true);
    });

    it('CA-003 e CA-004: proximo passo claro e nada que nao possa garantir', () => {
        expect(SYSTEM_SDR).toMatch(/toda mensagem fecha com um próximo passo claro/);
        expect(SYSTEM_SDR).toMatch(/NUNCA diga algo que você não sabe ou não pode garantir/);
    });
});

describe('abertura e qualificacao', () => {
    it('CA-005: abertura generica apresenta o comercial e pergunta a empresa', () => {
        expect(SYSTEM_SDR).toMatch(/Oi! Aqui é do comercial da ChatClean\. Pra eu te mostrar o que faz sentido: qual o nome da sua empresa\?/);
        expect(montar({}, { isInicioConversa: true })).toMatch(/pergunte o nome da empresa/);
    });

    it('CA-007: autonomo responde empresa e quem decide', () => {
        const p = promptExtracao({ mensagemSanitizada: 'sou instrutor de transito autonomo', campoAtual: 'empresa' });
        expect(p).toMatch(/retorne "autônomo" seguido do ofício/);
        expect(p).toMatch(/Se ele trabalha por conta própria, retorne "ele mesmo"/);
    });

    it('CA-008: pergunta do lead e respondida e a pendente volta na mesma mensagem', () => {
        const p = montar({ perguntouAgora: true }, { proximoCampo: { campo: 'decisor', pergunta: 'Pergunte quem decide.' } });
        expect(p).toMatch(/feche voltando à pergunta que ficou pendente/);
        expect(p).toMatch(/Pergunte quem decide\./);
    });

    it('CA-009: sem texto padrao de "plataforma de CRM multicanal"', () => {
        expect(SYSTEM_SDR).toMatch(/NÃO use texto padrão/);
        expect(SYSTEM_SDR).not.toMatch(/Apresente sempre como/);
    });
});

describe('duvidas do lead', () => {
    it('CA-010: preco nunca tem valor, nem "a partir de"', () => {
        expect(a.naoRevelaPreco('Planos a partir de 199 por mês.').ok).toBe(false);
        expect(SYSTEM_SDR).toMatch(/o especialista monta a proposta certa pra ele na reunião/);
    });

    it('CA-010: preco leva a reuniao, com a resposta antes dos horarios', () => {
        expect(pedeEspecialista({ objecao: 'preco' })).toBe(true);
        expect(deveOferecerReuniao({}, { objecao: 'preco' })).toBe(true);
        expect(ofertaDepoisDaResposta({}, { objecao: 'preco' })).toBe(true);
    });

    it('CA-010: a resposta segura de preco oferece a conversa com o especialista', () => {
        const r = guarda.avaliar('Custa R$ 300 por mês.', {});
        expect(r.respostaSegura).toMatch(/O valor depende de quantas pessoas atendem/);
        expect(r.respostaSegura).not.toMatch(/\d/);
    });

    it('CA-011: teste, app ou integracao incerta vai para a reuniao', () => {
        expect(deveOferecerReuniao({}, { duvidaParaEspecialista: true, perguntou: true })).toBe(true);
        expect(ofertaDepoisDaResposta({}, { duvidaParaEspecialista: true, perguntou: true })).toBe(true);
        // Sem agenda, o proprio modelo pergunta se pode marcar.
        expect(montar({ duvidaParaEspecialistaAgora: true })).toMatch(/pergunte se pode deixar essa conversa marcada/);
    });

    it('recusou a reuniao: preco sozinho nao reoferece', () => {
        expect(deveOferecerReuniao({ recusouReuniao: true }, { objecao: 'preco' })).toBe(false);
    });
});

describe('horario de retorno vencido (CA-015)', () => {
    it('"o time retorna hoje as 9h" depois das 9h e violacao critica', () => {
        const r = guarda.avaliar('O time retorna hoje às 9h, combinado?', { expedienteAberto: true, proximoExpediente: null });
        expect(r.ok).toBe(false);
        expect(r.corrigiveis.map((v) => v.id)).toContain('nao-cita-retorno-vencido');
    });

    it('antes das 9h a frase e verdadeira', () => {
        expect(a.naoCitaRetornoVencido('O time retorna hoje às 9h.', { proximoExpediente: 'hoje às 9h' }).ok).toBe(true);
    });
});

describe('quando parar', () => {
    it('CA-018: primeira negativa pergunta o motivo; a segunda encerra sem qualificar', () => {
        const lead = {};
        expect(decidirParada(lead, { semInteresse: true })).toEqual({ acao: 'perguntarMotivo' });
        const r = decidirParada(lead, { semInteresse: true });
        expect(r).toMatchObject({ acao: 'fecho', motivo: 'sem-interesse', texto: FECHOS['sem-interesse'] });
        expect(lead.encerrado).toBe(true);
        expect(lead.qualificacaoCompleta).toBeUndefined();
        expect(montar({ perguntarMotivoAgora: true })).toMatch(/UMA pergunta curta e gentil para entender o motivo/);
    });

    it('CA-019: fora do perfil encerra com educacao e sem reuniao', () => {
        const lead = {};
        const r = decidirParada(lead, { foraDoPerfil: true });
        expect(r).toMatchObject({ acao: 'fecho', motivo: 'fora-do-perfil' });
        expect(r.texto).not.toMatch(/reuni|horário/i);
        // Insistir fora do perfil depois do fecho fica sem resposta.
        expect(decidirParada(lead, { foraDoPerfil: true })).toEqual({ acao: 'silencio' });
    });

    it('CA-020: despedida recebe um fecho; despedida depois dele fica sem resposta', () => {
        const lead = {};
        expect(decidirParada(lead, { despedida: true })).toMatchObject({ acao: 'fecho', texto: 'Combinado! Se precisar, é só chamar aqui.' });
        expect(decidirParada(lead, { despedida: true })).toEqual({ acao: 'silencio' });
        expect(decidirParada(lead, { soAgradecimento: true })).toEqual({ acao: 'silencio' });
    });

    it('CA-020: depois da confirmacao do agendamento, "obrigado" fica sem resposta', () => {
        const lead = { fechoEnviado: true };
        expect(decidirParada(lead, { soAgradecimento: true })).toEqual({ acao: 'silencio' });
    });

    it('lead encerrado que volta com assunto novo e atendido', () => {
        const lead = {};
        decidirParada(lead, { despedida: true });
        expect(decidirParada(lead, {})).toEqual({ acao: 'seguir' });
        expect(lead.encerrado).toBe(false);
    });

    it('CA-021: robo do outro lado para em no maximo 3 trocas e depois silencia', () => {
        const lead = {};
        expect(decidirParada(lead, { pareceRobo: true })).toEqual({ acao: 'seguir' });
        expect(decidirParada(lead, { respostaInstantanea: true })).toMatchObject({ acao: 'fecho', motivo: 'robo' });
        expect(lead.roboDetectado).toBe(true);
        expect(decidirParada(lead, {})).toEqual({ acao: 'silencio' });
    });

    it('CA-021: um sinal isolado de robo nao para a conversa', () => {
        const lead = {};
        decidirParada(lead, { pareceRobo: true });
        expect(decidirParada(lead, {})).toEqual({ acao: 'seguir' });
        expect(decidirParada(lead, { pareceRobo: true })).toEqual({ acao: 'seguir' });
    });

    it('resposta instantanea: menos de 4s depois da resposta da IA', () => {
        expect(respostaInstantanea({ ultimaRespostaEm: 10000 }, 12000)).toBe(true);
        expect(respostaInstantanea({ ultimaRespostaEm: 10000 }, 20000)).toBe(false);
        expect(respostaInstantanea({}, 12000)).toBe(false);
        // Chegou antes de a IA terminar a resposta anterior: rajada do lead, nao robo.
        expect(respostaInstantanea({ ultimaRespostaEm: 10000 }, 9000)).toBe(false);
    });
});

describe('nota para o vendedor (CA-023)', () => {
    const lead = {
        nome: 'Erika', nomeContato: 'Erika Loja', empresa: 'Loja da Erika', decisor: 'ela e o sócio',
        urgencia: 'mês que vem', duvidaPrincipal: 'quer saber o preço', segmento: 'varejo',
        canais: 'WhatsApp', volume: '300 por mês', cidadeEstado: 'Natal-RN',
        reuniaoAgendada: { label: 'quarta 11/11 às 10h' }
    };
    const nota = montarNota(lead, '5584999999999', { departamento: 'Comercial' });

    it('registra so empresa, quem decide, quando quer comecar, duvida e horario', () => {
        expect(nota).toMatch(/Empresa: Loja da Erika/);
        expect(nota).toMatch(/Quem decide: ela e o sócio/);
        expect(nota).toMatch(/Quando quer começar: mês que vem/);
        expect(nota).toMatch(/Dúvida principal: quer saber o preço/);
        expect(nota).toMatch(/Horário marcado: quarta 11\/11 às 10h/);
    });

    it('nada deduzido nem fora da lista: segmento, canais, volume e cidade saem', () => {
        for (const fora of ['Segmento', 'Canais', 'Volume', 'Cidade', 'varejo', 'Natal-RN']) expect(nota).not.toMatch(fora);
    });

    it('sem nome dito, o perfil do WhatsApp identifica o contato', () => {
        expect(montarNota({ nomeContato: 'Chácara' }, '558400', { departamento: 'Comercial' })).toMatch(/Contato: Chácara \(558400\)/);
    });
});
