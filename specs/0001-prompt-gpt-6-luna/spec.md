# SPEC 0001 — Prompt e medicao prontos para o gpt-6-luna

## Problema

Primeira rodada do `npm run eval` com `gpt-6-luna` (xhigh), em 2026-10-20: 76% dos turnos limpos
(1 critica, 9 altas), contra 90% do `gpt-4.1-mini` em producao. Ao investigar, nem tudo era o modelo:

1. **O eval nao reproduz o funil.** Producao chama `registrarTentativa` a cada turno
   (`index.js:886`) e desiste do campo depois de `MAX_TENTATIVAS = 2`. O executor do eval nunca
   chama: insiste no mesmo campo para sempre e conta repeticoes que producao nao teria. Vale para
   todas as medicoes ja feitas, de qualquer modelo.
2. **Falso positivo critico.** `naoInventaHorario` so ignora "9h" e "18h" com o expediente
   FECHADO. Com o expediente aberto, citar o horario do time, que esta no proprio SYSTEM_SDR,
   reprova. Em producao a guarda troca a resposta certa por "Deixa eu confirmar a agenda do time".
3. **Revelacao de IA nao detectada.** Perguntado "tem um humano do outro lado?", o Luna respondeu
   "voce esta falando com o atendimento virtual da ChatClean". O prompt so tem resposta pronta para
   "voce e IA?", e o analisador nao conhece essa frase.
4. **Repeticao de pergunta.** A linha "Proxima info do fluxo" leva o texto fixo da pergunta. O Luna
   o copia quase literal a cada turno em que o lead fala de outra coisa.
5. **Extracao sem prazo.** Pior caso medido: 26,3s, fora do orcamento de ~40s por turno.

## Por que agora

Bloqueia a troca de `MODELO_RESPOSTA` para `gpt-6-luna` pedida pelo negocio. Os itens 1 e 2
tambem distorcem a medicao e a guarda do modelo atual.

## Criterios de aceite

| ID | Criterio | Como verificar |
|---|---|---|
| CA-001 | O eval registra a tentativa do campo a cada turno, como `index.js` | teste em `executar-eval.test.js` |
| CA-002 | "das 9h as 18h" (horario do time) nao reprova `nao-inventa-horario`, com expediente aberto ou fechado; hora de reuniao inventada continua reprovando | teste em `analisadores.test.js` |
| CA-003 | "voce esta falando com o atendimento virtual" e variacoes reprovam `nao-revela-ser-ia` | teste em `analisadores.test.js` |
| CA-004 | O prompt de resposta lista as perguntas ja feitas e manda nao repeti-las | teste em `prompt-resposta.test.js` |
| CA-005 | O SYSTEM_SDR cobre "tem humano?", "e robo?" com a resposta institucional | teste em `prompt-resposta.test.js` |
| CA-006 | A extracao tem prazo; estourou, refaz com esforco `none`; falhou, segue o turno como hoje (null) | revisao + `completar-openai.test.js` |
| CA-007 | `gpt-6-luna` nao fica atras do `gpt-4.1-mini` em turnos limpos e nao tem critica | `npm run eval` nos dois modelos, antes e depois do prompt |
| CA-008 | O `gpt-4.1-mini` (producao) nao piora com o prompt novo | `npm run eval` antes e depois |

## Fora de escopo

- Trocar o modelo em producao (decisao do negocio, no EasyPanel).
- Reescrever o SYSTEM_SDR ou o roteiro de qualificacao.
- Juiz LLM para qualidade da resposta (divida D-07).

## Riscos

| Risco | Mitigacao |
|---|---|
| Prompt muda o comportamento do modelo de producao | CA-008: eval do gpt-4.1-mini antes e depois |
| Eval de rodada unica e ruidoso (D-09) | Comparar as mesmas regras nos dois modelos; resultado registrado como indicio |
| Proibir repetir pergunta trava a coleta de um campo | O funil ja desiste depois de 2 tentativas; a instrucao permite perguntar de outro angulo |
