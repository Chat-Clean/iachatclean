const js = require('@eslint/js');
const globals = require('globals');

// Fronteiras da arquitetura alvo (docs/10-arquitetura-alvo.md).
// Os adapters em src/infrastructure sao o unico lugar com I/O. Esta regra e o
// que impede a arquitetura de apodrecer: sem ela, em alguns meses o dominio
// volta a importar axios.
//
// ATENCAO: `no-restricted-imports` so enxerga `import` de ESM. Este projeto e
// CommonJS, entao a barreira precisa olhar a CHAMADA require() — verificado
// com um arquivo de violacao proposital antes de confiar nela.
const INFRA_PROIBIDA = [
    'openai',
    'axios',
    'ioredis',
    'express',
    'form-data',
    'dotenv',
    'googleapis',
    'fs',
    'path'
];

const proibirRequire = (modulos, motivo) => [
    'error',
    {
        selector: `CallExpression[callee.name='require'][arguments.0.value=/^(${modulos.join('|')})$/]`,
        message: motivo
    }
];

module.exports = [
    js.configs.recommended,
    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'commonjs',
            globals: { ...globals.node }
        },
        rules: {
            // '_algo' marca descarte deliberado (ex.: tirar um campo por rest).
            'no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }
            ],
            // catch (_) {} vazio e o idioma do legado para "falha aqui nao importa".
            'no-empty': ['error', { allowEmptyCatch: true }],
            'no-console': 'off',
            eqeqeq: ['error', 'smart'],
            'prefer-const': 'error',
            'no-var': 'error'
        }
    },
    {
        // O dominio, a aplicacao e o compartilhado sao puros: nada de I/O,
        // nada de process.env. As dependencias entram por parametro.
        files: ['src/domain/**/*.js', 'src/application/**/*.js', 'src/shared/**/*.js'],
        rules: {
            'no-restricted-syntax': proibirRequire(
                INFRA_PROIBIDA,
                'Camada pura nao pode depender de infraestrutura (DIP). Receba a dependencia por parametro; o adapter concreto vive em src/infrastructure e e montado em src/main/container.js.'
            ),
            'no-restricted-globals': ['error', 'process']
        }
    },
    {
        // Adapters podem falar com o mundo, mas nao conhecem o composition root.
        files: ['src/infrastructure/**/*.js'],
        rules: {
            'no-restricted-syntax': [
                'error',
                {
                    selector: "CallExpression[callee.name='require'][arguments.0.value=/\\/main\\//]",
                    message:
                        'Adapter nao conhece o composition root: a dependencia flui de main/ para infrastructure, nunca o contrario.'
                }
            ]
        }
    },
    {
        files: ['test/**/*.js', 'vitest.config.js'],
        languageOptions: {
            sourceType: 'module',
            globals: { ...globals.node }
        }
    },
    {
        // O legado ainda nao foi estrangulado: ele e a referencia de
        // comportamento, nao codigo a ser policiado pelas regras de camada.
        ignores: ['node_modules/', 'coverage/', 'prints/', 'test/baseline/*.log']
    }
];
