require('dotenv').config();
const express = require('express');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '10mb' }));

// =============================================================
//  CONFIGURAÇÃO — ChatClean (Webhook de entrada + Push API de saída)
//  Variáveis no .env (ver .env.example):
//
//  CC_PUSH_URL     = URL autenticada gerada em Configurações → API/Webhook → Adicionar
//                    (o token JWT já vem embutido como ?token=...; sem header)
//  WEBHOOK_SECRET  = Token opcional para validar o webhook de entrada
//                    (o ChatClean hoje NÃO envia token no header → deixe vazio)
//  EQUIPE_NUMERO   = WhatsApp interno que recebe o resumo dos leads qualificados
//  IA_ALLOWED_CONTACTS = Números liberados na fase de teste (vazio = responde a todos)
//  PORT            = Porta do servidor (padrão: 3000)
// =============================================================
const CC_PUSH_URL    = process.env.CC_PUSH_URL    || '';
const WEBHOOK_SECRET  = process.env.WEBHOOK_SECRET || '';
const EQUIPE_NUMERO  = process.env.EQUIPE_NUMERO  || '';
const IA_ALLOWED_CONTACTS = (process.env.IA_ALLOWED_CONTACTS || '').split(',').map(s => s.trim()).filter(Boolean);
const PORT           = process.env.PORT           || 3000;
// Chave para proteger os endpoints administrativos (/leads, /diag), que expõem
// dados de leads e config. Sem ela, esses endpoints ficam BLOQUEADOS (não abertos).
const ADMIN_KEY      = process.env.ADMIN_KEY      || '';
// A IA NÃO responde em grupos por padrão (só conversa individual). Para permitir
// grupos no futuro, defina IGNORAR_GRUPOS=false.
const IGNORAR_GRUPOS = (process.env.IGNORAR_GRUPOS || 'true') !== 'false';
// Janela (ms) para AGRUPAR mensagens rápidas do mesmo cliente antes de responder.
// No WhatsApp o cliente costuma mandar várias mensagens seguidas; juntamos tudo
// num único turno em vez de responder só a primeira e ignorar o resto.
const AGRUPAR_MS     = parseInt(process.env.AGRUPAR_MENSAGENS_MS || '2000', 10);
// Reinicia o atendimento após N horas sem interação do cliente (padrão: 24h).
const RESET_INATIVIDADE = parseInt(process.env.RESET_INATIVIDADE_HORAS || '24', 10) * 3600 * 1000;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const { EMPRESA_INFO, SEGMENTOS, DEPARTAMENTOS } = require('./data');
const { SYSTEM_SDR, promptExtracao, promptResposta } = require('./prompts');
const { determinarProximoCampo, aplicarCampos, detectarSegmento } = require('./flow');
const { estaEmExpediente } = require('./horario');
const cal = require('./calendar'); // Google Calendar (inerte se não configurado)
const store = require('./store'); // estado das conversas (Redis + fallback em memória)

const processandoMensagem = new Map(); // lock de processamento (por instância)

// =============================================================
//  UTILITÁRIOS
// =============================================================
function normalizarPhone(phone) {
    return String(phone).replace(/\D/g, '');
}

// Núcleo canônico de um número BR p/ COMPARAÇÃO (ignora o 9º dígito de celular).
// Ex.: 5584994610845 (13) e 558494610845 (12) viram o mesmo núcleo → casam.
function nucleoNumero(n) {
    let d = String(n).replace(/\D/g, '');
    if (d.length === 13 && d.startsWith('55') && d[4] === '9') {
        d = d.slice(0, 4) + d.slice(5); // remove o 9 logo após o DDD
    }
    return d;
}

// true se o número está na allow-list (tolerante ao 9º dígito). Lista vazia = libera todos.
function contatoPermitido(numero) {
    if (!IA_ALLOWED_CONTACTS.length) return true;
    const alvo = nucleoNumero(numero);
    return IA_ALLOWED_CONTACTS.some(a => nucleoNumero(a) === alvo);
}

// =============================================================
//  CHATCLEAN — ENVIO VIA PUSH API
//  Um único endpoint autenticado (CC_PUSH_URL) entrega as mensagens.
//  O token JWT já vem embutido na URL como ?token=... (sem header).
// =============================================================
async function ccPush(number, payloadExtra = {}) {
    if (!CC_PUSH_URL) { console.warn('⚠️ CC_PUSH_URL não configurado no .env — envio ignorado'); return false; }
    try {
        await axios.post(CC_PUSH_URL, {
            number: normalizarPhone(number),
            externalKey: crypto.randomUUID(),
            ...payloadExtra
        }, { headers: { 'Content-Type': 'application/json' }, timeout: 30000 });
        return true;
    } catch (e) {
        console.error('❌ Erro no Push ChatClean:', e.response?.data || e.message);
        return false;
    }
}

async function enviarMensagem(chatId, texto) {
    if (!texto || !String(texto).trim()) return false;
    return ccPush(chatId, { body: texto });
}

// Quebra a resposta em mensagens curtas (registro de WhatsApp), a menos que
// seja um resumo/encaminhamento (mandado inteiro).
async function enviarMensagensQuebradas(chatId, textoCompleto) {
    if (/encaminhando|especialista|resumo|repassando/i.test(textoCompleto)) {
        await enviarMensagem(chatId, textoCompleto);
        return;
    }
    const partes = String(textoCompleto).split('\n').filter(p => p.trim());
    for (const parte of partes) {
        await new Promise(r => setTimeout(r, 900 + parte.length * 18));
        await enviarMensagem(chatId, parte);
    }
}

