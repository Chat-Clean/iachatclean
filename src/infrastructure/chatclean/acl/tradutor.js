// =============================================================
//  ACL — TRADUTOR DE PAYLOAD DE ENTRADA
//
//  Camada anticorrupção: traduz o que chega na borda (ChatClean, n8n, formato
//  plano) para a MensagemRecebida do domínio. É o único lugar do sistema que
//  conhece a forma dos payloads externos.
//
//  Duas responsabilidades, deliberadamente separadas:
//    normalizarCorpo() — desembrulha envelopes até achar o payload real.
//    traduzir()        — reconhece o formato e produz MensagemRecebida ou descarte.
//
//  Nada aqui faz I/O e nada aqui loga: o chamador decide o que fazer com o
//  motivo do descarte. É o que torna o parse testável sem subir servidor.
// =============================================================

const { normalizarPhone } = require('../../../shared/telefone');
const MensagemRecebida = require('../../../domain/mensageria/MensagemRecebida');
const { MOTIVOS, descartar } = require('../../../domain/mensageria/MotivoDeDescarte');

const MAX_DESEMBRULHOS = 6; // teto para não girar em payload malformado

// Desembrulha o corpo até chegar ao payload do ChatClean. Quem chama a API nem
// sempre manda o objeto cru: o n8n entrega um ARRAY de itens e põe o payload
// real em .body, ao lado de headers/query/webhookUrl. Outros painéis mandam o
// JSON como string ou dentro de data/payload.
function normalizarCorpo(body) {
    let b = body;
    for (let i = 0; i < MAX_DESEMBRULHOS; i++) {
        if (typeof b === 'string') {
            const t = b.trim();
            if (!t.startsWith('{') && !t.startsWith('[')) return body;
            try {
                b = JSON.parse(t);
                continue;
            } catch (_) {
                return body;
            }
        }
        if (Array.isArray(b)) {
            if (!b.length) return body;
            b = b[0]; // n8n: lista de itens
            continue;
        }
        if (!b || typeof b !== 'object') return body;

        // Envelope do n8n: { headers, params, query, body, webhookUrl }.
        if (b.body && typeof b.body === 'object' && (b.headers || b.query || b.webhookUrl || b.executionMode)) {
            b = b.body;
            continue;
        }

        // Envelopes genéricos de outros painéis.
        let trocou = false;
        for (const k of ['data', 'payload', 'json']) {
            const v = b[k];
            if (v && typeof v === 'object' && !Array.isArray(v) && (v.number || v.contact || v.message)) {
                b = v;
                trocou = true;
                break;
            }
        }
        if (trocou) continue;
        break;
    }
    return b;
}

function normalizarTipo(t) {
    const v = String(t || 'text').toLowerCase();
    if (['image', 'audio', 'ptt', 'document', 'text'].includes(v)) return v;
    if (v === 'chat' || v === '') return 'text';
    return v; // sticker/video/location: tipo desconhecido, tratado pelo chamador
}

function obterTicket(body = {}, msg = {}) {
    return body.ticket || msg.ticket || {};
}

// Detecta se a mensagem veio de um GRUPO. O whatsmeow expõe Info.IsGroup e
// Info.Chat (JID do chat); grupo = JID termina em "@g.us". Cobrimos também
// variantes de payload plano (from/remoteJid/chatId/isGroup).
function ehGrupo(body = {}, msg = {}) {
    const info = (msg.raw && msg.raw.Info) || {};
    if (body.ticket?.isGroup === true || body.ticket?.status === 'group') return true;
    if (msg.ticket?.isGroup === true || msg.ticket?.status === 'group') return true;
    if (info.IsGroup === true || body.isGroup === true || msg.isGroup === true) return true;
    const candidatos = [
        info.Chat,
        info.ChatJID,
        info.chat,
        msg.chatId,
        msg.from,
        msg.remoteJid,
        body.chatId,
        body.from,
        body.remoteJid,
        body.remotejid,
        body.contact?.remoteJid,
        body.contact?.jid
    ];
    return candidatos.some((j) => typeof j === 'string' && j.includes('@g.us'));
}

// A IA só fala enquanto NINGUÉM assumiu o atendimento. No instante em que o
// atendente aceita (userId atribuído / status muda), a IA para — sem o risco de
// silenciar leads novos, que chegam como "pending" ou "open" sem userId.
function humanoAssumiu(body, msg, soPendentes) {
    if (!soPendentes) return false;
    const t = obterTicket(body, msg);
    if (t.userId) return true; // humano ACEITOU
    if (t.status === 'closed') return true; // encerrado
    return false;
}

