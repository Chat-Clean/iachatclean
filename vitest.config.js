import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['test/**/*.test.js'],
        setupFiles: ['test/apoio/setup.js'],
        // A suite NAO pode fazer chamada de rede nem esperar tempo real.
        testTimeout: 5000,
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html'],
            all: true,
            // Modulos ja puros do legado + tudo que nascer na arquitetura nova.
            include: ['flow.js', 'horario.js', 'data.js', 'cal-slots.js', 'src/**/*.js'],
            excludeAfterRemap: true,
            thresholds: {
                // Sobem a cada fatia; comecam onde a rede de seguranca alcanca hoje.
                lines: 60,
                functions: 60,
                statements: 60,
                branches: 50
            }
        }
    }
});