// Notifica a equipe (nota interna no ticket + WhatsApp interno) quando um lead
// é qualificado, e sinaliza a transferência de departamento no CRM.
// Monta o resumo estruturado do lead (reusado na nota da equipe e na descrição do evento).
function montarResumo(leadData, chatId, opcoes = {}) {
    const departamento = opcoes.departamento || DEPARTAMENTOS.comercial;
    const segNome = leadData.segmentoKey && SEGMENTOS[leadData.segmentoKey]
        ? SEGMENTOS[leadData.segmentoKey].nome : (leadData.segmento || 'Não informado');
    return `🎯 LEAD QUALIFICADO — SDR ChatClean${opcoes.tagExtra ? ' [' + opcoes.tagExtra + ']' : ''}\n\n` +
        `Contato: ${leadData.nome || 'Lead'} (${chatId})\n` +
        `Empresa: ${leadData.empresa || 'Não informado'}\n` +
        `Segmento: ${segNome}\n` +
        `Cidade/UF: ${leadData.cidadeEstado || 'Não informado'}\n` +
        `Objetivo: ${leadData.objetivo || 'Não informado'}\n` +
        `Canais hoje: ${leadData.canais || 'Não informado'}\n` +
        `Volume: ${leadData.volume || 'Não informado'}\n` +
        `Dor principal: ${leadData.dor || 'Não informado'}\n` +
        `Urgência: ${leadData.urgencia || 'Não informado'}\n` +
        `Decisor: ${leadData.decisor || 'Não informado'}\n` +
        (leadData.reuniaoAgendada ? `📅 Reunião agendada: ${leadData.reuniaoAgendada.label}\n` : '') +
        (leadData.horarioPreferido ? `Horário preferido p/ reunião: ${leadData.horarioPreferido}\n` : '') +
        (opcoes.proximoExpediente ? `Retorno sugerido: ${opcoes.proximoExpediente}\n` : '') +
        `\n➡️ Transferir para o departamento ${departamento}`;
}

async function notificarEquipe(leadData, chatId, opcoes = {}) {
    const departamento = opcoes.departamento || DEPARTAMENTOS.comercial;
    const segNome = leadData.segmentoKey && SEGMENTOS[leadData.segmentoKey]
        ? SEGMENTOS[leadData.segmentoKey].nome : (leadData.segmento || 'Não informado');
    const resumo = montarResumo(leadData, chatId, opcoes);

    // Nota interna no ticket do próprio cliente (fica no CRM p/ o atendente)
    await ccPush(chatId, { body: resumo, onlyNote: true, note: { body: resumo } });
    // Resumo também por WhatsApp interno, se houver número da equipe
    if (EQUIPE_NUMERO) await ccPush(EQUIPE_NUMERO, { body: resumo });

    // Histórico append-only de leads qualificados
    try {
        await store.appendLeadFinalizado({
            chatId, nome: leadData.nome || null, empresa: leadData.empresa || null,
            segmento: segNome, objetivo: leadData.objetivo || null, dor: leadData.dor || null,
            urgencia: leadData.urgencia || null, decisor: leadData.decisor || null,
            departamento, data: new Date().toISOString()
        });
    } catch (e) { console.error('❌ appendLeadFinalizado:', e.message); }

    console.log(`✅ Equipe notificada — lead ${leadData.nome || ''} (${chatId}) → ${departamento}`);
    return true;
}

// A state machine (determinarProximoCampo / aplicarCampos / detectarSegmento)
// vive em ./flow para ser reusada pelo tester local sem duplicar lógica.

// =============================================================
//  FOLLOW-UP DE REATIVAÇÃO (durável — sobrevive a redeploy)
//  Guarda leadData.followUpDueAt e um varredor dispara os vencidos.
// =============================================================
const TEMPO_INATIVIDADE = 30 * 60 * 1000; // 30 min sem resposta → reativação
const FOLLOWUP_SWEEP    = 2 * 60 * 1000;  // varre a cada 2 min

function agendarFollowUpReativacao(leadData) {
    if (leadData.finalizado) { leadData.followUpDueAt = null; return; }
    leadData.followUpDueAt = Date.now() + TEMPO_INATIVIDADE;
}

function montarMsgReativacao(leadData) {
    const proximo = determinarProximoCampo(leadData);
    if (!proximo) return null;
    const nome = leadData.nome?.split(' ')[0] || '';
    const oi = nome ? `Oi ${nome}` : 'Oi';
    if (proximo.campo === 'objetivo' || proximo.campo === 'nome') return 'Oi! Ainda por aí? Se quiser, me conta como podemos te ajudar com seu atendimento 😊';
    if (proximo.campo === 'dor')   return `${oi}, fiquei aqui pensando no seu atendimento. Qual é hoje o maior desafio pra você?`;
    return `${oi}, ainda por aí? Se quiser, seguimos de onde paramos que eu já organizo tudo pro time 😊`;
}

async function dispararFollowUpReativacao(chatId, leadData) {
    const msg = montarMsgReativacao(leadData);
    leadData.followUpDueAt = null;
    if (!msg || leadData.followUpUltimo === msg) {
        try { await store.saveLead(chatId, leadData); } catch (_) {}
        return;
    }
    leadData.followUpUltimo = msg;
    try { await store.saveLead(chatId, leadData); } catch (_) {}
    await enviarMensagem(chatId, msg);
    console.log(`📩 Follow-up de reativação enviado para ${chatId}`);
}

async function varrerFollowUps() {
    try {
        const ids = await store.scanLeadIds();
        const agora = Date.now();
        for (const chatId of ids) {
            if (processandoMensagem.has(chatId)) continue;
            let leadData;
            try { leadData = await store.getLead(chatId); } catch (_) { continue; }
            if (!leadData || leadData.finalizado) continue;
            if (!leadData.followUpDueAt || leadData.followUpDueAt > agora) continue;
            await dispararFollowUpReativacao(chatId, leadData);
        }
    } catch (e) {
        console.error('Erro no varredor de follow-up:', e.message);
    }
}
setInterval(varrerFollowUps, FOLLOWUP_SWEEP).unref?.();

