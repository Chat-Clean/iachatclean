# iachatclean — instruções para agentes

> **Padrão global obrigatório:** leia `../AGENTS.md` (raiz `www`) antes de qualquer coisa.
> O contexto de negócio e as regras de produto estão em `./CLAUDE.md` — leia também.
> Este arquivo cobre só o que é específico de engenharia neste repositório.

## O que é

SDR virtual (IA de pré-vendas) da ChatClean: atende leads no WhatsApp, qualifica, agenda no Google Calendar, cria oportunidade no CRM e transfere para o comercial. Detalhes de produto em `CLAUDE.md`.

## Stack

- Node.js + Express (request/response)
- OpenAI SDK, Zod, ioredis, googleapis, axios, form-data
- ESLint + Prettier, Vitest (+ coverage v8), typecheck via jsconfig
- Docker (`Dockerfile`), CI em `.github/workflows/ci.yml`

## Comandos

```bash
npm run dev            # servidor local
npm run chat           # conversa direto com o agente no terminal
npm run sim            # simulação de conversa
npm run test           # Vitest
npm run coverage       # cobertura
npm run lint           # ESLint
npm run format         # Prettier
npm run typecheck      # checagem de tipos
npm run eval           # avaliações do agente
npm run cal:slots      # inspeciona slots do Google Calendar
npm run gauth          # fluxo de auth do Google
```

## Arquitetura

Refatoração para DDD em andamento, uma fatia por branch curta com PR para `develop` (ver `docs/13-estado-e-continuacao.md`). Fases 0 e 1 já estão na `main`. Ao evoluir o código, siga a direção DDD/Clean da §3 do padrão global: controller valida (Zod) → service aplica regra → repository acessa dados. Regra de negócio não importa Express nem SDK externo.

## Fluxo de trabalho

- Issue no GitHub para toda tarefa; branch `<tipo>/<issue>-<slug>`; PR com `Closes #N`
- Deploy: nova branch → PR → `develop` → PR → `main`

## Lacunas frente ao padrão global

- [ ] Branch `develop` e branch protection em `main`/`develop`
- [ ] Husky + lint-staged + commitlint (§2)
- [ ] Cobertura mínima de 80% reportada no Codecov (§9)
- [ ] Sentry + OpenTelemetry; substituir `console.log` por Pino/Winston estruturado (§10)
- [ ] Knip e contrato de arquitetura no CI (§4 e §3)
- [ ] Validação de env com Zod no boot e `.env.example` completo (§11)

## Exceções ao padrão global

Nenhuma. Não há UI própria (o front é a plataforma ChatClean), então a §7 (motion) não se aplica enquanto o projeto for só backend.
