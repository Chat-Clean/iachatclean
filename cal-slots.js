// Teste rápido da integração com o Google Calendar (só leitura).
// Rodar:  npm run cal:slots
// Mostra se está configurado e lista os próximos horários livres do time.

require('dotenv').config();
const cal = require('./calendar');

(async () => {
    if (!cal.configurado()) {
        console.log('⚠️ Google Calendar NÃO configurado. Faltam variáveis no .env:');
        console.log('   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, GOOGLE_TEAM_CALENDARS');
        console.log('   Ver GOOGLE_CALENDAR_SETUP.md');
        return;
    }
    try {
        console.log(`Duração da reunião: ${cal.DURACAO_MIN} min | fuso ${cal.TZ}`);
        const slots = await cal.horariosLivres({ dias: 5, max: 5 });
        if (!slots.length) { console.log('Nenhum horário livre encontrado nos próximos dias úteis.'); return; }
        console.log('\nPróximos horários livres do time:');
        slots.forEach((s, i) => console.log(`  ${i + 1}) ${s.label}  (agenda: ${s.calendarId})`));
    } catch (e) {
        console.error('❌ Erro ao consultar o Google Calendar:', e.message);
        console.error('   Confira credenciais, escopo e se as agendas foram compartilhadas com a conta central.');
    }
})();
