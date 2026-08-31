# 11 — Plano de Refatoração (Strangler Fig)

## A estratégia em uma frase

Código novo nasce ao lado do velho, o legado passa a **delegar**, e só quando o novo está coberto
por testes o velho morre. Em nenhum momento existe um "big bang" onde o sistema fica quebrado.

## Regras do jogo (inegociáveis)

1. **Nenhuma fatia começa sem rede de testes.** Primeiro o teste que congela o comportamento
   atual, depois a extração.
2. **Uma fatia por vez, entregável.** Cada fase termina com `npm test` verde e o servidor
   respondendo igual.
3. **Sem mudança de comportamento não pedida.** Se a extração revelar um bug, ele vira dívida
   documentada e o teste **congela o comportamento errado** até que o negócio decida mudá-lo.
4. **A barreira de camada é lint, não combinado.** Regra que depende de disciplina apodrece.

## Visão geral das fases

| Fase | O que entrega | Estado |
|---|---|---|
| 0 | Rede de segurança: ferramental, testes, barreira de camada | **concluída** |
| 1 | ACL da borda (payload de entrada) | **concluída** |
| 2 | Portas e adapters (canal, repositório, OpenAI, agenda, funil) | pendente |
| 3 | O domínio (Atendimento, Qualificacao, Expediente, Agendamento) | pendente |
| 4 | Casos de uso (ProcessarTurno e irmãos) | pendente |
| 5 | Mídia e política de envio | pendente |
| 6 | Unificação dos testers (`chat`, `sim`) | pendente |
| 7 | Prompts como artefato versionado | pendente |
| 8 | Resiliência, escala e observabilidade | pendente |
| 9 | Tipagem (opcional, recomendada) | pendente |
| 10 | Fim do legado: `index.js` vira bootstrap | pendente |

---

# FASE 0 — Rede de segurança [concluída]

### 0.1 Ferramental

`vitest` (suíte sem rede, `testTimeout` 5s), `eslint` com a barreira de camada, `prettier`,
`typecheck` via `jsconfig.json` com `checkJs`.

A barreira **foi verificada com um arquivo de violação proposital**: um módulo em `src/domain/`
com `require('axios')`, `require('openai')` e `process.env` produziu três erros de lint antes de
ser apagado. Regra de barreira que nunca falhou não é barreira, é decoração.

ATENÇÃO: `no-restricted-imports` só enxerga `import` de ESM. Este projeto é CommonJS, então a
barreira olha a **chamada `require()`** via `no-restricted-syntax`.

### 0.2 Primeira extração pura

`src/shared/telefone.js` — `normalizarPhone`, `nucleoNumero`, `contatoPermitido`. Escolhido por
ser o de menor risco e maior alcance (o telefone é a chave do Redis). 14 testes.

A única diferença de comportamento: `contatoPermitido` passou a **receber a allow-list por
parâmetro** em vez de ler a constante de módulo. É o que tira `process.env` da camada pura.

---

# FASE 1 — ACL da borda [concluída]

O reconhecimento de formato saiu do `index.js` para
`src/infrastructure/chatclean/acl/tradutor.js`, com 28 testes de caracterização.

**Por que esta foi a primeira fatia de verdade:** foi exatamente aqui que o sistema mais custou a
diagnosticar. O `parsePayload` devolvia `null` para oito causas distintas — grupo, eco, ticket
assumido, nota interna, evento que não é mensagem, formato duplicado, sem telefone e formato
desconhecido. Todas apareciam no log como "payload não reconhecido".

Agora o tradutor devolve `MensagemRecebida` ou um **descarte com motivo nomeado**, e o log diz
qual foi:

```
Descartado [evento-ignorado]: evento ignorado (só NewMessage vira conversa) — MessageAck
```

Formatos cobertos: envelope do n8n (array + `.body`), ChatClean aninhado (`message` + `ticket`),
plano (`{number, body, type}`), JSON como string, envelopes `data`/`payload`/`json`, e o disparo
duplicado `numero_cliente`.

---

# FASE 2 — Portas e adapters [próxima]

Ordem sugerida, da mais isolada para a mais entrelaçada:

### 2.1 `CanalDeMensagem`

Hoje `ccPush` mistura três coisas: entrega ao lead (que virou resposta HTTP), nota interna e aviso
à equipe. A porta separa **entregar ao lead** de **notificar internamente**, e a captura do modo
síncrono deixa de ser um `if` dentro do adapter.

### 2.2 `RepositorioDeAtendimento`

`store.js` já tem a forma certa (Redis com fallback em memória). Vira porta com suíte de contrato
rodando no adapter real e no fake.

### 2.3 `ExtratorDeInformacoes` e `RedatorDeResposta`

Separa "extrair dados da fala do cliente" de "escrever a resposta". Hoje ambos vivem em
`gerarRespostaIA`/`extrairInformacoesComIA` com o cliente OpenAI embutido.

### 2.4 `AgendaExterna` e `FunilDeVendas`

`calendar.js` e `pipeline.js` já são razoavelmente isolados — são bons candidatos a porta com
fake, o que permite testar o agendamento sem tocar no Google.

### 2.5 `container.js`

Composition root manual. Só depois dele o `index.js` pode começar a encolher.

---

# FASES 3 a 10

Detalhamento quando a Fase 2 fechar. O esqueleto está em
[10-arquitetura-alvo.md](10-arquitetura-alvo.md).

---

## Métricas de progresso

| Métrica | Início da refatoração (9840de1) | Agora |
|---|---|---|
| Linhas em `index.js` | 1319 | 1168 |
| Testes automatizados | 0 | 44 |
| Módulos em `src/` | 0 | 4 |
| Fronteira de camada verificada | não | sim (lint) |

## Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Refatoração quebrar produção | Strangler + teste de caracterização antes de cada extração |
| Fatia grande demais para revisar | Uma intenção por commit; fase termina com suíte verde |
| Refatoração parar no meio e virar dois sistemas | `docs/13-estado-e-continuacao.md` sempre atualizado |
| Barreira de camada apodrecer | É lint, roda no CI, e foi testada com violação proposital |
