# SPEC 0002 — Oferecer a reuniao quando o lead demonstra interesse

## Problema

Teste do negocio em 2026-10-20: o lead demonstrou interesse e pediu para agendar, e o bot respondeu
que um especialista ia falar com ele e combinar o horario, sem oferecer a agenda. Tres causas:

1. "Podemos marcar uma reuniao com um especialista?" volta da extracao com `querFalarComHumano` e
   `querAgendar` juntos. O encaminhamento para humano vem antes do agendamento no turno e encerra
   o atendimento (`finalizado`), entao os horarios nunca eram consultados.
2. Interesse ("gostei", "quero contratar", "como faco pra contratar?") nao era sinal de nada: a
   agenda so era oferecida no fim da qualificacao ou com pedido explicito.
3. Lead ja encaminhado caia direto na resposta pos-encaminhamento, que nunca consulta a agenda.

## Criterios de aceite

| ID | Criterio | Como verificar |
|---|---|---|
| CA-001 | Pedido de reuniao "com especialista" oferece a agenda; "quero falar com uma pessoa" sem reuniao segue encaminhando | `oferta-de-reuniao.test.js` + conversa local |
| CA-002 | Interesse demonstrado oferece a agenda no meio da qualificacao | `oferta-de-reuniao.test.js` + conversa local |
| CA-003 | Interesse com pergunta junto: responde a duvida e oferece a agenda no mesmo turno | `oferta-de-reuniao.test.js` + conversa local |
| CA-004 | Recusou a reuniao: interesse sozinho nao reoferece; pedido explicito sim | `oferta-de-reuniao.test.js` |
| CA-005 | Extracao devolve `demonstrouInteresse` e liga reuniao com especialista a `querAgendar` | `oferta-de-reuniao.test.js` + chamada real ao gpt-4o-mini |
| CA-006 | Lead ja encaminhado que pede reuniao recebe a agenda | conversa local |

## Fora de escopo

- Texto da grade de horarios e da confirmacao do agendamento.
- Agenda indisponivel (token expirado, sem horario): segue o comportamento de hoje, encaminha.

## Riscos

| Risco | Mitigacao |
|---|---|
| Oferecer reuniao cedo demais | So com interesse explicito; recusa bloqueia nova oferta por interesse |
| Lead encaminhado ganha uma chamada de extracao por mensagem | So enquanto a agenda esta configurada e nao ha reuniao marcada |
