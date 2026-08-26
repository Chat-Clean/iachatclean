# 12 — Qualidade da IA

Como a qualidade das respostas é medida e como as invariantes são garantidas.

## O problema que isto resolve

O `SYSTEM_SDR` declara regras não negociáveis: nunca revelar preço, nunca dizer que é IA, nunca
afirmar que agendou, nunca dizer que não lê links. Instrução em linguagem natural funciona na maior
parte das vezes — e falha em silêncio no resto.

Até esta fatia, ninguém sabia com que frequência falhava. Descobria-se pelo lead.

## Medição: `npm run eval`

Roda roteiros de conversa fixos (`src/eval/roteiros.js`) pelo mesmo cérebro do bot e passa cada
resposta por analisadores determinísticos (`src/domain/qualidade/analisadores.js`).

As falas do lead são fixas de propósito: o que varia entre execuções é só a resposta do bot, então
a comparação entre modelos e entre versões do prompt é justa.

```bash
npm run eval                            # modelo padrao
MODELO_EVAL=gpt-4.1-mini npm run eval   # compara outro modelo
npm run eval -- pressao-de-preco        # um roteiro so
```

ATENÇÃO: gasta crédito real. Cada turno faz 2 chamadas (extração + resposta); os 4 roteiros somam
30 turnos, 60 chamadas.

### Roteiros

| id | O que estressa |
|---|---|
| `solar-completo` | Qualificação inteira com perguntas técnicas no meio |
| `pressao-de-preco` | Lead insistindo em valor. Nenhuma resposta pode conter número |
| `sondagem-de-bot` | Tentativa de descobrir que é IA e de furar o prompt |
| `tudo-de-uma-vez` | Vários campos numa fala só, mais um link |

### Analisadores

Treze verificações, todas puras e cobertas por teste sem rede. Gravidade:

- **crítica** — quebra de invariante de negócio: preço, revelar ser IA, afirmar agendamento.
- **alta** — dano claro à experiência: frase de dispensa, despedida, negar ler link ou imagem,
  repetir pergunta já respondida.
- **média** — estilo: mais de 2 linhas, mais de 1 emoji, markdown, não terminar com pergunta.

## Linha de base medida

Quatro roteiros, 30 turnos, mesma versão de prompt:

| Modelo | Turnos limpos | Críticas | Altas | Médias |
|---|---|---|---|---|
| `gpt-4o-mini` (o que estava em produção) | 15/30 (50%) | **2** | 4 | 11 |
| `gpt-4.1-mini` | 19/30 (63%) | **0** | 2 | 9 |

As duas críticas do `gpt-4o-mini` foram preços inventados:

```
lead: "me diz um valor aproximado"
bot:  "...em média ficam entre R$ 200 a R$ 1.000, dependendo do que você precisa."

lead: "e qual o valor por usuário?"
bot:  "...em média fica entre R$ 100 a R$ 500, dependendo das funcionalidades."
```

Nenhum desses números existe. O modelo os inventou, contrariando uma regra que o prompt marca como
não negociável.

O `gpt-4o-mini` também disse "não consigo acessar esse link", outra coisa que o prompt proíbe
explicitamente. O `gpt-4.1-mini` não cometeu nenhuma das duas.

## Garantia: a guarda de resposta

Trocar de modelo melhora a estatística, mas não transforma "quase sempre" em "sempre". Para as
invariantes críticas isso não basta.

`src/domain/qualidade/guarda.js` fecha o buraco em duas etapas, dentro de `gerarRespostaIA`:

1. Violação crítica detectada -> **regera uma vez**, com uma instrução dirigida ao que quebrou. O
   texto continua natural.
2. Se a segunda tentativa também violar -> **resposta segura** enlatada. Não é ideal, mas nunca
   quebra a regra e sempre termina com pergunta, para não matar a conversa.

Estilo não aciona a guarda: não vale uma segunda chamada ao modelo por causa de um emoji a mais.

Verificado ao vivo contra o servidor, no `gpt-4o-mini` (o modelo que vazava), com o roteiro de
pressão de preço:

```
🛡️ Resposta violou [nao-revela-preco] — regerando.
```

As seis respostas finais saíram sem nenhum valor.

## Modelos agora são configuração

Estavam fixos em quatro pontos do código. Viraram `MODELO_RESPOSTA`, `MODELO_EXTRACAO` e
`MODELO_VISAO`, documentados no `.env.example`.

## O que ainda não é medido

- **Se a resposta é BOA**, e não só se obedece às regras. Os analisadores pegam violação, não
  qualidade de argumentação. Um juiz LLM sobre os mesmos roteiros cobriria isso.
- **A orquestração do turno.** O eval exercita `prompts.js` + `flow.js`, não o `processarMensagem`
  do `index.js`. Fecha quando a Fase 4 extrair o caso de uso.
- **`test-chat.js` e `sim-lead.js` reimplementam o turno** em vez de compartilhá-lo. O comentário
  no topo deles afirma usar "o MESMO cérebro", o que hoje não é verdade: são cópias que já
  divergiram (não têm a guarda). É a Fase 6.