// =============================================================
//  IA — EXTRAÇÃO DE INFORMAÇÕES (gpt-4o-mini, temperatura 0)
// =============================================================
async function extrairInformacoesComIA(mensagem, campoAtual, historicoRecente = []) {
    try {
        const mensagemSanitizada = mensagem.replace(/[<>]/g, '').substring(0, 1000);
        const prompt = promptExtracao({ mensagemSanitizada, campoAtual });
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [...historicoRecente, { role: 'user', content: prompt }],
            temperature: 0,
            response_format: { type: 'json_object' } // garante JSON válido (o prompt já pede JSON)
        });
        let res = completion.choices[0].message.content.trim();
        if (res.includes('```')) res = res.replace(/```json?/g, '').replace(/```/g, '').trim();
        return JSON.parse(res);
    } catch (e) {
        console.error('Erro ao extrair informações:', e.message);
        return null;
    }
}

// =============================================================
//  IA — GERAÇÃO DE RESPOSTA (gpt-4o-mini, temperatura 0.7)
// =============================================================
async function gerarRespostaIA(leadData, mensagemCliente, proximoCampo, historicoRecente = [], expediente = null) {
    const mensagemSanitizada = mensagemCliente.replace(/[<>]/g, '').substring(0, 1000);
    const isInicioConversa = leadData.conversationHistory.length === 0;
    const prompt = promptResposta({ isInicioConversa, mensagemSanitizada, proximoCampo, leadData, expediente });
    const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
            { role: 'system', content: SYSTEM_SDR },
            ...historicoRecente,
            { role: 'user', content: prompt }
        ],
        temperature: 0.7
    });
    return completion.choices[0].message.content.trim();
}

// A IA "enxerga" a imagem enviada pelo cliente (gpt-4o com visão) e descreve
// o conteúdo para usar no atendimento. Retorna null se falhar.
async function analisarImagem(mediaUrl) {
    if (!mediaUrl) return null;
    try {
        const instrucao = `Você é atendente SDR da ChatClean (plataforma de CRM e atendimento digital). O cliente enviou esta imagem no WhatsApp durante o atendimento. Descreva de forma curta e útil (1 a 3 frases, tom natural, SEM markdown) o que é e o que há de relevante para entender a necessidade dele:
- Se for um PRINT de conversa/atendimento, resuma o que dá pra entender (do que se trata: reclamação, dúvida, volume de mensagens, atendimento demorado etc.).
- Se for uma tela de sistema/site, diga o que aparenta ser.
- Se for logo, foto da empresa, produto ou documento, diga o que é.
Não invente o que não dá pra ver.`;
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [{
                role: 'user',
                content: [
                    { type: 'text', text: instrucao },
                    { type: 'image_url', image_url: { url: mediaUrl } }
                ]
            }],
            max_tokens: 300,
            temperature: 0.3
        });
        return completion.choices[0].message.content.trim();
    } catch (e) {
        console.error('❌ Erro ao analisar imagem (visão):', e.message);
        return null;
    }
}

// Resposta quando o lead JÁ foi encaminhado ao especialista: tira dúvidas
// pontuais de forma natural, sem refazer a qualificação nem repetir o resumo.
async function gerarRespostaPosEncaminhamento(leadData, mensagemCliente, historicoRecente = []) {
    const fallback = 'Já repassei tudo pro nosso especialista, ele entra em contato aqui rapidinho 😊 Se quiser adiantar algo, pode me contar que eu anoto pro time.';
    try {
        const prompt = `Este lead já foi ENCAMINHADO a um especialista do Comercial da ChatClean. Ele acabou de dizer: "${String(mensagemCliente).replace(/[<>]/g, '').substring(0, 600)}".
Responda de forma breve, calorosa e útil (registro de WhatsApp, sem markdown, no máximo 1 emoji):
- Se for uma dúvida simples sobre a ChatClean, responda.
- Se depender do especialista (preço, proposta, detalhes de contrato), diga que ele já vai falar com o cliente pra resolver.
Nunca passe preço. Não refaça perguntas de qualificação e não repita o resumo.`;
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: 'Você é o SDR virtual da ChatClean. Escrita natural, curta, registro de WhatsApp.' },
                ...historicoRecente,
                { role: 'user', content: prompt }
            ],
            temperature: 0.6
        });
        return completion.choices[0].message.content.trim() || fallback;
    } catch (e) {
        console.error('❌ Erro na resposta pós-encaminhamento:', e.message);
        return fallback;
    }
}

// =============================================================
//  ENCAMINHAMENTO PARA HUMANO
// =============================================================
async function encaminhar(chatId, leadData, departamento, mensagemCliente, historico, expediente = null) {
    const exp = expediente || estaEmExpediente();
    // Deixa a IA escrever o handoff de forma calorosa (usa o branch de qualificação completa)
    leadData.qualificacaoCompleta = true;
    let msg;
    try {
        msg = await gerarRespostaIA(leadData, mensagemCliente, null, historico, exp);
    } catch (_) {
        msg = exp.aberto
            ? 'Perfeito! Já estou repassando tudo para um especialista da ChatClean. Ele entra aqui rapidinho pra te atender melhor 😊'
            : `Perfeito, deixei tudo registrado! Nosso especialista te retorna ${exp.proximoExpediente}, combinado? 😊`;
    }
    await enviarMensagem(chatId, msg);
    leadData.conversationHistory.push({ role: 'assistant', content: msg });
    await notificarEquipe(leadData, chatId, { departamento, tagExtra: exp.aberto ? undefined : 'FORA DE EXPEDIENTE', proximoExpediente: exp.aberto ? null : exp.proximoExpediente });
    leadData.finalizado = true;
    leadData.followUpDueAt = null;
}

