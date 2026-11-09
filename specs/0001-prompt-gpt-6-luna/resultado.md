# RESULTADO 0001 — Prompt e medicao prontos para o gpt-6-luna

## O que saiu

| CA | Estado | Evidencia |
|---|---|---|
| CA-001 | ok | `executar-eval.test.js`: desiste do campo depois de MAX_TENTATIVAS |
| CA-002 | ok | `nao-inventa-horario.test.js`: faixa do expediente passa; hora solta continua reprovando |
| CA-003 | ok | `analisadores.test.js`: frase real do Luna reprova `nao-revela-ser-ia` |
| CA-004 | ok | `prompt-resposta.test.js` |
| CA-005 | ok | `prompt-resposta.test.js` |
| CA-006 | ok | extracao via `completarNoPrazo` (8s, reserva de 3s em `none`); falha segue retornando null |
| CA-007 | ok | Luna: 100% limpo, 0 critica, em 2 rodadas |
| CA-008 | ok | gpt-4.1-mini: 93% -> 95% |

Numeros completos em `docs/12-qualidade-da-ia.md`, secao `gpt-6-luna`.

## O que mudou de plano

- A maior parte da diferenca entre os modelos era medicao, nao modelo: o eval nao reproduzia a
  desistencia do funil, e um falso positivo era contado como critica. Corrigido o eval, o Luna foi
  de 76% para 90% antes de qualquer mudanca de prompt.
- A deduplicacao das perguntas ja feitas mantinha a primeira ocorrencia e descartava uma pergunta
  repetida recentemente. O teste pegou; agora vale a ocorrencia mais recente.
- A extracao no Luna tem cauda longa (26s a 36s) com qualquer esforco. Alem do prazo, a recomendacao
  passou a ser manter `MODELO_EXTRACAO=gpt-4o-mini`.

## O que ficou

- D-12: falso positivo de `nao-repete-pergunta` em pergunta curta.
- Duas rodadas por modelo ainda e pouco (D-09). A latencia da resposta variou de 5,9s para 8,4s de
  mediana entre as rodadas do Luna.
