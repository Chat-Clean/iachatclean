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

    it('o funil NAO pergunta o segmento depois de "Pizzaria 3 Irmaos"', () => {
        const lead = { objetivo: 'vender mais', nome: 'Joao' };
        aplicarCampos(lead, { empresa: 'Pizzaria 3 Irmãos' });
        expect(lead.segmento).toBe('alimentação');
        expect(determinarProximoCampo(lead).campo).toBe('cidadeEstado');
    });

    it('o funil AINDA pergunta o segmento quando o nome nao entrega', () => {
        const lead = { objetivo: 'vender mais', nome: 'Joao' };
        aplicarCampos(lead, { empresa: 'Silva & Filhos' });
        expect(lead.segmento).toBeUndefined();
        expect(determinarProximoCampo(lead).campo).toBe('segmento');
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
