import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const flow = require('../../flow.js');

const leadCompletoMenos = (faltando) => {
    const lead = {
        empresa: 'Silva & Filhos',
        decisor: 'ele mesmo',
        urgencia: 'agora'
    };
    delete lead[faltando];
    return lead;
};

describe('ordem do funil', () => {
    // Spec 0003, CA-006: tres perguntas, nesta ordem.
    it('CA-006: pede a empresa, depois quem decide, depois quando quer comecar', () => {
        expect(flow.CAMPOS).toEqual(['empresa', 'decisor', 'urgencia']);
        expect(flow.determinarProximoCampo({}).campo).toBe('empresa');
        expect(flow.determinarProximoCampo({ empresa: 'Silva & Filhos' }).campo).toBe('decisor');
        expect(flow.determinarProximoCampo({ empresa: 'Silva & Filhos', decisor: 'ele mesmo' }).campo).toBe('urgencia');
    });

    it('nao pergunta nome, segmento, dor, cidade, canais, volume nem objetivo', () => {
        const perguntados = flow.CAMPOS;
        for (const campo of ['nome', 'segmento', 'dor', 'cidadeEstado', 'canais', 'volume', 'objetivo']) {
            expect(perguntados).not.toContain(campo);
        }
    });

    it('mas ainda CAPTURA esses campos quando o cliente fala por conta propria', () => {
        const lead = {};
        flow.aplicarCampos(lead, { nome: 'Joao', empresa: 'Padaria Pao Quente', cidadeEstado: 'Natal-RN' });
        expect(lead.empresa).toBe('Padaria Pao Quente');
        expect(lead.cidadeEstado).toBe('Natal-RN');
        expect(lead.nome).toBe('Joao');
        // Nada disso gera pergunta nova: o proximo campo e quem decide.
        expect(flow.determinarProximoCampo(lead).campo).toBe('decisor');
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
        const lead = {};

        expect(flow.determinarProximoCampo(lead).campo).toBe('empresa');
        flow.registrarTentativa(lead, 'empresa');

        expect(flow.determinarProximoCampo(lead).campo).toBe('empresa');
        flow.registrarTentativa(lead, 'empresa');

        // Insistiu duas vezes: desiste e vai para o proximo.
        expect(flow.determinarProximoCampo(lead).campo).toBe('decisor');
    });

    it('completa a qualificacao mesmo com um campo recusado', () => {
        const lead = leadCompletoMenos('decisor');
        flow.registrarTentativa(lead, 'decisor');
        flow.registrarTentativa(lead, 'decisor');

        expect(flow.determinarProximoCampo(lead)).toBe(null);
        expect(lead.qualificacaoCompleta).toBe(true);
    });

    it('lista os campos que ficaram sem resposta, para o resumo da equipe', () => {
        const lead = leadCompletoMenos('decisor');
        flow.registrarTentativa(lead, 'decisor');
        flow.registrarTentativa(lead, 'decisor');
        expect(flow.camposDesistidos(lead)).toEqual(['decisor']);
    });

    it('nao lista como desistido o campo que o lead acabou informando', () => {
        const lead = { decisor: 'ele mesmo' };
        flow.registrarTentativa(lead, 'decisor');
        flow.registrarTentativa(lead, 'decisor');
        expect(flow.camposDesistidos(lead)).toEqual([]);
    });

    it('respeita um limite customizado', () => {
        const lead = { empresa: 'z' };
        flow.registrarTentativa(lead, 'decisor');
        expect(flow.determinarProximoCampo(lead, { maxTentativas: 1 }).campo).toBe('urgencia');
        expect(flow.determinarProximoCampo(lead, { maxTentativas: 5 }).campo).toBe('decisor');
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
