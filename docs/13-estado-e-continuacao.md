# 13 — Estado e Continuação

Documento de retomada. **Leia antes de qualquer coisa.** Atualize ao fim de cada fatia.

## Onde estamos

**Fases 0 e 1 concluídas e EM PRODUÇÃO.** A branch `refatoracao/arquitetura-ddd` foi mesclada
na `develop` (PR #1) e promovida para a `main` (PR #2) em 31/08/2026. A `main` deixou de ser o
código original.

A suíte roda em cerca de 1 segundo, sem rede e sem crédito da OpenAI.

```
npm test        119 testes, 9 arquivos, verdes
npm run lint    limpo em src/ e test/
npm run typecheck  limpo
```

ATENÇÃO: `main` conter o código não garante que o ambiente rodou o deploy. Confirmar no
EasyPanel se o serviço pegou o commit e se as variáveis da grade nova estão setadas lá
(`AGENDA_INICIO`, `AGENDA_FIM=17:20`, `REUNIAO_DURACAO_MIN=40`, `AGENDA_PASSO_MIN`). Sem elas o
código cai nos defaults e o comportamento em produção não é o que os testes cobrem.

## O que já foi entregue

| Entrega | Onde |
|---|---|
| Ferramental (vitest, eslint, prettier, typecheck) | `vitest.config.js`, `eslint.config.js`, `jsconfig.json`, `.prettierrc` |
| Barreira de camada, verificada com violação proposital | `eslint.config.js` |
| Bloqueio de rede na suíte | `test/apoio/setup.js` |
| Value objects de telefone | `src/shared/telefone.js` (14 testes) |
| ACL do payload de entrada | `src/infrastructure/chatclean/acl/tradutor.js` (28 testes) |
| Analisadores de qualidade da resposta | `src/domain/qualidade/analisadores.js` (21 testes) |
| Guarda de invariantes, ligada em producao | `src/domain/qualidade/guarda.js` (11 testes) |
| Harness de eval com roteiros | `src/eval/` + `eval.js` (6 testes) |
| Funil que nao trava em campo recusado | `flow.js` (13 testes) |
| Anti-loop que transfere em vez de emudecer | `index.js` |
| Deteccao de incompreensao do cliente | `prompts.js` + `index.js` |
| Mensagem e motivo de descarte no domínio | `src/domain/mensageria/` |
| Grade de horários extraída do legado | `src/domain/agendamento/GradeDeHorarios.js` (16 + 8 testes) |
| Falha do Google Calendar avisa a equipe | `index.js` + `GOOGLE_CALENDAR_SETUP.md` |
| Padrão de engenharia e templates de issue/PR | `AGENTS.md`, `.github/` (PR #3) |

O legado **delega** para os módulos novos; `calendar.js` delega a grade para o domínio. Nenhum comportamento mudou, com uma exceção
declarada: o log de descarte agora nomeia o motivo em vez de dizer sempre "payload não
reconhecido".

## Próximo passo

**Decisao pendente do negocio:** promover `MODELO_RESPOSTA=gpt-4.1-mini` em producao. Medido em 5
execucoes do roteiro de preco: 0 vazamentos contra 2 em 30 turnos do modelo atual. A guarda ja
cobre o caso; a troca reduz a frequencia. Ver [12-qualidade-da-ia.md](12-qualidade-da-ia.md).

**Pendente de merge:** o PR #4 (`develop` -> `main`) leva o `AGENTS.md` e os templates de
issue/PR. Enquanto nao entrar na `main`, o GitHub nao aplica os templates, porque os le da branch
padrao — e o `CLAUDE.md` da `main` referencia um `AGENTS.md` que ainda nao existe la.

**Fase 2.1 — porta `CanalDeMensagem`.** É a próxima porque `ccPush` hoje mistura três destinos
(lead, nota interna no ticket, equipe) e a captura do modo síncrono é um `if` dentro do adapter.
Separar isso destrava o teste de integração do turno sem subir servidor.

Ordem: teste de caracterização de `ccPush` -> porta + fake -> adapter real -> legado delega.

## Contexto que não está no código

- A `main` é o que roda em produção, e **já contém as Fases 0 e 1** desde 31/08/2026.
- O fluxo `branch -> PR -> develop -> PR -> main` passou a ser exercido de fato: PRs #1 a #4.
- O deploy de teste está no EasyPanel, serviço `cashclean-iachatclean-fluxo`.
- A entrada de produção hoje é um fluxo n8n que chama `POST /api/mensagem/<segredo>`.
  O `WEBHOOK_SECRET` em uso tem 48 caracteres.
- `CC_PUSH_URL` continua necessária: é o canal de nota interna, resumo para a equipe e follow-up.

## Corrigido nesta rodada

| Era | Virou |
|---|---|
| Campo recusado deixava `qualificacaoCompleta` false para sempre; o lead NUNCA era encaminhado | Insiste 2x, desiste do campo e segue. Verificado ponta a ponta |
| Cliente repetindo a mesma mensagem 3x fazia o bot emudecer de vez | Transfere para humano com mensagem ao lead |
| Nada detectava "nao entendi" / "voce ja perguntou isso" | Extrai `naoEntendeu`; 1 sinal reformula, 2 seguidos transferem |
| Se a ultima fala fosse PERGUNTA, a instrucao de handoff era descartada: equipe recebia "LEAD QUALIFICADO" e o cliente nunca ouvia que alguem ia assumir | Responde a duvida E anuncia a passagem |
| O n8n desistia do turno por timeout e reenviava a mensagem; o dedupe respondia "duplicada" com `respostas: []` e o LEAD FICAVA SEM RESPOSTA. Diagnosticado no log de producao: so as mensagens que passam pelo modelo duplicavam, `/reset` nao | Reenvio do mesmo `msgId` espera o turno original e recebe a mesma resposta (`src/shared/registroDeTurnos.js`) |
| Nada vigiava o BOT repetindo pergunta (so o cliente) | `nao-repete-pergunta` entrou na guarda e manda regerar |
| A grade usava passo `duracao >= 60 ? duracao : 30` e oferecia horarios SOBREPOSTOS com reuniao de 40 min | Grade no dominio: 10h as 16:40, passo igual a duracao, sem fim de semana. `/diag` mostra a janela e se ha sobreposicao |
| Falha do Google Calendar degradava em silencio: ninguem sabia que o agendamento nao aconteceu | A equipe e avisada. Documentado tambem que a tela de consentimento em "Teste" expira o refresh token a cada 7 dias |

## Dívidas conhecidas (não corrigir sem decisão do negócio)

| ID | Dívida | Impacto |
|---|---|---|
| D-01 | A chave do Redis usa o telefone sem tratar o nono dígito. `5584994610845` e `558494610845` viram dois leads. | Qualificação recomeça do zero se a origem variar o formato. `nucleoNumero` já resolve, mas só é usado na allow-list. |
| D-02 | `normalizarCorpo` desembrulha no máximo 6 níveis. | Payload mais aninhado que isso é descartado como formato desconhecido. |
| D-03 | Timeout do turno responde `timeout: true` com `respostas: []` e manda o texto pela Push API. | O fluxo precisa tratar esse caso, senão a mensagem chega duplicada. |
| D-04 | O agrupamento de rajada vive em `Map` de módulo. | Com mais de uma instância no EasyPanel, a rajada não é agrupada entre containers. |
| D-05 | `prints/image.png` foi versionado. | Cosmético. |
| D-06 | `test-chat.js` e `sim-lead.js` reimplementam o turno e ja divergiram: nao tem a guarda. O comentario no topo deles afirma usar "o MESMO cerebro". | Testar no terminal nao reproduz producao. Fase 6. |
| D-07 | O eval mede obediencia as regras, nao se a resposta e boa. | Um juiz LLM sobre os mesmos roteiros cobriria. |
| D-09 | Com `temperature: 0.7` o placar varia entre execucoes. So a medicao de vazamento de preco foi repetida (5x). | Numero de execucao unica e anedota, nao estatistica. |
| D-10 | O log `📩 <numero> [tipo]: "<texto>"` continua imprimindo telefone e conteúdo da mensagem no stdout. É log do legado, útil para operação, mas é PII sob LGPD. | O payload bruto já foi fechado (`LOG_PAYLOAD_RAW=false`); esta linha ficou. Decidir se mascara o número (`5584****0845`) ou se some com o texto. |
| D-08 | `MODELO_RESPOSTA` no `.env.example` sugere `gpt-4.1-mini`, mas o padrao no codigo continua `gpt-4o-mini` para nao mudar producao sem decisao. | Producao segue no modelo que inventa preco, protegida so pela guarda. |

## Como validar que nada quebrou

```bash
npm test
PORT=3999 WEBHOOK_SECRET=teste123 CC_PUSH_URL= REDIS_URL= IA_ALLOWED_CONTACTS= npm start
curl -X POST localhost:3999/api/mensagem/teste123 -H 'Content-Type: application/json' \
  -d '{"number":"5511999998888","body":"oi","type":"text","id":"smoke-1"}'
```

Esperado: `status: ok` com a resposta da IA em `respostas`. ATENÇÃO: isso gasta crédito da OpenAI.