// =============================================================
//  AGENDAMENTO (Google Calendar) — inerte se não configurado.
//  Retorna true se já tratou o turno (o chamador deve dar return).
// =============================================================
async function tratarAgendamento(chatId, leadData, texto, extraido, exp) {
    if (!cal.configurado()) return false;

    // 1) Cliente escolhendo um horário já oferecido → cria o evento
    if (leadData.aguardandoEscolhaSlot) {
        const escolha = Number(extraido?.slotEscolhido);
        const slots = leadData.slotsOferecidos || [];
        if (escolha >= 1 && slots[escolha - 1]) {
            const s = slots[escolha - 1];
            try {
                const ev = await cal.agendarReuniao({
                    start: s.start, end: s.end, calendarId: s.calendarId,
                    titulo: `Reunião ChatClean — ${leadData.nome || 'Lead'}${leadData.empresa ? ' (' + leadData.empresa + ')' : ''}`,
                    descricao: montarResumo(leadData, chatId, { departamento: DEPARTAMENTOS.comercial })
                });
                leadData.reuniaoAgendada = { label: ev.label, id: ev.id };
                leadData.aguardandoEscolhaSlot = false;
                leadData.slotsOferecidos = null;
                const msg = `Prontinho! Deixei sua reunião marcada para ${ev.label} com um especialista da ChatClean 😊`;
                await enviarMensagem(chatId, msg);
                leadData.conversationHistory.push({ role: 'user', content: texto });
                leadData.conversationHistory.push({ role: 'assistant', content: msg });
                await notificarEquipe(leadData, chatId, { departamento: DEPARTAMENTOS.comercial, tagExtra: 'REUNIÃO AGENDADA' });
                leadData.finalizado = true;
                return true;
            } catch (e) {
                console.error('❌ Erro ao agendar reunião:', e.message);
                leadData.aguardandoEscolhaSlot = false; // deixa o fluxo normal seguir
                return false;
            }
        }
        return false; // não entendeu a escolha → fluxo normal responde
    }

    // 2) Deve oferecer horários? (fim da qualificação fora do expediente OU cliente pediu p/ agendar)
    const deveAgendar = (leadData.qualificacaoCompleta && !exp.aberto) || extraido?.querAgendar;
    if (deveAgendar && !leadData.reuniaoAgendada) {
        let slots = [];
        try { slots = await cal.horariosLivres({ dias: 5, max: 3 }); }
        catch (e) { console.error('❌ Erro ao consultar horários livres:', e.message); return false; }
        if (!slots.length) return false; // sem horários → fluxo normal (coleta preferência)

        leadData.slotsOferecidos = slots.map(s => ({ start: s.start, end: s.end, calendarId: s.calendarId, label: s.label }));
        leadData.aguardandoEscolhaSlot = true;
        const lista = slots.map((s, i) => `${i + 1}) ${s.label}`).join('\n');
        const intro = exp.aberto
            ? 'Posso já deixar uma reunião marcada com um especialista. Tenho estes horários:'
            : `Nosso time retorna ${exp.proximoExpediente}. Posso já deixar uma reunião marcada com um especialista. Tenho estes horários:`;
        const msg = `${intro}\n${lista}\nQual fica melhor pra você? (é só me dizer o número)`;
        await enviarMensagem(chatId, msg);
        leadData.conversationHistory.push({ role: 'user', content: texto });
        leadData.conversationHistory.push({ role: 'assistant', content: msg });
        return true;
    }

    return false;
}

