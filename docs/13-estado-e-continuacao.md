# 13 — Estado e Continuação

Documento de retomada. **Leia antes de qualquer coisa.** Atualize ao fim de cada fatia.

## Onde estamos

Branch `refatoracao/arquitetura-ddd`, partindo de `feat/api-request-response`.
**Fases 0 e 1 concluídas.** A suíte roda em menos de 1 segundo, sem rede e sem crédito da OpenAI.

```
npm test        44 testes, 3 arquivos, verdes
npm run lint    limpo em src/ e test/
npm run typecheck  limpo
```

## O que já foi entregue

| Entrega | Onde |
|---|---|
| Ferramental (vitest, eslint, prettier, typecheck) | `vitest.config.js`, `eslint.config.js`, `jsconfig.json`, `.prettierrc` |
| Barreira de camada, verificada com violação proposital | `eslint.config.js` |
| Bloqueio de rede na suíte | `test/apoio/setup.js` |
| Value objects de telefone | `src/shared/telefone.js` (14 testes) |
| ACL do payload de entrada | `src/infrastructure/chatclean/acl/tradutor.js` (28 testes) |
| Analisadores de qualidade da resposta | `src/domain/qualidade/analisadores.js` (21 testes) |
| Guarda de invariantes, ligada em producao | `src/domain/qualidade/guarda.js` (9 testes) |
| Harness de eval com roteiros | `src/eval/` + `eval.js` (6 testes) |
| Funil que nao trava em campo recusado | `flow.js` (13 testes) |
| Anti-loop que transfere em vez de emudecer | `index.js` |
| Deteccao de incompreensao do cliente | `prompts.js` + `index.js` |
| Mensagem e motivo de descarte no domínio | `src/domain/mensageria/` |

O legado **delega** para os dois módulos novos. Nenhum comportamento mudou, com uma exceção
declarada: o log de descarte agora nomeia o motivo em vez de dizer sempre "payload não
reconhecido".

## Próximo passo

**Decisao pendente do negocio:** promover `MODELO_RESPOSTA=gpt-4.1-mini` em producao. Medido em 5
execucoes do roteiro de preco: 0 vazamentos contra 2 em 30 turnos do modelo atual. A guarda ja
cobre o caso; a troca reduz a frequencia. Ver [12-qualidade-da-ia.md](12-qualidade-da-ia.md).

**Fase 2.1 — porta `CanalDeMensagem`.** É a próxima porque `ccPush` hoje mistura três destinos
(lead, nota interna no ticket, equipe) e a captura do modo síncrono é um `if` dentro do adapter.
Separar isso destrava o teste de integração do turno sem subir servidor.

Ordem: teste de caracterização de `ccPush` -> porta + fake -> adapter real -> legado delega.

## Contexto que não está no código

- A `main` é o que roda em produção. Esta branch **nunca foi mesclada**.
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
| Nada vigiava o BOT repetindo pergunta (so o cliente) | `nao-repete-pergunta` entrou na guarda e manda regerar |

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
| D-08 | `MODELO_RESPOSTA` no `.env.example` sugere `gpt-4.1-mini`, mas o padrao no codigo continua `gpt-4o-mini` para nao mudar producao sem decisao. | Producao segue no modelo que inventa preco, protegida so pela guarda. |

## Como validar que nada quebrou

```bash
npm test
PORT=3999 WEBHOOK_SECRET=teste123 CC_PUSH_URL= REDIS_URL= IA_ALLOWED_CONTACTS= npm start
curl -X POST localhost:3999/api/mensagem/teste123 -H 'Content-Type: application/json' \
  -d '{"number":"5511999998888","body":"oi","type":"text","id":"smoke-1"}'
```

Esperado: `status: ok` com a resposta da IA em `respostas`. ATENÇÃO: isso gasta crédito da OpenAI.
