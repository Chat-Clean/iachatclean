// =============================================================
//  GOOGLE AUTH — gera o GOOGLE_REFRESH_TOKEN (rodar UMA vez, local)
//
//  Pré: no .env já deve ter GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET
//  (criados no Google Cloud → OAuth client tipo "Web" com o redirect
//  http://localhost:5599/oauth2callback).
//
//  Rodar:  npm run gauth
//  1) abra o link que aparecer no terminal e autorize com a conta
//     "central" (a que recebe o compartilhamento das agendas do time);
//  2) o refresh token é impresso — copie para GOOGLE_REFRESH_TOKEN no .env.
// =============================================================

require('dotenv').config();
const http = require('http');
const { google } = require('googleapis');

const PORT = 5599;
const REDIRECT = `http://localhost:${PORT}/oauth2callback`;
const SCOPES = ['https://www.googleapis.com/auth/calendar'];

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    console.error('❌ Defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no .env antes de rodar.');
    process.exit(1);
}

const oauth2 = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, REDIRECT);

const authUrl = oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',           // força retornar refresh_token mesmo em reautorização
    scope: SCOPES
});

const server = http.createServer(async (req, res) => {
    if (!req.url.startsWith('/oauth2callback')) { res.writeHead(404); res.end(); return; }
    const code = new URL(req.url, REDIRECT).searchParams.get('code');
    if (!code) { res.writeHead(400); res.end('Sem code.'); return; }
    try {
        const { tokens } = await oauth2.getToken(code);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h2>Pronto! Pode fechar esta aba e voltar ao terminal.</h2>');
        console.log('\n✅ Autorizado. Copie a linha abaixo para o seu .env:\n');
        if (tokens.refresh_token) {
            console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
        } else {
            console.log('⚠️ Não veio refresh_token. Revogue o acesso do app em https://myaccount.google.com/permissions e rode de novo.\n');
        }
    } catch (e) {
        res.writeHead(500); res.end('Erro: ' + e.message);
        console.error('❌ Erro ao trocar o code por token:', e.message);
    } finally {
        setTimeout(() => { server.close(); process.exit(0); }, 500);
    }
});

server.listen(PORT, () => {
    console.log('\n🔑 Abra este link no navegador e autorize com a conta central das agendas:\n');
    console.log(authUrl + '\n');
    console.log(`(aguardando o retorno em ${REDIRECT} ...)`);
});