// =============================================================
//  PROCESSAMENTO DE MENSAGEM
// =============================================================
async function processarMensagem({ chatId, texto, tipo, mediaBase64, mediaUrl, mediaMimetype, quotedText, nomeContato }) {
    if (processandoMensagem.get(chatId)) {
        console.log(`⚠️ Já processando mensagem de ${chatId}. Ignorando.`);
        return;
    }
    processandoMensagem.set(chatId, true);
    const timeoutId = setTimeout(() => {
        if (processandoMensagem.get(chatId)) {
            console.log(`⏱️ Timeout: liberando processamento para ${chatId}`);
            processandoMensagem.delete(chatId);
        }
    }, 60000);

    let leadData = null;
    try {
        leadData = await store.getLead(chatId);
        // Reset automático por inatividade: se passou do limite (padrão 24h) sem
        // interação, descarta o atendimento antigo e começa um novo do zero.
        if (leadData && leadData.ultimaInteracao && (Date.now() - leadData.ultimaInteracao) > RESET_INATIVIDADE) {
            console.log(`🕛 ${chatId}: inativo há mais de ${(RESET_INATIVIDADE / 3600000).toFixed(0)}h — reiniciando atendimento.`);
            await store.deleteLead(chatId);
            leadData = null;
        }
        if (!leadData) leadData = { conversationHistory: [] };
        if (nomeContato && !leadData.nome) leadData.nome = nomeContato;
        leadData.ultimaInteracao = Date.now(); // marca esta interação
        leadData.followUpDueAt = null; // nova mensagem cancela reativação pendente

        // Mídia (imagem/vídeo/documento) já registra o turno do cliente no
        // histórico com uma descrição rica; quando isso acontece, marcamos aqui
        // para NÃO empurrar de novo o texto-placeholder no fim (evita duplicar).
        let usuarioNoHistorico = false;

        // Reset
        if (String(texto).toLowerCase() === '/reset') {
            await store.deleteLead(chatId);
            leadData = null;
            await enviarMensagem(chatId, '🔄 Conversa resetada! Vamos começar de novo 😊');
            return;
        }

        // Lead já encaminhado → só tira dúvidas pontuais, sem refazer o funil
        if (leadData.finalizado) {
            const histPos = leadData.conversationHistory.slice(-30).map(h => ({
                role: h.role === 'user' ? 'user' : 'assistant', content: h.content
            }));
            const respPos = await gerarRespostaPosEncaminhamento(leadData, texto, histPos);
            await enviarMensagensQuebradas(chatId, respPos);
            leadData.conversationHistory.push({ role: 'user', content: texto });
            leadData.conversationHistory.push({ role: 'assistant', content: respPos });
            return;
        }

        // Imagem → a IA ENXERGA (visão gpt-4o) e usa o conteúdo na resposta.
        if (tipo === 'image') {
            const desc = await analisarImagem(mediaUrl);
            if (desc) {
                leadData.analiseImagem = desc; // consumido na geração da resposta
                console.log(`🖼️ Visão: ${desc}`);
                leadData.conversationHistory.push({ role: 'user', content: `[O cliente enviou uma imagem] — ${desc}` });
            } else {
                leadData.conversationHistory.push({ role: 'user', content: '[O cliente enviou uma imagem]' });
            }
            texto = 'Enviei uma imagem.';
            usuarioNoHistorico = true;
        }

        // Documento (PDF/planilha/arquivo) → registra p/ o especialista (não é imagem).
        if (tipo === 'document') {
            const ack = 'Recebi o arquivo! Vou deixar registrado pro nosso especialista analisar junto com você 😊';
            await enviarMensagem(chatId, ack);
            leadData.conversationHistory.push({ role: 'user', content: '[O cliente enviou um documento]' });
            leadData.conversationHistory.push({ role: 'assistant', content: ack });
            texto = 'Enviei um arquivo.';
            usuarioNoHistorico = true;
        }

        // Vídeo → transcreve o áudio do vídeo (Whisper aceita mp4) p/ entender o que é falado.
        if (tipo === 'video') {
            let videoBuffer = null;
            try {
                if (mediaBase64) videoBuffer = Buffer.from(mediaBase64, 'base64');
                else if (mediaUrl) {
                    const resp = await axios.get(mediaUrl, { responseType: 'arraybuffer', timeout: 60000 });
                    videoBuffer = Buffer.from(resp.data);
                }
            } catch (e) { console.error('❌ Erro ao baixar vídeo:', e.message); }

            let fala = '';
            if (videoBuffer) {
                try {
                    const formData = new FormData();
                    formData.append('file', videoBuffer, { filename: 'video.mp4', contentType: mediaMimetype || 'video/mp4' });
                    formData.append('model', 'whisper-1');
                    const tr = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, {
                        headers: { ...formData.getHeaders(), Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }
                    });
                    fala = (tr.data.text || '').trim();
                } catch (e) { console.error('❌ Erro ao transcrever vídeo:', e.message); }
            }
            if (fala) {
                console.log(`🎬 Vídeo transcrito: "${fala}"`);
                leadData.conversationHistory.push({ role: 'user', content: `[O cliente enviou um vídeo] Fala no vídeo: ${fala}` });
                texto = fala;
            } else {
                leadData.conversationHistory.push({ role: 'user', content: '[O cliente enviou um vídeo]' });
                texto = 'Enviei um vídeo.';
            }
            usuarioNoHistorico = true;
        }

        // Áudio → transcrição (Whisper). Se falhar, pede texto.
        if (tipo === 'audio' || tipo === 'ptt') {
            let audioBuffer = null;
            try {
                if (mediaBase64) {
                    audioBuffer = Buffer.from(mediaBase64, 'base64');
                } else if (mediaUrl) {
                    const resp = await axios.get(mediaUrl, { responseType: 'arraybuffer', timeout: 30000 });
                    audioBuffer = Buffer.from(resp.data);
                }
            } catch (e) { console.error('❌ Erro ao baixar áudio:', e.message); }

            if (audioBuffer) {
                try {
                    const formData = new FormData();
                    formData.append('file', audioBuffer, { filename: 'audio.ogg', contentType: mediaMimetype || 'audio/ogg' });
                    formData.append('model', 'whisper-1');
                    const transcription = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, {
                        headers: { ...formData.getHeaders(), Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }
                    });
                    texto = transcription.data.text;
                    console.log(`📝 Transcrição: "${texto}"`);
                } catch (e) {
                    console.error('❌ Erro ao transcrever áudio:', e.message);
                    await enviarMensagem(chatId, 'Recebi seu áudio! Por aqui prefiro que a gente converse por texto pra eu anotar tudo certinho. Pode me escrever? 😊');
                    return;
                }
            } else {
                await enviarMensagem(chatId, 'Recebi seu áudio, mas não consegui abrir por aqui. Pode me escrever, por favor? 😊');
                return;
            }
        }

        if (quotedText) {
            texto = `[RESPOSTA À MENSAGEM: "${quotedText}"]\n${texto}`;
        }

        // Expediente do time: define modo normal (transfere ao vivo) x plantão (agenda retorno)
        const exp = estaEmExpediente();

        // --- Extração ---
        const proximoCampoAntes = determinarProximoCampo(leadData);
        const historicoRecente = leadData.conversationHistory.slice(-6).map(h => ({
            role: h.role === 'user' ? 'user' : 'assistant', content: h.content
        }));
        const extraido = await extrairInformacoesComIA(texto, proximoCampoAntes?.campo, historicoRecente.slice(-4));

        // Sinais transitórios (valem só para esta resposta)
        leadData.objecaoAtiva = null;
        leadData.perguntouAgora = null;

        if (extraido) {
            aplicarCampos(leadData, extraido);
            if (extraido.objecao) leadData.objecaoAtiva = extraido.objecao;
            if (extraido.perguntou) leadData.perguntouAgora = true;
            if (extraido.horarioPreferido && !leadData.horarioPreferido) leadData.horarioPreferido = extraido.horarioPreferido;
            if (extraido.tipoContato) leadData.tipoContato = extraido.tipoContato;

            // Se o cliente corrigiu o segmento, re-detecta o gancho de case.
            if (Array.isArray(extraido.correcao) && extraido.correcao.includes('segmento')) {
                leadData.segmentoKey = null;
            }

            // Detecta o segmento (para o gancho de case) a partir do que foi dito
            if (!leadData.segmentoKey) {
                leadData.segmentoKey = detectarSegmento((extraido.segmento || '') + ' ' + texto);
            }

            // Cliente ATUAL pedindo suporte → encaminha para Suporte/CS (não é lead novo)
            if (extraido.tipoContato === 'cliente' && !leadData.finalizado) {
                const hist = leadData.conversationHistory.slice(-8).map(h => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content }));
                if (!usuarioNoHistorico) leadData.conversationHistory.push({ role: 'user', content: texto });
                await enviarMensagem(chatId, 'Entendi! Vou te encaminhar pro nosso time de Suporte, que já cuida disso com você 😊');
                await notificarEquipe(leadData, chatId, { departamento: DEPARTAMENTOS.suporte, tagExtra: 'CLIENTE ATUAL' });
                leadData.finalizado = true;
                return;
            }

            // Pediu explicitamente falar com humano → encaminha ao Comercial
            if (extraido.querFalarComHumano && !leadData.finalizado) {
                const hist = leadData.conversationHistory.slice(-8).map(h => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content }));
                if (!usuarioNoHistorico) leadData.conversationHistory.push({ role: 'user', content: texto });
                await encaminhar(chatId, leadData, DEPARTAMENTOS.comercial, texto, hist, exp);
                return;
            }
        }

        // --- Próximo passo + resposta ---
        const proximoCampoDepois = determinarProximoCampo(leadData);

        // Sub-fluxo de agendamento (Google Calendar). Inerte se não configurado;
        // se tratou o turno (ofereceu horários ou agendou), encerra aqui.
        if (await tratarAgendamento(chatId, leadData, texto, extraido, exp)) return;

        const respHist = leadData.conversationHistory.slice(-10).map(h => ({
            role: h.role === 'user' ? 'user' : 'assistant', content: h.content
        }));
        let resposta;
        try {
            resposta = await gerarRespostaIA(leadData, texto, proximoCampoDepois, respHist, exp);
        } catch (e) {
            // Instabilidade na OpenAI: NÃO deixar o cliente sem resposta. Manda um
            // fallback caloroso e encerra o turno (o que já foi extraído fica salvo;
            // a próxima mensagem retoma a qualificação de onde parou).
            console.error(`❌ Erro ao gerar resposta IA para ${chatId}:`, e.message);
            await enviarMensagem(chatId, 'Opa, tive uma instabilidade rapidinha por aqui 😅 Pode me mandar de novo o que você disse?');
            if (!usuarioNoHistorico) leadData.conversationHistory.push({ role: 'user', content: texto });
            return;
        }

        leadData.objecaoAtiva = null;    // consumidos
        leadData.perguntouAgora = null;
        leadData.analiseImagem = null;

        await enviarMensagensQuebradas(chatId, resposta);
        if (!usuarioNoHistorico) leadData.conversationHistory.push({ role: 'user', content: texto });
        leadData.conversationHistory.push({ role: 'assistant', content: resposta });
        if (leadData.conversationHistory.length > 100) {
            leadData.conversationHistory = leadData.conversationHistory.slice(-100);
        }

        // Qualificação completa → notifica a equipe (transfere ao vivo em expediente;
        // fora do expediente, sinaliza para agendar o retorno).
        if (leadData.qualificacaoCompleta && !leadData.finalizado) {
            await notificarEquipe(leadData, chatId, {
                departamento: DEPARTAMENTOS.comercial,
                tagExtra: exp.aberto ? undefined : 'FORA DE EXPEDIENTE — AGENDAR RETORNO',
                proximoExpediente: exp.aberto ? null : exp.proximoExpediente
            });
            leadData.finalizado = true;
        } else if (!leadData.finalizado) {
            agendarFollowUpReativacao(leadData);
        }

    } catch (e) {
        console.error(`❌ Erro ao processar mensagem de ${chatId}:`, e);
    } finally {
        clearTimeout(timeoutId);
        processandoMensagem.delete(chatId);
        if (leadData) {
            try { await store.saveLead(chatId, leadData); }
            catch (e) { console.error('❌ Erro ao salvar estado da conversa:', e.message); }
        }
    }
}