/**
 * Traduz o payload da borda para MensagemRecebida.
 *
 * @param {*} bruto Corpo da requisição, já ou ainda embrulhado.
 * @param {object} [opcoes]
 * @param {boolean} [opcoes.ignorarGrupos=true]
 * @param {boolean} [opcoes.soPendentes=true] Só responder ticket sem humano.
 * @returns {object} MensagemRecebida (aceita: true) ou descarte (aceita: false).
 */
function traduzir(bruto, opcoes = {}) {
    const ignorarGrupos = opcoes.ignorarGrupos !== false;
    const soPendentes = opcoes.soPendentes !== false;
    const body = normalizarCorpo(bruto);

    // O ChatClean marca o tipo de evento. Só mensagem nova vira turno.
    if (body && body.event && body.event !== 'NewMessage') {
        return descartar(MOTIVOS.EVENTO_IGNORADO, body.event);
    }

    // Formato ChatClean: contact + message aninhados. O telefone real vem em
    // message.raw.Info.SenderAlt (ex.: "558494610845:60@s.whatsapp.net").
    if (body && (body.contact || (body.message && typeof body.message === 'object' && !body.message.add))) {
        const msg = body.message || {};
        // O contato vem na raiz (formato antigo) ou dentro do ticket, que é
        // onde o webhook do ChatClean o coloca hoje.
        const contato = body.contact || msg.ticket?.contact || {};

        if (msg.fromMe) return descartar(MOTIVOS.ECO);
        if (msg.note === true) return descartar(MOTIVOS.NOTA_INTERNA);
        if (ignorarGrupos && ehGrupo(body, msg)) return descartar(MOTIVOS.GRUPO);
        if (humanoAssumiu(body, msg, soPendentes)) {
            return descartar(MOTIVOS.TICKET_ASSUMIDO, obterTicket(body, msg).status || null);
        }

        const senderAlt = msg.raw?.Info?.SenderAlt ? String(msg.raw.Info.SenderAlt).split('@')[0] : null;
        // WABA (WhatsApp Oficial): o remetente vem em message.raw.from — não
        // existe raw.Info.SenderAlt como no WhatsApp Web/whatsmeow.
        const wabaFrom = msg.raw?.from || null;
        const numero = contato.number || contato.phone || body.number || senderAlt || wabaFrom || msg.number;
        const phone = normalizarPhone(numero);
        if (!phone) return descartar(MOTIVOS.SEM_TELEFONE);

        const tk = obterTicket(body, msg);
        const contactId = msg.contactId || contato.id || tk.contactId || body.contactId || null;

        return MensagemRecebida.criar({
            chatId: phone,
            contactId: contactId ? Number(contactId) : null,
            msgId: msg.id ? String(msg.id) : msg.messageId ? String(msg.messageId) : null,
            texto: String(msg.body || msg.text || '').trim(),
            tipo: normalizarTipo(msg.type || msg.mediaType),
            mediaBase64: msg.mediaBase64 || msg.base64 || null,
            mediaUrl: msg.mediaUrl || null,
            mediaMimetype: msg.mimetype || msg.raw?.Message?.imageMessage?.mimetype || null,
            quotedText: msg.quotedMsg?.body || msg.quotedMsg?.text || null,
            nomeContato: contato.name || msg.raw?.Info?.PushName || body.contactName || ''
        });
    }

    // Formato plano: { number, type, body, contactName, id }
    if (body && body.number && (body.body !== undefined || body.type)) {
        if (body.fromMe) return descartar(MOTIVOS.ECO);
        if (ignorarGrupos && ehGrupo(body)) return descartar(MOTIVOS.GRUPO);
        if (humanoAssumiu(body, {}, soPendentes)) {
            return descartar(MOTIVOS.TICKET_ASSUMIDO, obterTicket(body, {}).status || null);
        }

        const phone = normalizarPhone(body.number);
        if (!phone) return descartar(MOTIVOS.SEM_TELEFONE);

        return MensagemRecebida.criar({
            chatId: phone,
            contactId: body.contactId ? Number(body.contactId) : body.contact?.id ? Number(body.contact.id) : null,
            msgId: body.id ? String(body.id) : null,
            texto: String(body.body || '').trim(),
            tipo: normalizarTipo(body.type),
            mediaBase64: body.mediaBase64 || body.base64 || null,
            mediaUrl: body.mediaUrl || null,
            mediaMimetype: body.mimetype || null,
            quotedText: body.quotedText || null,
            nomeContato: body.contactName || body.name || ''
        });
    }

    // Disparo duplicado do ChatBot.
    if (body && body.numero_cliente && body.mensagem_cliente !== undefined) {
        return descartar(MOTIVOS.FORMATO_DUPLICADO);
    }

    return descartar(MOTIVOS.FORMATO_DESCONHECIDO);
}

module.exports = { traduzir, normalizarCorpo, ehGrupo, obterTicket, normalizarTipo };
