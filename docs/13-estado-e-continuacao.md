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
| Mensagem e motivo de descarte no domínio | `src/domain/mensageria/` |

O legado **delega** para os dois módulos novos. Nenhum comportamento mudou, com uma exceção
declarada: o log de descarte agora nomeia o motivo em vez de dizer sempre "payload não
reconhecido".

## Próximo passo

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

## Dívidas conhecidas (não corrigir sem decisão do negócio)

| ID | Dívida | Impacto |
|---|---|---|
| D-01 | A chave do Redis usa o telefone sem tratar o nono dígito. `5584994610845` e `558494610845` viram dois leads. | Qualificação recomeça do zero se a origem variar o formato. `nucleoNumero` já resolve, mas só é usado na allow-list. |
| D-02 | `normalizarCorpo` desembrulha no máximo 6 níveis. | Payload mais aninhado que isso é descartado como formato desconhecido. |
| D-03 | Timeout do turno responde `timeout: true` com `respostas: []` e manda o texto pela Push API. | O fluxo precisa tratar esse caso, senão a mensagem chega duplicada. |
| D-04 | O agrupamento de rajada vive em `Map` de módulo. | Com mais de uma instância no EasyPanel, a rajada não é agrupada entre containers. |
| D-05 | `prints/image.png` foi versionado. | Cosmético. |

## Como validar que nada quebrou

```bash
npm test
PORT=3999 WEBHOOK_SECRET=teste123 CC_PUSH_URL= REDIS_URL= IA_ALLOWED_CONTACTS= npm start
curl -X POST localhost:3999/api/mensagem/teste123 -H 'Content-Type: application/json' \
  -d '{"number":"5511999998888","body":"oi","type":"text","id":"smoke-1"}'
```

Esperado: `status: ok` com a resposta da IA em `respostas`. ATENÇÃO: isso gasta crédito da OpenAI.