// =============================================================
//  FILA SERIAL POR CLIENTE + AGRUPAMENTO DE MENSAGENS RÁPIDAS
//  No WhatsApp o cliente manda várias mensagens seguidas. Em vez de
//  processar a primeira e DESCARTAR as demais (o lock antigo fazia isso),
//  enfileiramos tudo por número e processamos em série. Mensagens de TEXTO
//  em sequência são agrupadas num só turno (debounce AGRUPAR_MS); mídia é
//  processada assim que chega (mas ainda em série, nunca descartada).
// =============================================================
const filaPorChat   = new Map(); // chatId -> [parsed, ...] aguardando processamento
const debounceTimers = new Map(); // chatId -> timer de agrupamento de texto

function enfileirar(parsed) {
    const { chatId } = parsed;
    const fila = filaPorChat.get(chatId) || [];
    fila.push(parsed);
    filaPorChat.set(chatId, fila);

    if (parsed.tipo === 'text') {
        // Espera um instante juntando mensagens rápidas antes de drenar.
        if (debounceTimers.has(chatId)) clearTimeout(debounceTimers.get(chatId));
        debounceTimers.set(chatId, setTimeout(() => {
            debounceTimers.delete(chatId);
            drenarFila(chatId);
        }, AGRUPAR_MS));
    } else {
        // Mídia não espera: cancela o debounce pendente e drena já.
        if (debounceTimers.has(chatId)) { clearTimeout(debounceTimers.get(chatId)); debounceTimers.delete(chatId); }
        drenarFila(chatId);
    }
}

// Junta as mensagens de TEXTO consecutivas no início da fila num único "turno".
// Mídia é sempre uma unidade isolada (não dá pra concatenar imagem+áudio+texto).
function proximaUnidade(fila) {
    if (fila[0].tipo !== 'text') return fila.shift();
    const textos = [], ids = [];
    let nome = '', quoted = null;
    while (fila.length && fila[0].tipo === 'text') {
        const m = fila.shift();
        if (m.texto) textos.push(m.texto);
        if (m.msgId) ids.push(m.msgId);
        if (!nome && m.nomeContato) nome = m.nomeContato;
        if (!quoted && m.quotedText) quoted = m.quotedText;
    }
    return {
        chatId: null, // preenchido pelo chamador
        tipo: 'text',
        texto: textos.join('\n'),
        msgId: ids.join(',') || null,
        nomeContato: nome,
        quotedText: quoted,
        mediaBase64: null, mediaUrl: null, mediaMimetype: null
    };
}

