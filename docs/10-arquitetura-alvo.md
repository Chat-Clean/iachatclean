# 10 — Arquitetura Alvo

Destino da estrangulação. **Não é para ser construída de uma vez** — cada fase do
[plano](11-plano-refatoracao-strangler.md) constrói um pedaço.

## Princípios

1. **Dependências apontam para dentro.** `domain` <- `application` <- `infrastructure` <- `main`.
2. **O domínio não sabe que existe internet.** Nenhum `require('openai'|'axios'|'ioredis'|'express'|'googleapis')`,
   nenhum `process.env`, `Date.now()`, `Math.random()` ou `console.*` dentro de `domain/`.
3. **Portas finas por capacidade**, não por sistema. Uma `ChatCleanPort` que faz tudo viola ISP.
4. **Toda porta nasce com um fake.** Mesma suíte de contrato roda no real e no fake.
5. **Composition root manual.** DI explícita em `main/`, sem container mágico.
6. **Erros esperados são valores**, erros inesperados são exceções. O ACL já segue isso: devolve
   `MensagemRecebida` ou um descarte com motivo, nunca `null` mudo.
7. **Simplicidade proporcional.** Sem CQRS, sem event sourcing, sem microsserviços. O volume não
   justifica e a complexidade custaria mais do que resolve.

## Estrutura de diretórios

Marcado com `[ok]` o que já existe nesta branch.

```
src/
├── domain/                              <- puro, testável sem mocks
│   ├── atendimento/
│   │   ├── Atendimento.js               (agregado raiz)
│   │   ├── Qualificacao.js              (nome, empresa, segmento, dor, urgência)
│   │   ├── EtapaDoFunil.js              (ordem oficial + instrução por etapa)
│   │   ├── HistoricoConversa.js · ControleDeLoop.js
│   │   ├── politicas/
│   │   │   ├── PoliticaDeTransbordo.js
│   │   │   └── PoliticaDeReativacao.js  (follow-up de inatividade)
│   │   └── servicos/
│   │       └── MontadorDeResumo.js
│   ├── agendamento/                     <- específico deste projeto
│   │   ├── Slot.js · JanelaDeAgendamento.js
│   │   └── politicas/PoliticaDeAlmoco.js (bloqueio 12:30-13:30)
│   ├── expediente/
│   │   └── Expediente.js                (hoje: horario.js)
│   ├── crm/
│   │   ├── Oportunidade.js · EtapaDoPipeline.js  (hoje: pipeline.js)
│   │   └── Departamento.js
│   ├── mensageria/
│   │   ├── MensagemRecebida.js          [ok]
│   │   └── MotivoDeDescarte.js          [ok]
│   └── shared/
│       ├── ChatId.js · Telefone.js · Instante.js
│       └── Result.js
│
├── application/                         <- orquestra, não decide regra
│   ├── casos-de-uso/
│   │   ├── ProcessarTurno.js            (o turno síncrono da API)
│   │   ├── AgendarReuniao.js
│   │   ├── TransferirParaEquipe.js
│   │   └── ReativarAtendimentoInativo.js
│   ├── portas/                          <- interfaces (contratos)
│   │   ├── CanalDeMensagem.js · RepositorioDeAtendimento.js
│   │   ├── ExtratorDeInformacoes.js · RedatorDeResposta.js
│   │   ├── TranscritorDeAudio.js · LeitorDeImagem.js
│   │   ├── AgendaExterna.js             (Google Calendar)
│   │   ├── FunilDeVendas.js             (pipeline do CRM)
│   │   ├── NotificadorDeEquipe.js
│   │   ├── ControleDeIdempotencia.js · ControleDeVazao.js
│   │   └── Relogio.js · GeradorDeId.js · Logger.js
│   └── turno/
│       ├── AgrupadorDeRajada.js         (mensagens picotadas)
│       └── CapturaDeRespostas.js        (resposta no corpo vs push)
│
├── infrastructure/                      <- adapters, o único lugar com I/O
│   ├── openai/  (ExtratorOpenAI, RedatorOpenAI, TranscritorWhisper, LeitorDeImagem, prompts/)
│   ├── chatclean/
│   │   ├── CanalChatClean.js            (Push API)
│   │   ├── NotificadorChatClean.js      (nota interna + WhatsApp da equipe)
│   │   ├── PipelineOportunidades.js
│   │   └── acl/tradutor.js              [ok]
│   ├── google/  (AgendaGoogleCalendar.js, autenticacao.js)
│   ├── redis/   (RepositorioRedis, IdempotenciaRedis, VazaoRedis)
│   ├── memoria/ (equivalentes em memória — dev/teste, explícitos)
│   ├── http/    (servidor.js, rotas/, middlewares/autenticacao|correlacao|erros)
│   └── observabilidade/ (LoggerPino com redaction de PII, Metricas)
│
├── main/
│   ├── config.js                        (env validado com zod, uma vez, no boot)
│   ├── container.js                     (composition root)
│   ├── agendadores.js                   (varredor de reativação)
│   └── index.js                         (bootstrap + graceful shutdown)
│
└── shared/
    └── telefone.js                      [ok]

test/
├── unidade/            domínio puro                       [ok]
├── caracterizacao/     congela o comportamento do legado  [ok]
├── contrato/           mesma suíte no adapter real e no fake
└── integracao/         casos de uso com adapters fake
```

## Fluxo de um turno na arquitetura alvo

```
POST /api/mensagem/<segredo>
   |  middleware: correlação (requestId) -> autenticação -> rate-limit
   v
ACL: tradutor.traduzir(corpo)
   |  -> MensagemRecebida   ou   descarte (motivo nomeado -> log + métrica)
   v
AgrupadorDeRajada  (segura mensagens picotadas por AGRUPAR_MENSAGENS_MS)
   v
ProcessarTurno (caso de uso)
   |  repositório carrega Atendimento
   |  domínio decide: etapa, política de transbordo, política de agendamento
   |  portas: RedatorDeResposta, ExtratorDeInformacoes, AgendaExterna, FunilDeVendas
   v
CapturaDeRespostas
   |  destinado ao lead   -> corpo da resposta HTTP
   |  nota/equipe/follow-up -> CanalChatClean (Push API)
   v
200 { status, chatId, respostas[], resposta }
```

## O que muda em relação ao legado

| Hoje (index.js) | Alvo |
|---|---|
| 1168 linhas com tudo | camadas com fronteira verificada por lint |
| `parsePayload` retornava `null` para 8 causas diferentes | descarte com motivo nomeado |
| `process.env` lido em qualquer lugar | só em `main/config.js`, validado com zod |
| Estado do turno em `Map` de módulo | portas com adapter Redis e adapter memória |
| Comportamento verificado à mão, subindo o servidor | suíte sem rede, sem crédito, em menos de 1s |
