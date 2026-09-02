// =============================================================
//  RESUMO SEGURO DO PAYLOAD DE ENTRADA
//  Diagnostico sem PII. O log de payload bruto despejava nome do
//  contato, telefone, URL da foto de perfil e o wamid (que carrega o
//  numero embutido) no stdout de producao, a cada mensagem.
//  Aqui fica so o que serve para diagnosticar formato e roteamento.
// =============================================================

// Campos que NUNCA podem sair no log: identificam a pessoa.
const PROIBIDOS = ['body', 'from', 'number', 'name', 'profilePicUrl', 'messageId', 'contactId', 'lid', 'bsuid', 'caption', 'mediaUrl', 'mediaName', 'originalName'];

// Extrai o que da para diagnosticar sem expor o lead: formato do envelope,
// tipo da mensagem, canal e tamanho. Nunca o conteudo.
function resumoSeguro(corpo, contentType) {
    const c = corpo && typeof corpo === 'object' ? corpo : {};
    const msg = c.message && typeof c.message === 'object' ? c.message : {};
    const ticket = msg.ticket && typeof msg.ticket === 'object' ? msg.ticket : {};
    return {
        contentType: contentType || 'sem content-type',
        chavesDeTopo: Object.keys(c).slice(0, 20),
        temMessage: Boolean(c.message),
        temRaw: Boolean(msg.raw),
        tipo: msg.mediaType || c.type || null,
        idInterno: typeof msg.id === 'string' ? msg.id : null,
        canal: ticket.channel || null,
        statusTicket: ticket.status || null,
        fromMe: typeof msg.fromMe === 'boolean' ? msg.fromMe : null,
        nota: typeof msg.note === 'boolean' ? msg.note : null,
        bytes: tamanhoEmBytes(corpo)
    };
}

function tamanhoEmBytes(corpo) {
    try {
        return JSON.stringify(corpo || {}).length;
    } catch (_) {
        return 0;
    }
}

module.exports = { resumoSeguro, PROIBIDOS };
