// =============================================================
//  NOTA PARA O VENDEDOR (spec 0003, secao 08)
//
//  Registra SO o que o lead disse: empresa, quem decide, quando quer comecar,
//  a duvida principal e o horario marcado. Nada deduzido: o segmento tirado do
//  nome da empresa, canais, volume e cidade sairam da nota. O nome do perfil do
//  WhatsApp entra so para identificar o contato.
//
//  Modulo puro. Reusado na nota do ticket, no WhatsApp da equipe e na
//  descricao do evento no Google Calendar.
// =============================================================

function montarNota(leadData, chatId, opcoes = {}) {
    const contato = leadData.nome || leadData.nomeContato || 'Lead';
    const linhas = [
        `🎯 LEAD QUALIFICADO — SDR ChatClean${opcoes.tagExtra ? ' [' + opcoes.tagExtra + ']' : ''}`,
        '',
        `Contato: ${contato} (${chatId})`,
        `Empresa: ${leadData.empresa || 'Não informado'}`,
        `Quem decide: ${leadData.decisor || 'Não informado'}`,
        `Quando quer começar: ${leadData.urgencia || 'Não informado'}`,
        `Dúvida principal: ${leadData.duvidaPrincipal || leadData.dor || 'Não informado'}`,
        leadData.reuniaoAgendada ? `📅 Horário marcado: ${leadData.reuniaoAgendada.label}` : null,
        !leadData.reuniaoAgendada && leadData.horarioPreferido ? `Horário que o lead sugeriu: ${leadData.horarioPreferido}` : null,
        leadData.origemAnuncio
            ? `Origem: anúncio — "${leadData.origemAnuncio.mensagem || 'mensagem não identificada'}"` +
              (leadData.origemAnuncio.link ? ` (${leadData.origemAnuncio.link})` : '')
            : null,
        opcoes.proximoExpediente ? `Retorno sugerido: ${opcoes.proximoExpediente}` : null,
        '',
        `➡️ Transferir para o departamento ${opcoes.departamento}`
    ];
    return linhas.filter((l) => l !== null).join('\n');
}

module.exports = { montarNota };
