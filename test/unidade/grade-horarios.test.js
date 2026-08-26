import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const g = require('../../src/domain/agendamento/GradeDeHorarios.js');

const H = (hhmm) => g.parseHHMM(hhmm, -1);
const hhmm = (mins) => mins.map(g.formatarHHMM);

const base = {
    inicioMin: H('10:00'),
    fimMin: H('17:00'),
    duracaoMin: 40,
    almocoIni: H('12:30'),
    almocoFim: H('13:30')
};

describe('parseHHMM', () => {
    it('converte hora valida', () => {
        expect(g.parseHHMM('10:00', -1)).toBe(600);
        expect(g.parseHHMM('09:30', -1)).toBe(570);
        expect(g.parseHHMM('00:00', -1)).toBe(0);
    });

    it('cai no padrao com formato invalido', () => {
        expect(g.parseHHMM('dez horas', 99)).toBe(99);
        expect(g.parseHHMM('', 99)).toBe(99);
        expect(g.parseHHMM(undefined, 99)).toBe(99);
        expect(g.parseHHMM('25:00', 99)).toBe(99);
        expect(g.parseHHMM('10:70', 99)).toBe(99);
    });
});

describe('grade pedida: reunioes de 40 min a partir das 10h', () => {
    it('comeca as 10:00, nunca antes', () => {
        const m = g.gerarMinutosDoDia(base);
        expect(g.formatarHHMM(m[0])).toBe('10:00');
        expect(m.every((x) => x >= H('10:00'))).toBe(true);
    });

    it('nao sobrepoe nenhum par', () => {
        const m = g.gerarMinutosDoDia(base);
        expect(g.temSobreposicao(m, 40)).toBe(false);
    });

    it('gera a grade esperada, pulando o almoco', () => {
        expect(hhmm(g.gerarMinutosDoDia(base))).toEqual([
            '10:00',
            '10:40',
            '11:20',
            '14:00',
            '14:40',
            '15:20',
            '16:00'
        ]);
    });

    it('nenhuma reuniao termina depois do fim da janela', () => {
        for (const m of g.gerarMinutosDoDia(base)) {
            expect(m + 40).toBeLessThanOrEqual(H('17:00'));
        }
    });

    it('nenhuma reuniao encosta no almoco', () => {
        for (const m of g.gerarMinutosDoDia(base)) {
            const colide = m < H('13:30') && m + 40 > H('12:30');
            expect(colide).toBe(false);
        }
    });
});

describe('o bug do passo', () => {
    // Regra antiga: passo = duracao >= 60 ? duracao : 30. Com 40 min o passo
    // virava 30 e a grade saia sobreposta.
    it('passo menor que a duracao e ignorado, em vez de sobrepor', () => {
        const m = g.gerarMinutosDoDia({ ...base, passoMin: 30 });
        expect(g.temSobreposicao(m, 40)).toBe(false);
        expect(hhmm(m).slice(0, 3)).toEqual(['10:00', '10:40', '11:20']);
    });

    it('passo maior que a duracao e respeitado (grade mais esparsa)', () => {
        const m = g.gerarMinutosDoDia({ ...base, passoMin: 60 });
        expect(hhmm(m).slice(0, 3)).toEqual(['10:00', '11:00', '14:00']);
    });

    it('continua correto para 30 e 60 min, que ja funcionavam', () => {
        expect(g.temSobreposicao(g.gerarMinutosDoDia({ ...base, duracaoMin: 30 }), 30)).toBe(false);
        expect(g.temSobreposicao(g.gerarMinutosDoDia({ ...base, duracaoMin: 60 }), 60)).toBe(false);
    });
});

describe('bordas', () => {
    it('devolve vazio quando a janela nao cabe uma reuniao', () => {
        expect(g.gerarMinutosDoDia({ ...base, inicioMin: H('16:40') })).toEqual([]);
    });

    it('devolve vazio com duracao invalida', () => {
        expect(g.gerarMinutosDoDia({ ...base, duracaoMin: 0 })).toEqual([]);
    });

    it('almoco desativado quando inicio e fim sao iguais', () => {
        const m = g.gerarMinutosDoDia({ ...base, almocoIni: 0, almocoFim: 0 });
        expect(hhmm(m)).toContain('12:00');
    });

    it('temSobreposicao detecta grade ruim', () => {
        expect(g.temSobreposicao([600, 630], 40)).toBe(true);
        expect(g.temSobreposicao([600, 640], 40)).toBe(false);
    });
});
