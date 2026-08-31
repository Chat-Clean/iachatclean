# Setup — Google Calendar (Gmail comum)

Objetivo: a IA consultar os horários livres do time e **reservar a reunião na agenda do time** (sem convidar o cliente). Como são contas Gmail comuns, usamos **uma conta "central"** que recebe o compartilhamento das agendas de todo mundo, e o servidor autentica como essa conta via OAuth.

Faça uma vez. Ao final, o `npm run cal:slots` tem que listar horários livres.

---

## 1. Conta central

Escolha (ou crie) uma conta Gmail que será a "secretária" — ex.: `agenda.chatclean@gmail.com`. É ela que o servidor vai usar.

## 2. Compartilhar as agendas do time com a conta central

Cada pessoa do time (Alan, especialistas...) faz, no Google Agenda:
- **Configurações da agenda → Compartilhar com pessoas específicas → Adicionar** a conta central.
- Permissão: **"Fazer alterações nos eventos"**.

Anote os e-mails das agendas do time → vão em `GOOGLE_TEAM_CALENDARS`.

## 3. Projeto no Google Cloud + API

1. https://console.cloud.google.com → criar projeto (ex.: "ChatClean SDR").
2. **APIs e serviços → Biblioteca → Google Calendar API → Ativar**.
3. **Tela de consentimento OAuth**: preencha o básico e adicione a **conta central**.
4. **Status de publicação: mude para "Em produção"** (`Publishing status → In production`).

   > **ATENÇÃO — é isto que faz o token durar.** Enquanto a tela de consentimento
   > estiver em **"Teste"**, o Google **expira o refresh token em 7 dias**, e o
   > agendamento para de funcionar com `invalid_grant` toda semana. Em produção o
   > refresh token não tem prazo.
   >
   > Publicar **não** exige passar pela verificação do Google. A tela de "app não
   > verificado" continua aparecendo na hora de autorizar (é uma vez só, e você
   > clica em "Avançado → Ir para..."), mas o token deixa de expirar.
   >
   > Se a conta central for de um **Google Workspace**, prefira tipo de usuário
   > **"Interno"**: sem aviso de app não verificado e sem prazo. Contas Gmail
   > comuns não têm essa opção — use "Externo" + "Em produção".

5. **Credenciais → Criar credenciais → ID do cliente OAuth → Tipo: Aplicativo da Web**.
   - **URI de redirecionamento autorizado:** `http://localhost:5599/oauth2callback`
   - Salve o **Client ID** e **Client secret**.

## 4. Preencher o .env

```
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
GOOGLE_TEAM_CALENDARS=alan@gmail.com,especialista2@gmail.com
GOOGLE_BOOKING_CALENDAR=        # vazio = usa a 1ª da lista
REUNIAO_DURACAO_MIN=30
```

## 5. Gerar o refresh token

```
npm run gauth
```
- Abra o link, **autorize com a conta central**.
- Copie a linha `GOOGLE_REFRESH_TOKEN=...` que aparece no terminal para o `.env`.

## 6. Testar

```
npm run cal:slots
```
Deve listar os próximos horários livres do time. Se listar, a integração está funcionando e podemos ligar no atendimento (oferecer os horários e criar o evento quando o cliente escolher).

---

## Quando parar de funcionar: `invalid_grant`

Sintoma: `npm run cal:slots` responde `❌ Erro ao consultar o Google Calendar: invalid_grant`,
e em produção **o bot para de oferecer horários sem avisar** — cai no fluxo normal e só fala
que a equipe retorna, sem criar evento nenhum. Confira em `GET /diag` o campo `calendarLive`.

Causas, da mais comum para a menos:

| Causa | Como saber | Correção |
|---|---|---|
| Tela de consentimento em **"Teste"** | Acontece a cada ~7 dias, como relógio | Mudar publicação para **"Em produção"** (passo 3.4) e gerar o token de novo. Resolve de vez |
| Acesso revogado na conta central | Alguém removeu o app em myaccount.google.com/permissions | Reautorizar |
| Client secret trocado/rotacionado | Coincide com uma mexida no Google Cloud | Atualizar `GOOGLE_CLIENT_SECRET` e reautorizar |
| Token sem uso por 6 meses | Integração ficou parada | Reautorizar |
| Mais de 50 tokens para o mesmo par app+conta | Muitas reautorizações seguidas | Os antigos são revogados automaticamente; use o mais recente |

Depois de reautorizar, **não esqueça do EasyPanel**: o `npm run gauth` grava no `.env` local,
mas produção lê a variável do painel. Atualize `GOOGLE_REFRESH_TOKEN` lá e faça redeploy.

## Notas
- Fuso fixo Natal-RN (UTC-3). Janela considerada: seg–sex, 9h–18h.
- Um horário é oferecido se **ao menos uma** agenda do time estiver livre; o evento é criado nessa agenda.
- "Só reserva na agenda do time": o evento é um bloqueio com os dados do lead na descrição; o cliente **não** recebe convite — a equipe chama no WhatsApp no horário.
- Sem as variáveis, o bot continua funcionando: ele só coleta o horário preferido e a equipe agenda manualmente.
