import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { SYSTEM_SDR } = require('../../prompts.js');
const { RECURSOS } = require('../../data.js');

// O produto oferecido e a API Oficial da Meta. A "API nao oficial" nunca existiu
// como produto: o que o cliente ja tem e o WhatsApp Business comum.
describe('posicionamento do canal WhatsApp', () => {
    it('a base de conhecimento oferece a API Oficial da Meta', () => {
        expect(RECURSOS.canais).toMatch(/API Oficial da Meta/);
    });

    it('a base de conhecimento nao oferece API nao oficial nem WhatsApp WEB', () => {
        expect(RECURSOS.canais).not.toMatch(/não oficial/);
        expect(RECURSOS.canais).not.toMatch(/WhatsApp WEB/i);
    });

    it('o system prompt apresenta o WhatsApp pela API Oficial da Meta', () => {
        expect(SYSTEM_SDR).toMatch(/WHATSAPP: API Oficial da Meta/);
    });

    it('o system prompt nao oferece o par "oficial e nao oficial"', () => {
        expect(SYSTEM_SDR).not.toMatch(/API oficial e não oficial/);
        expect(SYSTEM_SDR).not.toMatch(/oficial\/WABA e não oficial/);
    });

    it('o disparo em massa cita a API Oficial da Meta', () => {
        expect(SYSTEM_SDR).toMatch(/disparos em massa via WhatsApp pela API Oficial da Meta/);
    });

    it('o system prompt proibe oferecer API nao oficial', () => {
        expect(SYSTEM_SDR).toMatch(/PRODUTO WHATSAPP/);
        expect(SYSTEM_SDR).toMatch(/NUNCA ofereça, mencione ou sugira/);
    });
});
