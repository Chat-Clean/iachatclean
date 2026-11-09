# SPEC 0003 — Regras do agente comercial (documento ORB, novembro de 2026)

## Problema

O negocio leu os atendimentos reais e consolidou as regras de resposta no documento "Como a IA deve
responder" (ORB, novembro de 2026). Os casos que motivaram:

- o bot chama o lead pelo nome do perfil do WhatsApp ("Oi chacara", "Oi Deus");
- pergunta de novo o que ja foi respondido ("Instrutor de transito autonomo" -> "qual o nome da sua
  empresa?" pela segunda vez);
- responde preco com o texto padrao e nao conduz para a reuniao;
- oferece tres horarios numerados e, quando o lead responde "10 h", pergunta de novo;
- reativa o lead so com "ainda por ai?";
- responde despedida com despedida, 30 vezes, contra o robo de uma loja.

## Decisoes de interpretacao

| Regra do documento | Como foi implementada |
|---|---|
| "3 perguntas: empresa -> quem decide -> quando quer comecar" | O funil pergunta so esses tres campos. Nome, segmento e dor deixam de ser perguntados e seguem capturados quando o lead fala por conta propria |
| "Usar o nome que o lead deu" | O nome do perfil do WhatsApp fica em `nomeContato`, usado so no CRM e na nota da equipe. A IA usa `nome` apenas quando o lead o disse |
| "Oferecer 2 horarios" | O primeiro horario livre e o primeiro do outro periodo (manha/tarde) ou do dia seguinte, em texto corrido: "Amanha as 10h ou as 14h?" |
| "Resposta ambigua: escolher o mais proximo e confirmar" | "de manha", "pode ser", "ok" agendam o primeiro horario compativel e confirmam. Hora fora da oferta ("16h") procura na grade livre dos mesmos dias |
| "O Lucas te chama aqui 5 min antes" | Nome do especialista em `NOME_ESPECIALISTA`; vazio = "Um especialista do time" |
| "No maximo 3 retomadas ... sem resposta, encerrar com porta aberta" | A terceira retomada e a de porta aberta: 30 min, 1 dia e 3 dias depois da ultima fala do lead |
| "Nao mandar mensagem entre 21h e 8h" | Vale para mensagem ativa (retomada). Resposta a quem escreveu de madrugada continua saindo |
| "Despedida: nao responder despedida com despedida" | Despedida do lead recebe um fecho curto, uma unica vez. Depois disso, despedida, agradecimento ou robo nao recebem resposta |
| "Lead disse nao: uma tentativa de entender o motivo" | Primeira negativa: uma pergunta sobre o motivo. Segunda: agradece e encerra, sem nota de lead qualificado |
| "Outro robo: parar em no maximo 3 trocas" | Sinal de robo (auto-resposta, menu, "pode falar comigo por esta conversa", resposta em menos de 4s) em duas mensagens seguidas encerra com um fecho e silencia; a equipe e avisada. Texto repetido segue a regra antiga (vai para uma pessoa), porque quase sempre e gente que nao foi entendida |
| "Nota so com o que o lead disse" | Contato, empresa, quem decide, quando quer comecar, duvida principal, horario marcado e a origem do anuncio. Segmento deduzido, canais, volume e cidade saem da nota |

## Criterios de aceite

| ID | Criterio | Como verificar |
|---|---|---|
| CA-001 | Prompt limita a 3 linhas e uma pergunta por mensagem; mais de uma pergunta e violacao corrigida pela guarda | `regras-agente-comercial.test.js`, `analisadores.test.js` |
| CA-002 | Nome do perfil do WhatsApp nunca vai para o prompt nem para a resposta; usar o nome do perfil e violacao corrigida | `regras-agente-comercial.test.js` |
| CA-003 | Toda mensagem do fluxo fecha com proximo passo: uma pergunta ou dois horarios | prompt + eval |
| CA-004 | O que a IA nao sabe ou nao pode garantir vai para o especialista | prompt + eval |
| CA-005 | Abertura generica: apresenta o comercial e pergunta o nome da empresa | `regras-agente-comercial.test.js` + eval |
| CA-006 | Funil pergunta empresa, quem decide e quando quer comecar, nessa ordem | `flow-funil.test.js` |
| CA-007 | Autonomo responde empresa e quem decide; nada ja respondido e perguntado de novo | `regras-agente-comercial.test.js` + eval |
| CA-008 | Lead muda de assunto: responde e retoma a pergunta pendente na mesma mensagem | prompt + eval |
| CA-009 | Sem texto padrao "plataforma de CRM multicanal" fora de quando perguntam o que e a ChatClean | prompt |
| CA-010 | Preco: nunca valor, faixa ou "a partir de"; diz que o especialista monta a proposta e oferece dois horarios | `regras-agente-comercial.test.js` + eval |
| CA-011 | Teste, app ou integracao sem certeza: o especialista mostra na reuniao e oferece horario | `regras-agente-comercial.test.js` |
| CA-012 | Oferta de reuniao com 2 horarios em texto corrido | `horarios-oferecidos.test.js` |
| CA-013 | Escolha aceita "1", "10h", "as 10", "10:00", "de manha", "a tarde", "o primeiro", "segunda", "pode ser" | `horarios-oferecidos.test.js` |
| CA-014 | Confirmacao com dia da semana, data e hora, nome do especialista e "5 min antes"; nao pergunta de novo | `horarios-oferecidos.test.js` |
| CA-015 | Horario vencido nunca e oferecido nem agendado; "o time retorna hoje as 9h" depois das 9h e violacao | `horarios-oferecidos.test.js`, `analisadores.test.js` |
| CA-016 | Ate 3 retomadas (30 min, 1 dia, 3 dias), ligadas ao que o lead disse; a terceira deixa a porta aberta e encerra | `retomadas.test.js` |
| CA-017 | Nenhuma retomada entre 21h e 8h: a mensagem e adiada para as 8h | `retomadas.test.js` |
| CA-018 | Lead diz nao: uma tentativa de entender o motivo; mantendo, agradece e encerra sem marcar como qualificado | `regras-agente-comercial.test.js` |
| CA-019 | Fora do perfil: resposta educada, encerra, sem reuniao | `regras-agente-comercial.test.js` |
| CA-020 | Despedida recebe um fecho uma vez; despedida depois do fecho fica sem resposta | `regras-agente-comercial.test.js` |
| CA-021 | Robo do outro lado: no maximo 3 trocas, fecho e silencio; equipe avisada | `regras-agente-comercial.test.js` |
| CA-022 | Vendedor assumiu: IA em silencio (ja existia; segue coberto) | `tradutor-payload.test.js` |
| CA-023 | Nota para o vendedor so com o que o lead disse | `regras-agente-comercial.test.js` |

## Fora de escopo

- Abertura para lead **parcial** e **completo** (secao 02 do documento). Depende de saber de onde
  vem o diagnostico que o lead preencheu; sem essa fonte todo lead cai na abertura generica. Fica
  registrado como divida D-13 em `docs/13-estado-e-continuacao.md`.
- Duracao da reuniao: o documento cita "15 min", e a grade usa `REUNIAO_DURACAO_MIN`. O texto da IA
  nao cita duracao.

## Riscos

| Risco | Mitigacao |
|---|---|
| "Voltar para a pergunta pendente" esbarra na guarda de pergunta repetida | Prompt pede outro angulo; o eval mede as duas regras juntas |
| Agendar sozinho em resposta ambigua ("pode ser") | So com a oferta de dois horarios aberta; a confirmacao diz dia, data e hora |
| Retomada gerada pela IA quebrar regra | Passa pela mesma guarda; violacao cai no texto pronto |
| Robo confundido com humano rapido | Exige sinal em duas mensagens; texto repetido por humano segue indo para a equipe, como hoje |
