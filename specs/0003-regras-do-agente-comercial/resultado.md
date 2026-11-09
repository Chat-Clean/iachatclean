# Resultado — SPEC 0003

## O que saiu

Todos os criterios de aceite, menos a abertura para lead parcial e completo (D-13, fora de escopo).

| Area | Onde |
|---|---|
| Oferta de dois horarios, escolha em qualquer formato, confirmacao | `src/domain/agendamento/OfertaDeHorarios.js` |
| Despedida, sem interesse, fora do perfil, robo | `src/domain/atendimento/RegrasDeParada.js` |
| Tres retomadas e silencio entre 21h e 8h | `src/domain/atendimento/Retomadas.js` |
| Nota para o vendedor | `src/domain/atendimento/NotaDoVendedor.js` |
| Tres perguntas do funil, gatilho de reuniao por preco/teste/app | `flow.js` |
| Tom, nome, preco, proximo passo, abertura | `prompts.js` |
| Uma pergunta por vez, nome do perfil, "hoje as 9h" vencido, 3 linhas | `analisadores.js`, `guarda.js` |

## Medicao

`npm run eval` com gpt-6-luna (resposta em xhigh), 7 roteiros, incluindo o novo
`autonomo-perfil-estranho`: **45/45 turnos limpos (100%)**, 0 violacoes. Resposta: mediana 5,3s,
p90 9,3s, max 20,6s. 7 turnos sem pergunta no final (sinal, nao violacao).

Conversa local (servidor real, sem Push, sem Redis, sem escolher horario para nao criar evento):
abertura generica, autonomo sem pergunta de empresa, preco e teste gratis com resposta e dois horarios,
negativa em dois passos, "tchau" sem resposta, robo parado na segunda troca. O nome do perfil
("Deus", "Chacara") nunca apareceu.

## O que mudou no caminho

- **Extracao estourava o prazo.** Com os campos novos, o JSON da extracao (gpt-4o-mini) chegava a
  ~218 tokens e levava de 3,4s a 6,4s; a primeira tentativa tem 5s. Em 4 de 7 turnos a extracao
  falhou e as regras de parada nao dispararam. O prompt agora pede so os campos com valor: ~7 a 25
  tokens, 1,1s.
- **Falso robo.** Mensagem do lead que chega enquanto a IA ainda responde a anterior tinha intervalo
  negativo e contava como "resposta instantanea". So conta intervalo entre 0 e 4s.
- **Nome do perfil:** a guarda olha so o vocativo ("Oi, Deus"), porque perfil de empresa
  ("Pizzaria 3 Irmaos") aparece no texto sem ser usado como nome.
- **Hora fora da oferta** ("16h") so e procurada na grade quando a extracao confirma que e
  preferencia de horario, para "perco 3h por dia" nao virar reuniao.

## Nao verificado

- Agendamento real com resposta "10 h" contra o Google Calendar (cobertura so por teste unitario).
- Retomada gerada pela IA em producao (o varredor so roda com o servidor de pe por horas).