async function drenarFila(chatId) {
    if (processandoMensagem.get(chatId)) return; // já rodando: será drenado ao terminar
    const fila = filaPorChat.get(chatId);
    if (!fila || !fila.length) return;

    const unidade = proximaUnidade(fila);
    unidade.chatId = chatId;
    try {
        await processarMensagem(unidade);
    } catch (e) {
        console.error(`❌ Erro ao drenar fila de ${chatId}:`, e.message);
    }

    // Limpa a fila vazia; se algo chegou durante o processamento, drena de novo.
    const restante = filaPorChat.get(chatId);
    if (restante && restante.length) drenarFila(chatId);
    else filaPorChat.delete(chatId);
}

// Detecta se a mensagem veio de um GRUPO. O whatsmeow expõe Info.IsGroup e
// Info.Chat (JID do chat); grupo = JID termina em "@g.us". Cobrimos também
// variantes de payload plano (from/remoteJid/chatId/isGroup).
function ehGrupo(body = {}, msg = {}) {
    const info = msg.raw?.Info || {};
    // Sinal nativo do ChatClean (o mais confiável): o ticket marca grupo.
    if (body.ticket?.isGroup === true || body.ticket?.status === 'group') return true;
    if (msg.ticket?.isGroup === true || msg.ticket?.status === 'group') return true;
    // Sinais do whatsmeow / formato plano.
    if (info.IsGroup === true || body.isGroup === true || msg.isGroup === true) return true;
    const candidatos = [
        info.Chat, info.ChatJID, info.chat,
        msg.chatId, msg.from, msg.remoteJid,
        body.chatId, body.from, body.remoteJid, body.remotejid,
        body.contact?.remoteJid, body.contact?.jid
    ];
    return candidatos.some(j => typeof j === 'string' && j.includes('@g.us'));
}

// =============================================================
//  WEBHOOK — PARSE DO PAYLOAD DO CHATCLEAN
// =============================================================
function parsePayload(body) {
    try {
        const normTipo = (t) => {
            const v = String(t || 'text').toLowerCase();
            if (['image', 'audio', 'ptt', 'document', 'text'].includes(v)) return v;
            if (v === 'chat' || v === '') return 'text';
            return v; // sticker/video/location → tratado como não-texto no /webhook
        };

        // Formato ChatClean: contact + message aninhados.
        // O telefone real vem em message.raw.Info.SenderAlt (ex.: "558494610845@s.whatsapp.net").
        if (body?.contact || (body?.message && typeof body.message === 'object' && !body.message.add)) {
            const contato = body.contact || {};
            const msg     = body.message || {};
            if (msg.fromMe) return null; // ignora eco do próprio bot/atendente
            if (IGNORAR_GRUPOS && ehGrupo(body, msg)) { console.log('👥 Mensagem de grupo ignorada'); return null; }
            const senderAlt = msg.raw?.Info?.SenderAlt ? String(msg.raw.Info.SenderAlt).split('@')[0] : null;
            const numero = contato.number || contato.phone || body.number || senderAlt || msg.number;
            const phone  = normalizarPhone(numero);
            if (!phone) return null;
            return {
                chatId:        phone,
                msgId:         msg.id ? String(msg.id) : (msg.messageId ? String(msg.messageId) : null),
                texto:         String(msg.body || msg.text || '').trim(),
                tipo:          normTipo(msg.type || msg.mediaType),
                mediaBase64:   msg.mediaBase64 || msg.base64 || null,
                mediaUrl:      msg.mediaUrl || null,
                mediaMimetype: msg.mimetype || msg.raw?.Message?.imageMessage?.mimetype || null,
                quotedText:    msg.quotedMsg?.body || msg.quotedMsg?.text || null,
                nomeContato:   contato.name || msg.raw?.Info?.PushName || body.contactName || ''
            };
        }

        // Formato plano (webhook/n8n simples): { number, type, body, contactName, id }
        if (body?.number && (body?.body !== undefined || body?.type)) {
            if (body.fromMe) return null;
            if (IGNORAR_GRUPOS && ehGrupo(body)) { console.log('👥 Mensagem de grupo ignorada'); return null; }
            const phone = normalizarPhone(body.number);
            if (!phone) return null;
            return {
                chatId:        phone,
                msgId:         body.id ? String(body.id) : null,
                texto:         String(body.body || '').trim(),
                tipo:          normTipo(body.type),
                mediaBase64:   body.mediaBase64 || body.base64 || null,
                mediaUrl:      body.mediaUrl || null,
                mediaMimetype: body.mimetype || null,
                quotedText:    body.quotedText || null,
                nomeContato:   body.contactName || body.name || ''
            };
        }

        // Formato numero_cliente/mensagem_cliente (disparo duplicado do ChatBot) → ignorado
        if (body?.numero_cliente && body?.mensagem_cliente !== undefined) {
            console.log('↩️ Ignorando disparo duplicado (formato numero_cliente)');
            return null;
        }

        console.log('⚠️ Payload não reconhecido:', JSON.stringify(body, null, 2).slice(0, 800));
        return null;
    } catch (e) {
        console.error('❌ Erro ao fazer parse do payload:', e.message);
        return null;
    }
}

const mensagensProcessadas = new Set(); // dedup de webhooks
const TIPOS_SUPORTADOS = ['text', 'image', 'document', 'audio', 'ptt', 'video'];

