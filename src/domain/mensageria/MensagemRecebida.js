// =============================================================
//  MENSAGEM RECEBIDA — a mensagem no NOSSO formato.
//
//  O que atravessa a fronteira do ACL. A partir daqui o resto do sistema não
//  sabe que existe ChatClean, n8n, WhatsApp Web ou WABA: só existe uma mensagem
//  de um contato.
//
//  Os nomes dos campos são os mesmos que o legado já usava, de propósito: a
//  troca do parse pôde ser feita sem tocar em `processarMensagem`.
//
//  Módulo puro: sem I/O, sem process.env.
// =============================================================

const TIPOS_CONHECIDOS = Object.freeze(['text', 'image', 'audio', 'ptt', 'document', 'video']);

/**
 * @param {object} campos
 * @param {string} campos.chatId         Telefone normalizado (só dígitos).
 * @param {number|null} campos.contactId ID do contato no CRM, quando houver.
 * @param {string|null} campos.msgId     ID da mensagem, para deduplicação.
 * @param {string} campos.texto          Conteúdo textual (vazio em mídia pura).
 * @param {string} campos.tipo           text | image | audio | ptt | document | video | outro
 * @param {string|null} campos.mediaBase64
 * @param {string|null} campos.mediaUrl
 * @param {string|null} campos.mediaMimetype
 * @param {string|null} campos.quotedText Mensagem citada, quando o cliente responde a uma anterior.
 * @param {string} campos.nomeContato
 */
function criar(campos) {
    if (!campos || !campos.chatId) {
        throw new Error('MensagemRecebida exige chatId');
    }
    return Object.freeze({
        aceita: true,
        chatId: campos.chatId,
        contactId: campos.contactId ?? null,
        msgId: campos.msgId ?? null,
        texto: campos.texto ?? '',
        tipo: campos.tipo || 'text',
        mediaBase64: campos.mediaBase64 ?? null,
        mediaUrl: campos.mediaUrl ?? null,
        mediaMimetype: campos.mediaMimetype ?? null,
        quotedText: campos.quotedText ?? null,
        nomeContato: campos.nomeContato ?? ''
    });
}

function ehTipoConhecido(tipo) {
    return TIPOS_CONHECIDOS.includes(tipo);
}

module.exports = { criar, ehTipoConhecido, TIPOS_CONHECIDOS };
