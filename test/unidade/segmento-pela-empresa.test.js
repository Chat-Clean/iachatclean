import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { aplicarCampos, determinarProximoCampo, inferirSegmentoDaEmpresa } = require('../../flow.js');

// Queixa real do cliente: o lead diz "Pizzaria 3 Irmaos" e o bot pergunta em
// seguida qual e o segmento da empresa. Perguntar o obvio irrita.
describe('segmento deduzido do nome da empresa', () => {
    it('deduz o ramo quando o nome entrega ("Pizzaria 3 Irmaos")', () => {
        expect(inferirSegmentoDaEmpresa('Pizzaria 3 Irmãos')).toBe('alimentação');
    });

    it('cobre os demais ramos da lista', () => {
        expect(inferirSegmentoDaEmpresa('Clínica Sorriso')).toBe('saúde');
        expect(inferirSegmentoDaEmpresa('Oficina do Paulo')).toBe('automotivo');
        expect(inferirSegmentoDaEmpresa('Loja Bom Preço')).toBe('varejo');
        expect(inferirSegmentoDaEmpresa('Barbearia do Zé')).toBe('serviços');
        expect(inferirSegmentoDaEmpresa('Solar Nordeste')).toBe('energia solar');
    });

    it('casa por palavra inteira: "Motorola" nao vira automotivo', () => {
        expect(inferirSegmentoDaEmpresa('Motorola')).toBe(null);
        expect(inferirSegmentoDaEmpresa('Solaris Tecnologia')).toBe(null);
    });

    it('nome sem pista nao deduz nada', () => {
        expect(inferirSegmentoDaEmpresa('Silva & Filhos')).toBe(null);
        expect(inferirSegmentoDaEmpresa('')).toBe(null);
        expect(inferirSegmentoDaEmpresa(null)).toBe(null);
    });

    // O segmento deixou de ser PERGUNTADO na triagem curta, mas continua sendo
    // deduzido: alimenta o gancho de case e o resumo que a equipe recebe.
    it('deduz o segmento sem gerar pergunta nova no funil', () => {
        const lead = { nome: 'Joao' };
        aplicarCampos(lead, { empresa: 'Pizzaria 3 Irmãos' });
        expect(lead.segmento).toBe('alimentação');
        expect(determinarProximoCampo(lead).campo).toBe('dor');
    });

    it('nome sem pista nao deduz, e o funil segue igual', () => {
        const lead = { nome: 'Joao' };
        aplicarCampos(lead, { empresa: 'Silva & Filhos' });
        expect(lead.segmento).toBeUndefined();
        expect(determinarProximoCampo(lead).campo).toBe('dor');
    });

    it('nao sobrescreve o segmento que o cliente informou', () => {
        const lead = { segmento: 'energia solar' };
        aplicarCampos(lead, { empresa: 'Pizzaria 3 Irmãos' });
        expect(lead.segmento).toBe('energia solar');
    });

    it('o que o cliente diz tem prioridade sobre a deducao', () => {
        const lead = {};
        aplicarCampos(lead, { empresa: 'Pizzaria 3 Irmãos', segmento: 'delivery de massas' });
        expect(lead.segmento).toBe('delivery de massas');
    });
});
