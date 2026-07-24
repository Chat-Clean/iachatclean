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
3. **Tela de consentimento OAuth**: tipo "Externo"; preencha o básico; em **Usuários de teste**, adicione a **conta central** (senão o consentimento é bloqueado). Não precisa publicar/verificar pra uso interno.
4. **Credenciais → Criar credenciais → ID do cliente OAuth → Tipo: Aplicativo da Web**.
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

## Notas
- Fuso fixo Natal-RN (UTC-3). Janela considerada: seg–sex, 9h–18h.
- Um horário é oferecido se **ao menos uma** agenda do time estiver livre; o evento é criado nessa agenda.
- "Só reserva na agenda do time": o evento é um bloqueio com os dados do lead na descrição; o cliente **não** recebe convite — a equipe chama no WhatsApp no horário.
- Sem as variáveis, o bot continua funcionando: ele só coleta o horário preferido e a equipe agenda manualmente.
