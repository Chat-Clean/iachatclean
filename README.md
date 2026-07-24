# SDR Virtual ChatClean — IA Externa

IA de pré-vendas (SDR) da **própria ChatClean**, no padrão de IA externa da plataforma (Webhook de entrada + Push API de saída). Roda num servidor Node.js próprio: acolhe o lead, apresenta a ChatClean, **qualifica** (BANT adaptado) e **encaminha para o especialista do Comercial** — sem nunca abrir preço.

Mesma arquitetura do projeto `iaimperialbones`, porém enxuta: sem catálogo, sem tabela de preços e sem mockup — é um SDR de captação.

## Arquitetura

```
Cliente WhatsApp → ChatClean CRM ──POST /webhook──▶ servidor Node.js
                                                       ↓ GPT-4o-mini (extrai + responde)
Cliente WhatsApp ◀── ChatClean Push API ◀──POST CC_PUSH_URL {number, body, externalKey}
```

O ChatClean cuida só do transporte. Toda a inteligência (persona, fluxo de qualificação, objeções, transbordo) roda aqui.

## O que o bot faz

- **Persona oficial ChatClean:** tom de WhatsApp, sem markdown, no máximo 1 emoji, anti-jailbreak, nunca revela que é IA nem passa preço.
- **Fluxo de qualificação (um dado por vez):** nome → objetivo → empresa → segmento → cidade/UF → canais → volume → dor → urgência → decisor → transfere pro Comercial.
- **Base de conhecimento:** recursos da plataforma (CRM, canais, IA GPT-4o, automações), segmentos que mais convertem e biblioteca de objeções — tudo em `data.js`.
- **Transbordo:** ao qualificar (ou se o lead pedir humano), envia o resumo estruturado como nota interna no ticket + WhatsApp da equipe e sinaliza `Transferir para o departamento Comercial`. Cliente atual pedindo suporte → `Suporte`.
- **Mídia:** áudio é transcrito (Whisper); imagem/documento têm acuse humanizado; vídeo/sticker caem no fallback de texto.
- **Estado durável:** conversas no Redis (fallback em memória) + follow-up de reativação após 30 min de inatividade.

## Arquivos

| Arquivo | Papel |
|---|---|
| `index.js` | Servidor Express: webhook, Push, state machine, Whisper, follow-up, transbordo, agendamento |
| `data.js` | Conteúdo de negócio (empresa, recursos, segmentos, objeções, departamentos) |
| `prompts.js` | `SYSTEM_SDR` (prompt-mestre) + extração (temp 0) + resposta (temp 0.7) |
| `flow.js` | State machine de qualificação (pura, compartilhada com os testers) |
| `horario.js` | Expediente do time (seg–sex 9h–18h, Natal-RN) → modo plantão |
| `calendar.js` | Google Calendar: horários livres (freebusy) + criar/cancelar reunião |
| `store.js` | Estado das conversas em Redis + fallback em memória |

## Rodar local

```bash
npm install
cp .env.example .env      # preencher OPENAI_API_KEY (e CC_PUSH_URL p/ o servidor)
npm run chat              # conversa interativa no terminal (só precisa da OpenAI)
npm run sim               # simulação de qualificação completa (SIM_DATA=... força plantão)
npm start                 # sobe o servidor (webhook/Push)
```

`GET /health` → `{ status: 'ok' }` · `GET /leads` → leads ativos.

### Google Calendar (agendamento)
Opcional. Ver `GOOGLE_CALENDAR_SETUP.md`. Comandos: `npm run gauth` (gera o refresh token) · `npm run cal:slots` (testa a leitura de horários livres).

## Deploy (Easypanel)

1. Push do repositório para o GitHub da ChatClean.
2. Easypanel → Create Service → App → Source GitHub → Build por Dockerfile.
3. Variáveis de ambiente do `.env.example` (OpenAI, `CC_PUSH_URL`, `EQUIPE_NUMERO`, `REDIS_URL`).
4. Proxy/Container port = `3000`.
5. No painel ChatClean (Configurações → API/Webhook):
   - **URL Webhook** = `https://SEU_APP/webhook` e **marcar o evento de mensagem recebida** (sem evento, nada dispara).
   - **Token de autenticação:** deixar `WEBHOOK_SECRET` vazio (o ChatClean não envia token no header).
   - `CC_PUSH_URL` é gerada nessa mesma tela (Adicionar).
6. Teste com o número em `IA_ALLOWED_CONTACTS` antes do go-live; para abrir a todos, esvazie a lista.

> Referência técnica: modelo de IA externa em `IA Externa/modelo-ia-externa-webhook` (vault) e deploy do `iaimperialbones`.

---

*ChatClean — Natal/RN | SDR Virtual (IA Externa)*