app.post('/webhook', express.json({ limit: '10mb' }), async (req, res) => {
    res.status(200).json({ status: 'ok' }); // responde rápido (evita retry do ChatClean)
    try {
        if (WEBHOOK_SECRET) {
            const raw = req.headers['x-webhook-token'] || req.headers['authorization'] || '';
            const token = raw.replace(/^Bearer\s+/i, '');
            const a = Buffer.from(token.padEnd(128).slice(0, 128));
            const b = Buffer.from(WEBHOOK_SECRET.padEnd(128).slice(0, 128));
            if (token.length !== WEBHOOK_SECRET.length || !crypto.timingSafeEqual(a, b)) {
                console.warn('⚠️ Webhook com token inválido.');
                return;
            }
        }

        console.log('🔍 PAYLOAD RAW:', JSON.stringify(req.body, null, 2).slice(0, 4000));

        const parsed = parsePayload(req.body);
        if (!parsed) return;

        console.log(`📩 Webhook de ${parsed.chatId} [${parsed.tipo}]: "${parsed.texto || '[mídia]'}"`);

        if (!contatoPermitido(parsed.chatId)) {
            console.log(`🚫 Contato ${parsed.chatId} fora da lista de teste — ignorado`);
            return;
        }

        if (parsed.msgId) {
            if (mensagensProcessadas.has(parsed.msgId)) {
                console.log(`↩️ Mensagem duplicada (${parsed.msgId}) ignorada`);
                return;
            }
            mensagensProcessadas.add(parsed.msgId);
            if (mensagensProcessadas.size > 500) {
                [...mensagensProcessadas].slice(0, 200).forEach(id => mensagensProcessadas.delete(id));
            }
        }

        // Mídia não suportada (vídeo, sticker, localização...) → fallback humanizado
        if (!TIPOS_SUPORTADOS.includes(parsed.tipo)) {
            await enviarMensagem(parsed.chatId, 'Pode me mandar por texto o que você precisa? Assim consigo te ajudar melhor 🙂');
            return;
        }

        // Enfileira (nunca descarta): agrupa mensagens rápidas e processa em série.
        enfileirar(parsed);
    } catch (e) {
        console.error('❌ Erro no handler do webhook:', e);
    }
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});
app.get('/webhook', (req, res) => res.status(200).json({ status: 'ok' }));

// Guard dos endpoints administrativos. Aceita a chave em ?key=, no header
// x-admin-key ou Authorization: Bearer. Sem ADMIN_KEY configurada, BLOQUEIA
// (nunca deixa /leads e /diag abertos ao público por omissão).
function checarAdmin(req, res) {
    if (!ADMIN_KEY) {
        res.status(503).json({ erro: 'ADMIN_KEY não configurada no servidor' });
        return false;
    }
    const raw = req.query.key || req.headers['x-admin-key'] || req.headers['authorization'] || '';
    const key = String(raw).replace(/^Bearer\s+/i, '');
    if (key !== ADMIN_KEY) {
        res.status(401).json({ erro: 'não autorizado' });
        return false;
    }
    return true;
}

// Diagnóstico de produção: confere expediente, Redis e a config do Google Calendar
// (presença das variáveis + teste real de auth/freebusy). Não expõe segredos.
app.get('/diag', async (req, res) => {
    if (!checarAdmin(req, res)) return;
    const cfg = cal.diag();
    let calendarLive = null;
    if (cfg.configurado) {
        try {
            const s = await cal.horariosLivres({ dias: 5, max: 1 });
            calendarLive = { ok: true, slotsEncontrados: s.length, exemplo: s[0]?.label || null };
        } catch (e) {
            calendarLive = { ok: false, erro: e.message };
        }
    }
    res.json({
        ok: true,
        expediente: estaEmExpediente(),
        resetInatividadeHoras: RESET_INATIVIDADE / 3600000,
        redis: store.isRedis(),
        pushConfigurado: !!CC_PUSH_URL,
        equipeNumero: !!EQUIPE_NUMERO,
        calendar: cfg,
        calendarLive
    });
});

// Histórico de leads qualificados (útil pra conferência rápida)
app.get('/leads', async (req, res) => {
    if (!checarAdmin(req, res)) return;
    try {
        const ids = await store.scanLeadIds();
        const ativos = [];
        for (const id of ids) {
            try { const l = await store.getLead(id); if (l) ativos.push({ chatId: id, nome: l.nome, empresa: l.empresa, finalizado: !!l.finalizado }); } catch (_) {}
        }
        res.json({ total: ativos.length, ativos });
    } catch (e) {
        res.status(500).json({ erro: e.message });
    }
});

// =============================================================
//  INICIALIZAÇÃO
// =============================================================
app.listen(PORT, () => {
    console.log('');
    console.log('🚀 ================================');
    console.log(`🤖 SDR Virtual ${EMPRESA_INFO.nome} — CHATCLEAN MODE`);
    console.log(`📡 Servidor rodando na porta ${PORT}`);
    console.log(`🔗 Webhook: https://SEU_DOMINIO/webhook`);
    console.log(`❤️  Health:  https://SEU_DOMINIO/health`);
    console.log('🚀 ================================');
    console.log('');
    if (!CC_PUSH_URL)   console.warn('⚠️  CC_PUSH_URL não configurado — a IA não conseguirá responder.');
    if (!EQUIPE_NUMERO) console.warn('ℹ️  EQUIPE_NUMERO não configurado — resumo de lead só irá como nota interna.');
    if (!ADMIN_KEY)     console.warn('🔒 ADMIN_KEY não configurada — /leads e /diag ficarão BLOQUEADOS (503). Defina para liberar o acesso administrativo.');
    if (!process.env.OPENAI_API_KEY) { console.error('❌ OPENAI_API_KEY não configurada no .env!'); process.exit(1); }
    console.log(store.isRedis()
        ? '🗄️  Estado das conversas: Redis (persistente)'
        : '🗄️  Estado das conversas: memória (defina REDIS_URL para persistir entre restarts)');
});

async function shutdown(signal) {
    console.log(`\n⚠️  Recebido sinal ${signal}. Encerrando servidor...`);
    process.exit(0);
}
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGUSR2', () => shutdown('SIGUSR2'));
