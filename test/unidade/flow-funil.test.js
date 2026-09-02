import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const flow = require('../../flow.js');

const leadCompletoMenos = (faltando) => {
    const lead = {
        nome: 'Joao',
        dor: 'demora pra responder',
        urgencia: 'agora',
        decisor: 'sozinho'
    };
    delete lead[faltando];
    return lead;
};

describe('ordem do funil', () => {
    // Triagem encurtada: nome, dor, urgencia, decisor. Nada mais e perguntado.
    it('pede nome primeiro, dor depois', () => {
        expect(flow.determinarProximoCampo({}).campo).toBe('nome');
        expect(flow.determinarProximoCampo({ nome: 'Joao' }).campo).toBe('dor');
    });

    it('nao pergunta empresa, segmento, cidade, canais nem volume', () => {
        const perguntados = flow.CAMPOS;
        for (const campo of ['empresa', 'segmento', 'cidadeEstado', 'canais', 'volume', 'objetivo']) {
            expect(perguntados).not.toContain(campo);
        }
    });

    it('mas ainda CAPTURA esses campos quando o cliente fala por conta propria', () => {
        const lead = {};
        flow.aplicarCampos(lead, { nome: 'Joao', empresa: 'Padaria Pao Quente', cidadeEstado: 'Natal-RN' });
        expect(lead.empresa).toBe('Padaria Pao Quente');
        expect(lead.cidadeEstado).toBe('Natal-RN');
        // Capturar empresa NAO gera pergunta nova: o proximo campo segue sendo a dor.
        expect(flow.determinarProximoCampo(lead).campo).toBe('dor');
    });

    it('marca a qualificacao completa quando tudo foi coletado', () => {
        const lead = leadCompletoMenos('nada');
        expect(flow.determinarProximoCampo(lead)).toBe(null);
        expect(lead.qualificacaoCompleta).toBe(true);
    });
});

describe('campo recusado nao trava o funil', () => {
    // Este era o bug: o lead que se recusava a informar a empresa deixava o
    // campo null para sempre. qualificacaoCompleta nunca virava true e o
    // encaminhamento ao especialista NUNCA disparava.
    it('insiste no campo ate o limite e depois segue em frente', () => {
        const lead = { nome: 'Joao' };

        expect(flow.determinarProximoCampo(lead).campo).toBe('dor');
        flow.registrarTentativa(lead, 'dor');

        expect(flow.determinarProximoCampo(lead).campo).toBe('dor');
        flow.registrarTentativa(lead, 'dor');

        // Insistiu duas vezes: desiste e vai para o proximo.
        expect(flow.determinarProximoCampo(lead).campo).toBe('urgencia');
    });

    it('completa a qualificacao mesmo com um campo recusado', () => {
        const lead = leadCompletoMenos('dor');
        flow.registrarTentativa(lead, 'dor');
        flow.registrarTentativa(lead, 'dor');

        expect(flow.determinarProximoCampo(lead)).toBe(null);
        expect(lead.qualificacaoCompleta).toBe(true);
    });

    it('lista os campos que ficaram sem resposta, para o resumo da equipe', () => {
        const lead = leadCompletoMenos('dor');
        flow.registrarTentativa(lead, 'dor');
        flow.registrarTentativa(lead, 'dor');
        expect(flow.camposDesistidos(lead)).toEqual(['dor']);
    });

    it('nao lista como desistido o campo que o lead acabou informando', () => {
        const lead = { dor: 'demora pra responder' };
        flow.registrarTentativa(lead, 'dor');
        flow.registrarTentativa(lead, 'dor');
        expect(flow.camposDesistidos(lead)).toEqual([]);
    });

    it('respeita um limite customizado', () => {
        const lead = { nome: 'y' };
        flow.registrarTentativa(lead, 'dor');
        expect(flow.determinarProximoCampo(lead, { maxTentativas: 1 }).campo).toBe('urgencia');
        expect(flow.determinarProximoCampo(lead, { maxTentativas: 5 }).campo).toBe('dor');
    });
});

describe('registrarTentativa', () => {
    // determinarProximoCampo e consultado mais de uma vez no mesmo turno; se ele
    // proprio contasse, o campo seria descartado na metade do tempo previsto.
    it('nao conta sozinho: consultar o proximo campo nao gasta tentativa', () => {
        const lead = { objetivo: 'x', nome: 'y' };
        flow.determinarProximoCampo(lead);
        flow.determinarProximoCampo(lead);
        flow.determinarProximoCampo(lead);
        expect(flow.campoDesistido(lead, 'empresa')).toBe(false);
    });

    it('ignora campo ausente sem quebrar', () => {
        const lead = {};
        expect(() => flow.registrarTentativa(lead, null)).not.toThrow();
        expect(lead.tentativas).toBeUndefined();
    });
});

describe('aplicarCampos', () => {
    it('preenche o que esta vazio', () => {
        const lead = {};
        flow.aplicarCampos(lead, { nome: 'Rafael', empresa: 'Liv Solar' });
        expect(lead.nome).toBe('Rafael');
    });

    it('nao sobrescreve sem correcao explicita', () => {
        const lead = { nome: 'Rafael' };
        flow.aplicarCampos(lead, { nome: 'Outro' });
        expect(lead.nome).toBe('Rafael');
    });

    it('sobrescreve quando o cliente corrige', () => {
        const lead = { empresa: 'Errada' };
        flow.aplicarCampos(lead, { empresa: 'Certa', correcao: ['empresa'] });
        expect(lead.empresa).toBe('Certa');
    });

    it('ignora valores vazios', () => {
        const lead = {};
        flow.aplicarCampos(lead, { nome: '', empresa: null, segmento: undefined });
        expect(lead.nome).toBeUndefined();
    });
});
