// Rede de seguranca da suite: nenhum teste pode tocar a rede nem depender de
// credencial. Se algum tentar, falha aqui com a causa explicita em vez de
// gastar credito da OpenAI ou pendurar no timeout.
import { beforeAll, afterEach, vi } from 'vitest';

beforeAll(() => {
    globalThis.fetch = () => {
        throw new Error('Teste tentou usar a rede (fetch). Use um fake da porta correspondente.');
    };
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
});
