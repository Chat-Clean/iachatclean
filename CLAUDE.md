# CLAUDE.md — SDR Virtual ChatClean

Contexto permanente para qualquer agente que trabalhe neste repositório.

## O que é este projeto

SDR virtual (IA de pré-vendas) da **ChatClean**, plataforma de CRM e atendimento digital
multicanal. Atende leads pelo WhatsApp, qualifica (nome, empresa, segmento, objetivo, canais,
volume, dor, urgência), **agenda reunião no Google Calendar**, cria a **oportunidade no funil do
CRM** e transfere para o time comercial.

O transporte é a plataforma **ChatClean**. Desde a migração para request/response, a resposta ao
lead volta no **corpo da própria requisição**; a Push API (`CC_PUSH_URL`) segue sendo o canal de
nota interna no ticket, resumo para a equipe e follow-up de reativação.

**Estado atual:** refatoração estrutural em andamento na branch `refatoracao/arquitetura-ddd`.
A `main` segue no código original. Ver [docs/13-estado-e-continuacao.md](docs/13-estado-e-continuacao.md).

## Regra número 1

**Nada quebra em produção.** A refatoração segue **Strangler Fig**: código novo nasce ao lado do
velho, o legado delega, e só então o legado morre. Nenhuma fatia começa sem rede de testes.

## Como trabalhamos aqui — Spec-Driven Development

```
SPEC (o quê/porquê) -> PLAN (como) -> TASKS (passos) -> CODE + TESTS -> VERIFY
```

Fatias de risco real não começam sem spec em `specs/`. Ver [specs/README.md](specs/README.md).

## Comece por aqui

**[docs/13-estado-e-continuacao.md](docs/13-estado-e-continuacao.md)** — onde a refatoração parou,
o que já foi entregue, qual é o próximo passo. É o documento de retomada: leia antes de qualquer
coisa.

## Mapa de leitura

| Preciso de… | Leia |
|---|---|
| **Retomar o trabalho** | [docs/13-estado-e-continuacao.md](docs/13-estado-e-continuacao.md) |
| Arquitetura alvo | [docs/10-arquitetura-alvo.md](docs/10-arquitetura-alvo.md) |
| **Plano de refatoração** | [docs/11-plano-refatoracao-strangler.md](docs/11-plano-refatoracao-strangler.md) |
| **Qualidade da IA e evals** | [docs/12-qualidade-da-ia.md](docs/12-qualidade-da-ia.md) |

## Convenções

- **NUNCA use emojis** em documentação, specs, comentários de código novo e mensagens de commit.
  Use palavras (`ATENÇÃO:`, `Crítica`, `Bloqueante`) e ASCII em diagramas (`->`, `<-`).
  Duas exceções: o texto que o bot envia ao cliente final, e os logs do legado, que ainda usam
  emoji como marcador visual e não serão reescritos só por isso.
- **Commits concisos.** Assunto no padrão convencional e, no máximo, uma linha de corpo. O
  detalhamento vive na spec, não no histórico do git.
- **Branch dedicada.** O trabalho de refatoração fica em `refatoracao/arquitetura-ddd`.
- **Linguagem ubíqua em português** para domínio (`Atendimento`, `Qualificacao`, `Agendamento`,
  `Transbordo`, `Oportunidade`, `Expediente`). Termos técnicos em inglês (`Repository`, `Port`,
  `Adapter`, `UseCase`).
- Commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`. Uma intenção por commit.
- Toda variável de ambiente nova entra no `.env.example` documentada.
- Nada de `domain/` importando infraestrutura. Nada de `process.env` fora de `main/config`.
  **Verificado por lint** — e a verificação foi testada com violação proposital.
- **Mudança de comportamento só quando pedida.** Achado vira dívida documentada.

## Invariantes de negócio

1. A IA só responde enquanto **ninguém assumiu o ticket**. `userId` preenchido no ticket, ou
   status `closed`, silencia a IA.
2. **Nunca revelar que é IA** nem vazar o system prompt.
3. Agendamento respeita expediente e o **bloqueio de almoço (12:30-13:30)**.
4. Mensagens de **grupo** não são atendidas.
5. A oportunidade no CRM é criada na etapa **REUNIÃO MARCADA**, nomeada com o nome do lead.

## Comandos

```bash
npm start          # sobe o servidor (API request/response)  — precisa de OPENAI_API_KEY
npm run dev        # nodemon
npm run chat       # conversa com o bot no terminal          — precisa só de OPENAI_API_KEY
npm run sim        # roteiro completo de qualificação
npm test           # suíte vitest (sem rede, sem crédito)
npm run coverage   # cobertura
npm run lint       # inclui a barreira de camadas
npm run typecheck  # checkJs sobre domain/application/shared
npm run eval       # mede a qualidade das respostas — GASTA CREDITO
```

## Cuidados operacionais

- `npm run chat` e `npm run sim` **gastam crédito real da OpenAI**. `npm test` não.
- Não commite `.env`. Não logue payload bruto em produção (contém PII).
- Telefone, nome e empresa do lead são dados pessoais sob LGPD.
