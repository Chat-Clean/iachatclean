require('dotenv').config();
const express = require('express');
const OpenAI = require('openai');
const axios = require('axios');
const FormData = require('form-data');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');

const app = express();
app.use(express.json({ limit: '10mb' }));
// Painéis low-code nem sempre deixam escolher o Content-Type: aceitar formulário
// evita que o corpo chegue vazio e a mensagem seja descartada em silêncio.
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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
const WEBHOOK_SECRET  = (process.env.WEBHOOK_SECRET || '').trim();
const EQUIPE_NUMERO  = process.env.EQUIPE_NUMERO  || '';
const IA_ALLOWED_CONTACTS = (process.env.IA_ALLOWED_CONTACTS || '').split(',').map(s => s.trim()).filter(Boolean);
const PORT           = process.env.PORT           || 3000;
// Chave para proteger os endpoints administrativos (/leads, /diag), que expõem
// dados de leads e config. Sem ela, esses endpoints ficam BLOQUEADOS (não abertos).
const ADMIN_KEY      = process.env.ADMIN_KEY      || '';
// A IA NÃO responde em grupos por padrão (só conversa individual). Para permitir
// grupos no futuro, defina IGNORAR_GRUPOS=false.
const IGNORAR_GRUPOS = (process.env.IGNORAR_GRUPOS || 'true') !== 'false';
// A IA só responde tickets PENDENTES (na fila). Quando um humano aceita a
// conversa (ticket sai de "pending"), a IA para de responder. Para desativar
// esse filtro, defina IA_SO_PENDENTES=false.
const IA_SO_PENDENTES = (process.env.IA_SO_PENDENTES || 'true') !== 'false';
// Rate-limit por número: no máximo RATE_LIMIT_MSGS mensagens por janela de
// RATE_LIMIT_JANELA_S segundos (proteção contra loop/spam e custo OpenAI).
// 0 desativa. Padrão: 20 msgs / 60s.
const RATE_LIMIT_MSGS   = parseInt(process.env.RATE_LIMIT_MSGS   || '20', 10);
const RATE_LIMIT_JANELA = parseInt(process.env.RATE_LIMIT_JANELA_S || '60', 10) * 1000;
// Blindagem anti-loop (contra outras IAs / auto-respondedores): se um mesmo
// contato trocar mais de LOOP_MAX_TURNOS mensagens em LOOP_JANELA_MIN minutos,
// ou repetir a mesma mensagem, a IA PAUSA as respostas para não entrar em
// ping-pong infinito com outro bot.
const LOOP_MAX_TURNOS = parseInt(process.env.LOOP_MAX_TURNOS || '15', 10);
const LOOP_JANELA_MS  = parseInt(process.env.LOOP_JANELA_MIN || '3', 10) * 60 * 1000;
// Janela (ms) para AGRUPAR mensagens rápidas do mesmo cliente antes de responder.
// No WhatsApp o cliente costuma mandar várias mensagens seguidas; juntamos tudo
// num único turno em vez de responder só a primeira e ignorar o resto.
const AGRUPAR_MS     = parseInt(process.env.AGRUPAR_MENSAGENS_MS || '2000', 10);
// Log do payload BRUTO. Desligado por padrao: o corpo traz nome, telefone, URL
// da foto e o wamid (que carrega o numero embutido) — PII sob LGPD no stdout.
// Ligue so para depurar um formato novo, e desligue depois.
const LOG_PAYLOAD_RAW = (process.env.LOG_PAYLOAD_RAW || 'false') === 'true';
// COMO a resposta chega ao lead. Por padrao ela volta no CORPO da requisicao
// (`respostas`) e quem envia e a plataforma que chamou o webhook. Se a
// plataforma NAO le o corpo da resposta, o lead fica sem receber nada: ligue
// esta flag para a resposta sair pela Push API (CC_PUSH_URL), como antes da
// migracao para request/response. Ligada, `respostas` volta vazio de proposito,
// para a mensagem nao ser entregue duas vezes.
const RESPOSTA_VIA_PUSH = (process.env.RESPOSTA_VIA_PUSH || 'false') === 'true';
// Modelos da OpenAI por tarefa. Estavam fixos no meio do codigo, em quatro
// lugares diferentes; agora sao uma decisao de configuracao.
const MODELO_RESPOSTA  = process.env.MODELO_RESPOSTA  || 'gpt-4o-mini';
const MODELO_EXTRACAO  = process.env.MODELO_EXTRACAO  || 'gpt-4o-mini';
const MODELO_VISAO     = process.env.MODELO_VISAO     || 'gpt-4o';
// Reinicia o atendimento após N horas sem interação do cliente (padrão: 24h).
const RESET_INATIVIDADE = parseInt(process.env.RESET_INATIVIDADE_HORAS || '24', 10) * 3600 * 1000;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const { EMPRESA_INFO, SEGMENTOS, DEPARTAMENTOS } = require('./data');
const { SYSTEM_SDR, promptExtracao, promptResposta } = require('./prompts');
const { determinarProximoCampo, aplicarCampos, detectarSegmento, escolhaDeSlot, registrarTentativa } = require('./flow');
const { estaEmExpediente } = require('./horario');
const cal = require('./calendar'); // Google Calendar (inerte se não configurado)
const pipeline = require('./pipeline'); // Oportunidades no CRM (inerte se não configurado)
const store = require('./store'); // estado das conversas (Redis + fallback em memória)

const processandoMensagem = new Map(); // lock de processamento (por instância)

// =============================================================
//  UTILITÁRIOS
// =============================================================
// Normalizacao de telefone vive em src/shared/telefone.js (camada pura,
// coberta por test/unidade/telefone.test.js). O legado apenas delega: a
// allow-list continua sendo lida do ambiente aqui, fora da camada pura.
const telefone = require('./src/shared/telefone');

const normalizarPhone = telefone.normalizarPhone;
const contatoPermitido = (numero) => telefone.contatoPermitido(numero, IA_ALLOWED_CONTACTS);

// =============================================================
//  CHATCLEAN — ENVIO VIA PUSH API
//  Um único endpoint autenticado (CC_PUSH_URL) entrega as mensagens.
//  O token JWT já vem embutido na URL como ?token=... (sem header).
// =============================================================
// Contexto do MODO SÍNCRONO (/api/mensagem). Quando ativo, as mensagens
// destinadas ao próprio lead são CAPTURADAS (devolvidas no corpo da resposta)
// em vez de saírem pela Push API. Mensagens para outros números (EQUIPE_NUMERO)
// continuam saindo normalmente por HTTP.
const capturaCtx = new AsyncLocalStorage();

async function ccPush(number, payloadExtra = {}) {
    // Resposta ao lead durante um turno síncrono: não sai por push, é devolvida
    // no corpo da requisição. Todo o resto — nota interna no ticket (onlyNote),
    // resumo para a equipe (outro número) e follow-up de reativação (fora de
    // qualquer requisição) — continua saindo normalmente pela Push API.
    const cap = capturaCtx.getStore();
    // Resposta AO LEAD dentro de um turno — o que distingue de nota interna,
    // resumo para a equipe (outro numero) e follow-up fora de requisicao.
    const respostaAoLead = Boolean(
        cap && payloadExtra.body && !payloadExtra.onlyNote
        && normalizarPhone(number) === cap.chatId
    );
    if (!RESPOSTA_VIA_PUSH && respostaAoLead && !cap.expirado) {
        cap.mensagens.push(String(payloadExtra.body));
        return true;
    }
    if (!CC_PUSH_URL) { console.warn('⚠️ CC_PUSH_URL não configurado no .env — envio ignorado'); return false; }
    try {
        await axios.post(CC_PUSH_URL, {
            number: normalizarPhone(number),
            externalKey: crypto.randomUUID(),
            ...payloadExtra
        }, { headers: { 'Content-Type': 'application/json' }, timeout: 30000 });
        // Sem esta contagem o turno em modo push se declarava silencioso: a
        // captura fica vazia de proposito e o log dizia "nao gerou resposta"
        // logo depois de responder.
        if (respostaAoLead) cap.enviadasPorPush = (cap.enviadasPorPush || 0) + 1;
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
    const emCaptura = !!capturaCtx.getStore();
    for (const parte of partes) {
        // No modo síncrono não faz sentido simular digitação: o fluxo está
        // esperando a resposta e o delay só aumentaria o tempo da requisição.
        if (!emCaptura) await new Promise(r => setTimeout(r, 900 + parte.length * 18));
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
            model: MODELO_EXTRACAO,
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
// Contexto que os analisadores precisam para as regras que dependem do
// historico (nome repetido, pergunta repetida).
function contextoDeQualidade(leadData) {
    const primeiroNome = (leadData.nome || '').split(' ')[0];
    const respostasAnteriores = (leadData.conversationHistory || []).filter((h) => h.role === 'assistant');
    const ultima = respostasAnteriores[respostasAnteriores.length - 1];
    return {
        primeiroNome,
        // Citar hora so e legitimo depois de o SISTEMA oferecer a grade numerada.
        sistemaOfereceuHorarios: Boolean(
            leadData.aguardandoEscolhaSlot && (leadData.slotsOferecidos || []).length
        ),
        usouNomeNaAnterior: Boolean(
            ultima && primeiroNome.length > 1 && String(ultima.content).toLowerCase().includes(primeiroNome.toLowerCase())
        ),
        perguntasAnteriores: respostasAnteriores
            .map((h) => extrairPergunta(h.content))
            .filter(Boolean)
    };
}

async function gerarRespostaIA(leadData, mensagemCliente, proximoCampo, historicoRecente = [], expediente = null) {
    const mensagemSanitizada = mensagemCliente.replace(/[<>]/g, '').substring(0, 1000);
    const isInicioConversa = leadData.conversationHistory.length === 0;
    const prompt = promptResposta({ isInicioConversa, mensagemSanitizada, proximoCampo, leadData, expediente });
    const mensagens = [
        { role: 'system', content: SYSTEM_SDR },
        ...historicoRecente,
        { role: 'user', content: prompt }
    ];

    const pedir = async (extra) => {
        const completion = await openai.chat.completions.create({
            model: MODELO_RESPOSTA,
            messages: extra ? [...mensagens, { role: 'user', content: extra }] : mensagens,
            temperature: 0.7
        });
        return completion.choices[0].message.content.trim();
    };

    let resposta = await pedir(null);

    // GUARDA: instrucao em linguagem natural e probabilistica; invariante de
    // negocio nao pode ser. Medido pelo eval, o modelo inventou faixa de preco
    // em 2 de 6 turnos do roteiro de pressao de preco, apesar de o prompt
    // proibir. Aqui a violacao critica vira uma segunda tentativa dirigida e,
    // se ela tambem falhar, uma resposta enlatada que nunca quebra a regra.
    const ctx = contextoDeQualidade(leadData);
    const veredito = guarda.avaliar(resposta, ctx);
    if (!veredito.ok) {
        const ids = veredito.corrigiveis.map((v) => v.id).join(', ');
        console.warn(`🛡️ Resposta violou [${ids}] — regerando.`);
        try {
            const segunda = await pedir(veredito.instrucaoDeCorrecao);
            const vereditoSegunda = guarda.avaliar(segunda, ctx);
            if (vereditoSegunda.ok) {
                resposta = segunda;
            } else if (vereditoSegunda.respostaSegura) {
                console.warn('🛡️ Segunda tentativa também violou — usando resposta segura.');
                resposta = vereditoSegunda.respostaSegura;
            } else {
                resposta = segunda; // violação alta remanescente: melhor que a primeira
            }
        } catch (e) {
            console.error('🛡️ Falha ao regerar:', e.message);
            if (veredito.respostaSegura) resposta = veredito.respostaSegura;
        }
    }

    return resposta;
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
            model: MODELO_VISAO,
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
            model: MODELO_RESPOSTA,
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
// A falha do Google Calendar era SILENCIOSA: o bot caía no fluxo normal, parava
// de agendar e ninguém ficava sabendo até alguém notar que não havia reunião
// nova. O caso mais comum é `invalid_grant` — refresh token expirado, o que
// acontece a cada 7 dias enquanto a tela de consentimento estiver em "Teste"
// (ver GOOGLE_CALENDAR_SETUP.md). Aqui a equipe é avisada, no máximo uma vez a
// cada AVISO_AGENDA_INTERVALO_MS, para não virar spam.
const AVISO_AGENDA_INTERVALO_MS = 6 * 60 * 60 * 1000; // 6h
let ultimoAvisoAgenda = 0;

async function avisarFalhaDeAgenda(erro) {
    const msg = erro && erro.message ? erro.message : String(erro);
    console.error('❌ Erro ao consultar horários livres:', msg);

    const ehAuth = /invalid_grant|invalid_client|unauthorized|401|403/i.test(msg);
    const agora = Date.now();
    if (!EQUIPE_NUMERO || agora - ultimoAvisoAgenda < AVISO_AGENDA_INTERVALO_MS) return;
    ultimoAvisoAgenda = agora;

    const detalhe = ehAuth
        ? 'A autorização do Google expirou (invalid_grant). Rode "npm run gauth", atualize GOOGLE_REFRESH_TOKEN no EasyPanel e faça redeploy. Para não repetir, mude a tela de consentimento OAuth para "Em produção".'
        : `Erro: ${msg}`;
    try {
        await ccPush(EQUIPE_NUMERO, {
            body: `⚠️ A IA parou de agendar reuniões — o Google Calendar não respondeu.\n${detalhe}\nEnquanto isso os leads seguem sendo atendidos, mas NENHUMA reunião está sendo marcada.`
        });
    } catch (_) {}
}

async function tratarAgendamento(chatId, leadData, texto, extraido, exp) {
    if (!cal.configurado()) return false;

    // 1) Cliente escolhendo um horário já oferecido → cria o evento
    if (leadData.aguardandoEscolhaSlot) {
        const slots = leadData.slotsOferecidos || [];
        const escolha = escolhaDeSlot(texto, extraido, slots.length);
        if (escolha && slots[escolha - 1]) {
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
                // Cria a oportunidade no funil comercial (etapa "REUNIÃO MARCADA").
                // Best-effort: falha aqui NÃO impacta o agendamento nem o atendimento.
                if (pipeline.configurado()) {
                    if (leadData.contactId) {
                        // Nome do card = nome do lead (+ empresa, quando houver) para
                        // bater o olho no Kanban. Sem nome → cai no PIPELINE_OPP_NOME.
                        const nomeCard = leadData.nome
                            ? `${leadData.nome}${leadData.empresa ? ' — ' + leadData.empresa : ''}`
                            : undefined;
                        const opp = await pipeline.criarOportunidade({
                            contactId: leadData.contactId,
                            nome: nomeCard,
                            descricao: `Reunião marcada para ${ev.label}`
                        });
                        if (opp) leadData.oportunidadeId = opp.id;
                    } else {
                        console.warn(`⚠️ ${chatId}: reunião agendada sem contactId — oportunidade não criada no CRM.`);
                    }
                }
                await notificarEquipe(leadData, chatId, { departamento: DEPARTAMENTOS.comercial, tagExtra: 'REUNIÃO AGENDADA' });
                leadData.finalizado = true;
                return true;
            } catch (e) {
                console.error('❌ Erro ao agendar reunião:', e.message);
                leadData.aguardandoEscolhaSlot = false; // deixa o fluxo normal seguir
                return false;
            }
        }
        // Não escolheu um horário. Se RECUSOU a reunião, encerra a espera para o
        // fluxo normal encaminhar ao time (triagem). Se só trouxe uma dúvida,
        // segue aguardando (o fluxo responde a dúvida sem finalizar).
        if (extraido?.recusouReuniao) {
            leadData.aguardandoEscolhaSlot = false;
            leadData.slotsOferecidos = null;
        }
        return false;
    }

    // 2) Deve oferecer horários? Sempre após a qualificação (dentro OU fora do
    //    expediente), ou quando o cliente pede explicitamente para agendar.
    const deveAgendar = leadData.qualificacaoCompleta || extraido?.querAgendar;
    if (deveAgendar && !leadData.reuniaoAgendada) {
        let slots = [];
        try { slots = await cal.horariosLivres({ dias: 5, max: 3 }); }
        catch (e) { await avisarFalhaDeAgenda(e); return false; }
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
async function processarMensagem({ chatId, contactId, texto, tipo, mediaBase64, mediaUrl, mediaMimetype, quotedText, nomeContato }) {
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

    // Lock cross-instância (Redis): impede que outro container processe o mesmo
    // lead ao mesmo tempo. Sem Redis, é no-op (o lock em memória acima já basta).
    const lockRedis = await store.acquireLock(chatId, 60000);
    if (!lockRedis) {
        console.log(`🔒 ${chatId} já está sendo processado por outra instância — pulando.`);
        clearTimeout(timeoutId);
        processandoMensagem.delete(chatId);
        return;
    }

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
        if (contactId && !leadData.contactId) leadData.contactId = contactId; // p/ criar oportunidade no CRM ao agendar
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

        // --- Blindagem anti-loop (contra outras IAs / auto-respondedores) ---
        // Se o contato dispara muitas mensagens numa janela curta, ou repete a
        // mesma mensagem, PAUSA as respostas — evita ping-pong infinito com outro
        // bot (ex.: IA da operadora). Cobre também o caminho pós-encaminhamento.
        {
            const agoraMs = Date.now();
            leadData.turnosTs = (leadData.turnosTs || []).filter(t => agoraMs - t < LOOP_JANELA_MS);
            leadData.turnosTs.push(agoraMs);
            if (leadData.turnosTs.length <= 2) leadData.loopAvisado = false; // conversa normalizou
            const textoNorm = String(texto || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200);
            leadData.ultimasMsgs = leadData.ultimasMsgs || [];
            const repetida = textoNorm.length > 1 && leadData.ultimasMsgs.filter(t => t === textoNorm).length >= 2;
            leadData.ultimasMsgs.push(textoNorm);
            if (leadData.ultimasMsgs.length > 6) leadData.ultimasMsgs.shift();

            if (leadData.turnosTs.length > LOOP_MAX_TURNOS || repetida) {
                if (!leadData.loopAvisado) {
                    leadData.loopAvisado = true;
                    console.warn(`🔁 Possível loop em ${chatId} (${leadData.turnosTs.length} msgs/${LOOP_JANELA_MS / 60000}min${repetida ? ', msg repetida' : ''}).`);

                    // Repetir a MESMA mensagem quase sempre é gente, não bot: o
                    // cliente não está sendo entendido e insiste. Emudecer aqui é
                    // o pior desfecho possível — o ciclo vira "bot confunde ->
                    // humano repete -> bot cala". Então transferimos para uma
                    // pessoa em vez de sumir.
                    if (repetida && !leadData.finalizado) {
                        console.warn(`🙋 ${chatId} repetiu a mesma mensagem — transferindo para humano em vez de silenciar.`);
                        try {
                            const histLoop = leadData.conversationHistory.slice(-8).map(h => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content }));
                            if (!usuarioNoHistorico) leadData.conversationHistory.push({ role: 'user', content: texto });
                            await encaminhar(chatId, leadData, DEPARTAMENTOS.comercial, texto, histLoop);
                            return;
                        } catch (e) {
                            console.error('❌ Falha ao transferir por loop:', e.message);
                        }
                    }

                    // Volume alto sem repetição: mais provável ping-pong com outro
                    // bot. Aqui pausar É o certo — mas a equipe precisa saber.
                    if (EQUIPE_NUMERO) { try { await ccPush(EQUIPE_NUMERO, { body: `⚠️ Possível loop com outro bot/IA no contato ${chatId}. A IA pausou as respostas para não entrar em ping-pong. Verificar manualmente.` }); } catch (_) {} }
                }
                return; // não responde — corta o loop
            }
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
        // Acusa o recebimento e ENCERRA o turno (sem gerar outra mensagem em seguida);
        // a próxima mensagem do cliente retoma a qualificação normalmente.
        if (tipo === 'document') {
            const ack = 'Recebi o arquivo! Vou deixar registrado pro nosso especialista analisar junto com você 😊';
            await enviarMensagem(chatId, ack);
            leadData.conversationHistory.push({ role: 'user', content: '[O cliente enviou um documento]' });
            leadData.conversationHistory.push({ role: 'assistant', content: ack });
            return;
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
        leadData.naoEntendeuAgora = null;

        if (extraido) {
            aplicarCampos(leadData, extraido);
            if (extraido.objecao) leadData.objecaoAtiva = extraido.objecao;
            if (extraido.perguntou) leadData.perguntouAgora = true;
            // Ruido na comunicacao: o cliente disse que nao entendeu, que foi mal
            // interpretado ou que a pergunta ja tinha sido feita. Um sinal manda
            // reformular; dois seguidos significam que a IA nao vai desatar o no
            // sozinha, e insistir so queima o lead.
            if (extraido.naoEntendeu) {
                leadData.naoEntendeuAgora = true;
                leadData.naoEntendeuSeguidos = (leadData.naoEntendeuSeguidos || 0) + 1;
            } else {
                leadData.naoEntendeuSeguidos = 0;
            }
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
                if (!usuarioNoHistorico) leadData.conversationHistory.push({ role: 'user', content: texto });
                await enviarMensagem(chatId, 'Entendi! Vou te encaminhar pro nosso time de Suporte, que já cuida disso com você 😊');
                await notificarEquipe(leadData, chatId, { departamento: DEPARTAMENTOS.suporte, tagExtra: 'CLIENTE ATUAL' });
                leadData.finalizado = true;
                return;
            }

            // Dois sinais seguidos de incompreensão → passa para uma pessoa.
            if (leadData.naoEntendeuSeguidos >= 2 && !leadData.finalizado) {
                console.warn(`🤝 ${chatId} sinalizou incompreensão 2x seguidas — transferindo para humano.`);
                const histRuido = leadData.conversationHistory.slice(-8).map(h => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content }));
                if (!usuarioNoHistorico) leadData.conversationHistory.push({ role: 'user', content: texto });
                await encaminhar(chatId, leadData, DEPARTAMENTOS.comercial, texto, histRuido, exp);
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
        // Conta a insistencia UMA vez por turno. Depois de MAX_TENTATIVAS o
        // campo e dado por recusado e o funil segue — sem isso, um lead que se
        // negasse a informar a empresa nunca chegava ao encaminhamento.
        registrarTentativa(leadData, proximoCampoDepois && proximoCampoDepois.campo);

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
        leadData.naoEntendeuAgora = null;
        leadData.analiseImagem = null;

        await enviarMensagensQuebradas(chatId, resposta);
        if (!usuarioNoHistorico) leadData.conversationHistory.push({ role: 'user', content: texto });
        leadData.conversationHistory.push({ role: 'assistant', content: resposta });
        if (leadData.conversationHistory.length > 100) {
            leadData.conversationHistory = leadData.conversationHistory.slice(-100);
        }

        // Qualificação completa → notifica a equipe e encerra (triagem). NÃO
        // finaliza enquanto o cliente ainda está escolhendo um horário de reunião
        // (aguardandoEscolhaSlot) — nesse caso a IA segue conversando/tirando
        // dúvidas até ele escolher, recusar, ou o agendamento concluir.
        if (leadData.qualificacaoCompleta && !leadData.finalizado && !leadData.aguardandoEscolhaSlot) {
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
        await store.releaseLock(chatId);
    }
}

// =============================================================
//  AGRUPAMENTO DE MENSAGENS PICOTADAS + SERIALIZAÇÃO POR CLIENTE
//  No WhatsApp o cliente manda várias mensagens seguidas ("oi", "tudo bem?",
//  "queria saber do preço"). Como cada uma vira uma requisição do fluxo, elas
//  chegam aqui separadas. Em vez de responder três vezes, seguramos a rajada
//  por AGRUPAR_MS: as requisições anteriores respondem status "agrupado" com
//  respostas vazias (o fluxo não envia nada) e a ÚLTIMA da sequência recebe a
//  resposta do turno inteiro, com todos os textos já concatenados.
//
//  Turnos do mesmo cliente também rodam em série: se a IA ainda está pensando
//  numa mensagem, a próxima espera a vez em vez de esbarrar no lock e voltar vazia.
// =============================================================
const buffersSync   = new Map(); // chatId -> rajada em montagem
const cadeiaPorChat = new Map(); // chatId -> promessa do último turno (serialização)

// Encadeia fn depois do turno anterior do mesmo chatId (tendo ele falhado ou não).
function emSerie(chatId, fn) {
    const anterior = cadeiaPorChat.get(chatId) || Promise.resolve();
    const atual = anterior.then(fn, fn);
    const marcado = atual.then(() => {}, () => {});
    cadeiaPorChat.set(chatId, marcado);
    marcado.then(() => { if (cadeiaPorChat.get(chatId) === marcado) cadeiaPorChat.delete(chatId); });
    return atual;
}

// Junta a rajada acumulada num único turno para o processarMensagem.
function montarUnidade(chatId, b) {
    return {
        chatId,
        contactId:     b.contactId,
        msgId:         b.ids.join(',') || null,
        texto:         b.partes.join('\n'),
        tipo:          b.midia ? b.midia.tipo : 'text',
        mediaBase64:   b.midia ? b.midia.mediaBase64   : null,
        mediaUrl:      b.midia ? b.midia.mediaUrl      : null,
        mediaMimetype: b.midia ? b.midia.mediaMimetype : null,
        quotedText:    b.quoted,
        nomeContato:   b.nome,
    };
}

// Roda um turno com a captura ativa e devolve o corpo da resposta HTTP.
async function executarTurno(unidade) {
    const captura = { chatId: unidade.chatId, mensagens: [], expirado: false, enviadasPorPush: 0 };
    let estourou = false;
    let timer = null;
    const guarda = new Promise(resolve => {
        timer = setTimeout(() => { estourou = true; captura.expirado = true; resolve(); }, SYNC_TIMEOUT_MS);
    });
    await capturaCtx.run(captura, () => Promise.race([
        emSerie(unidade.chatId, () => processarMensagem(unidade)),
        guarda,
    ]));
    clearTimeout(timer);

    if (estourou) {
        console.warn('⏱️ Turno de ' + unidade.chatId + ' passou de ' + SYNC_TIMEOUT_MS + 'ms — respondendo com o que já há.');
    }
    if (!captura.mensagens.length && captura.enviadasPorPush) {
        console.log('✅ Turno de ' + unidade.chatId + ' respondeu ' + captura.enviadasPorPush +
                    ' mensagem(ns) pela Push API (RESPOSTA_VIA_PUSH=true).');
    } else if (!captura.mensagens.length) {
        console.log('ℹ️ Turno de ' + unidade.chatId + ' não gerou resposta ao lead (encaminhamento, loop detectado ou turno silencioso).');
    } else {
        // Turno bem-sucedido nao logava NADA, entao "a IA nao responde" era
        // indistinguivel de "a resposta nao chegou ao lead". Conta e tamanho
        // bastam para separar os dois casos; o texto fica fora do log.
        const chars = captura.mensagens.join('').length;
        console.log('✅ Turno de ' + unidade.chatId + ' respondeu ' + captura.mensagens.length +
                    ' mensagem(ns), ' + chars + ' chars.');
    }
    return {
        status: 'ok',
        chatId: unidade.chatId,
        timeout: estourou,
        respostas: captura.mensagens,
        resposta: captura.mensagens.join('\n'),
    };
}

// Acumula a mensagem na rajada do cliente e devolve a promessa da resposta HTTP.
function agruparEProcessar(parsed) {
    return new Promise(resolve => {
        const { chatId } = parsed;
        let b = buffersSync.get(chatId);
        if (!b) {
            b = { partes: [], ids: [], nome: '', quoted: null, contactId: null, midia: null, timer: null, responder: null };
            buffersSync.set(chatId, b);
        }

        // Chegou mensagem nova antes de a rajada fechar: a requisição que estava
        // esperando responde vazia agora (o fluxo não envia nada) e quem responde
        // pelo turno passa a ser esta.
        if (b.responder) {
            b.responder({ status: 'agrupado', motivo: 'mensagem agrupada — a resposta sai na última requisição da sequência', chatId, respostas: [], resposta: '' });
            b.responder = null;
        }
        if (b.timer) { clearTimeout(b.timer); b.timer = null; }

        if (parsed.texto)                     b.partes.push(parsed.texto);
        if (parsed.msgId)                     b.ids.push(parsed.msgId);
        if (!b.nome && parsed.nomeContato)    b.nome = parsed.nomeContato;
        if (!b.quoted && parsed.quotedText)   b.quoted = parsed.quotedText;
        if (!b.contactId && parsed.contactId) b.contactId = parsed.contactId;
        if (parsed.tipo !== 'text') {
            if (b.midia) console.warn('⚠️ Duas mídias na mesma rajada de ' + chatId + ' — processando só a última.');
            b.midia = parsed;
        }
        b.responder = resolve;

        // Mídia não espera agrupamento (não dá pra concatenar imagem com imagem).
        const espera = b.midia ? 0 : AGRUPAR_MS;
        b.timer = setTimeout(() => {
            buffersSync.delete(chatId);
            const responder = b.responder;
            b.responder = null;
            if (b.partes.length > 1) console.log('🧩 ' + b.partes.length + ' mensagens de ' + chatId + ' agrupadas num turno só.');
            executarTurno(montarUnidade(chatId, b)).then(responder, e => {
                console.error('❌ Erro no turno de ' + chatId + ':', e);
                responder({ status: 'erro', motivo: e.message, chatId, respostas: [], resposta: '' });
            });
        }, espera);
    });
}

// =============================================================
//  WEBHOOK — PARSE DO PAYLOAD (delegado ao ACL)
//
//  O reconhecimento de formato saiu daqui: vive em
//  src/infrastructure/chatclean/acl/tradutor.js, coberto por
//  test/caracterizacao/tradutor-payload.test.js (28 casos).
//
//  O que sobra neste arquivo e o efeito colateral que nao pertence a camada
//  pura: transformar o motivo do descarte em log. O tradutor devolve POR QUE
//  descartou, entao o log agora diz o motivo em vez de um "nao reconhecido"
//  generico para qualquer causa.
// =============================================================
const acl = require('./src/infrastructure/chatclean/acl/tradutor');
const guarda = require('./src/domain/qualidade/guarda');
const { extrairPergunta } = require('./src/domain/qualidade/analisadores');
const { MOTIVOS } = require('./src/domain/mensageria/MotivoDeDescarte');
const { resumoSeguro } = require('./src/shared/resumoDePayload');
const { criarRegistroDeTurnos } = require('./src/shared/registroDeTurnos');

const normalizarCorpo = acl.normalizarCorpo;

function parsePayload(body) {
    try {
        const r = acl.traduzir(body, { ignorarGrupos: IGNORAR_GRUPOS, soPendentes: IA_SO_PENDENTES });
        if (r.aceita) {
            const { aceita: _aceita, ...mensagem } = r;
            return mensagem;
        }
        if (r.motivo === MOTIVOS.FORMATO_DESCONHECIDO) {
            console.log('⚠️ Payload não reconhecido:', JSON.stringify(acl.normalizarCorpo(body), null, 2).slice(0, 800));
        } else {
            console.log(`⏭️ Descartado [${r.motivo}]: ${r.descricao}${r.detalhe ? ' — ' + r.detalhe : ''}`);
        }
        return null;
    } catch (e) {
        console.error('❌ Erro ao fazer parse do payload:', e.message);
        return null;
    }
}

const registroDeTurnos = criarRegistroDeTurnos(); // reenvio devolve a MESMA resposta
const TIPOS_SUPORTADOS = ['text', 'image', 'document', 'audio', 'ptt', 'video'];

// Valida o token do webhook contra WEBHOOK_SECRET. Aceita no header
// (x-webhook-token / Authorization: Bearer), na query (?token=) ou no path
// (/webhook/<token>). Se WEBHOOK_SECRET estiver vazio, o webhook fica aberto
// (compat) — CONFIGURE-O antes do go-live e aponte a URL do ChatClean para
// https://.../webhook/<secret> (ou .../webhook?token=<secret>).
function tokensRecebidos(req) {
    return {
        'header x-webhook-token': req.headers['x-webhook-token'],
        'header authorization':   req.headers['authorization'],
        'query ?token=':          req.query && req.query.token,
        'path /webhook/<token>':  req.params && req.params.token,
    };
}

function webhookAutorizado(req) {
    if (!WEBHOOK_SECRET) return true;
    // Testa TODAS as origens. O || encadeado da versão anterior fazia o header
    // Authorization do provedor mascarar o token que vinha no path/query.
    return Object.values(tokensRecebidos(req)).some(raw => {
        const token = String(raw || '').replace(/^Bearer\s+/i, '').trim();
        if (!token || token.length !== WEBHOOK_SECRET.length) return false;
        const a = Buffer.from(token.padEnd(128).slice(0, 128));
        const b = Buffer.from(WEBHOOK_SECRET.padEnd(128).slice(0, 128));
        return crypto.timingSafeEqual(a, b);
    });
}

// Diagnóstico: mostra ONDE o token chegou e com que tamanho, sem vazar o valor.
// É isso que diz se o provedor manda token e em qual campo.
function logTokenInvalido(req) {
    const vistos = Object.entries(tokensRecebidos(req))
        .map(([onde, v]) => {
            const t = String(v || '').replace(/^Bearer\s+/i, '').trim();
            return t ? onde + '=' + t.length + 'ch' : null;
        })
        .filter(Boolean);
    console.warn(
        '⚠️ Token inválido ou ausente — requisição ignorada. Esperado: ' +
        WEBHOOK_SECRET.length + 'ch. Recebido: ' +
        (vistos.length ? vistos.join(' | ') : 'NENHUM token em nenhum campo') + '.'
    );
}

// Rate-limit por número (janela deslizante em memória, por instância).
const rateHits = new Map(); // chatId -> [timestamps]
function dentroDoLimite(chatId) {
    if (!RATE_LIMIT_MSGS) return true; // desativado
    const agora = Date.now();
    const hits = (rateHits.get(chatId) || []).filter(t => agora - t < RATE_LIMIT_JANELA);
    hits.push(agora);
    rateHits.set(chatId, hits);
    if (rateHits.size > 5000) { // poda defensiva
        for (const [k, v] of rateHits) {
            if (!v.length || agora - v[v.length - 1] > RATE_LIMIT_JANELA) rateHits.delete(k);
        }
    }
    return hits.length <= RATE_LIMIT_MSGS;
}

// =============================================================
//  ENDPOINT ÚNICO — POST /api/mensagem  (alias: POST /webhook)
//  Modelo request/response: o fluxo manda a mensagem do cliente e recebe a
//  resposta da IA no corpo da PRÓPRIA requisição. Não há push de volta.
//
//  Corpo da resposta:
//    { status, chatId, timeout, respostas: [...], resposta: "..." }
//
//  Como o fluxo deve reagir a cada status:
//    "ok"       → envie o conteúdo de respostas (uma mensagem por item).
//    "agrupado" → NÃO envie nada. Esta mensagem entrou numa rajada e a resposta
//                 do turno inteiro sai na última requisição da sequência.
//    "ignorado" → NÃO envie nada (payload não reconhecido, contato fora da
//                 allow-list, mensagem duplicada ou rate-limit). Veja "motivo".
//    "erro"     → falha do servidor; o motivo vem em "motivo".
//
//  O que NÃO é resposta ao lead não aparece aqui e não é responsabilidade do
//  fluxo: nota interna no ticket, resumo do lead qualificado para a equipe e
//  follow-up de reativação continuam saindo pela Push API (CC_PUSH_URL).
// =============================================================
const SYNC_TIMEOUT_MS = parseInt(process.env.SYNC_TIMEOUT_MS || '90000', 10);

function respIgnorado(res, motivo, chatId) {
    return res.status(200).json({
        status: 'ignorado', motivo, chatId: chatId || null,
        timeout: false, respostas: [], resposta: '',
    });
}

async function handleApiMensagem(req, res) {
    if (!webhookAutorizado(req)) {
        logTokenInvalido(req);
        return res.status(401).json({
            status: 'erro', motivo: 'token inválido ou ausente',
            timeout: false, respostas: [], resposta: '',
        });
    }
    try {
        const corpo = normalizarCorpo(req.body);
        if (LOG_PAYLOAD_RAW) {
            console.warn('🔍 PAYLOAD RAW (LOG_PAYLOAD_RAW=true — contém PII, desligue em produção):',
                        JSON.stringify(req.body, null, 2).slice(0, 4000));
        } else {
            console.log('🔍 PAYLOAD:', JSON.stringify(resumoSeguro(req.body, req.headers['content-type'])));
        }

        const parsed = parsePayload(corpo);
        if (!parsed) return respIgnorado(res, 'payload não reconhecido ou mensagem descartada');

        console.log(`📩 ${parsed.chatId} [${parsed.tipo}]: "${parsed.texto || '[mídia]'}"`);

        if (!contatoPermitido(parsed.chatId)) {
            console.log(`🚫 Contato ${parsed.chatId} fora da lista de teste — ignorado`);
            return respIgnorado(res, 'contato fora da allow-list', parsed.chatId);
        }

        // Rate-limit por número (anti-spam / loop / proteção de custo OpenAI).
        if (!dentroDoLimite(parsed.chatId)) {
            console.warn(`🚦 Rate-limit: ${parsed.chatId} passou de ${RATE_LIMIT_MSGS}/${RATE_LIMIT_JANELA / 1000}s — ignorando.`);
            return respIgnorado(res, 'rate-limit', parsed.chatId);
        }

        // Mídia não suportada (sticker, localização...) → fallback humanizado
        if (!TIPOS_SUPORTADOS.includes(parsed.tipo)) {
            const aviso = 'Pode me mandar por texto o que você precisa? Assim consigo te ajudar melhor 🙂';
            return res.status(200).json({
                status: 'ok', chatId: parsed.chatId, timeout: false,
                respostas: [aviso], resposta: aviso,
            });
        }

        // Agrupa a rajada e espera o turno; a resposta sai na última requisição.
        // Reenvio do MESMO msgId (o chamador desistiu por timeout) nao entra na
        // rajada de novo: espera o turno original e recebe a mesma resposta.
        const { promessa, reenvio } = registroDeTurnos.obterOuCriar(
            parsed.msgId,
            () => agruparEProcessar(parsed)
        );
        if (reenvio) {
            console.log(`↩️ Reenvio de ${parsed.msgId} — aguardando a resposta do turno original.`);
        }
        return res.status(200).json(await promessa);
    } catch (e) {
        console.error('❌ Erro no handler:', e);
        return res.status(500).json({
            status: 'erro', motivo: e.message,
            timeout: false, respostas: [], resposta: '',
        });
    }
}

// O mesmo handler atende /api/mensagem e /webhook — este último mantido para
// não quebrar URLs já configuradas. O token vai no path (/api/mensagem/<segredo>),
// em ?token=<segredo>, no header x-webhook-token ou em Authorization: Bearer.
app.post('/api/mensagem', express.json({ limit: '10mb' }), handleApiMensagem);
app.post('/api/mensagem/:token', express.json({ limit: '10mb' }), handleApiMensagem);
app.post('/webhook', express.json({ limit: '10mb' }), handleApiMensagem);
app.post('/webhook/:token', express.json({ limit: '10mb' }), handleApiMensagem);

app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});
// GET de validação do webhook (alguns painéis testam a URL com GET antes de
// disparar). Responde 200 tanto em /webhook quanto em /webhook/<token>, senão
// a URL com o token no caminho daria 404 e o provedor não dispararia.
const webhookPing = (req, res) => res.status(200).json({ status: 'ok' });
app.get('/webhook', webhookPing);
app.get('/webhook/:token', webhookPing);
app.get('/api/mensagem', webhookPing);
app.get('/api/mensagem/:token', webhookPing);

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
        calendarLive,
        pipeline: pipeline.diag()
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
    console.log(`🔗 API:     POST https://SEU_DOMINIO/api/mensagem/<WEBHOOK_SECRET>`);
    console.log(`❤️  Health:  https://SEU_DOMINIO/health`);
    console.log('🚀 ================================');
    console.log('');
    // A resposta ao lead sai no corpo da requisição. O CC_PUSH_URL segue
    // necessário para nota interna no ticket, resumo para a equipe e follow-up.
    if (!CC_PUSH_URL) console.warn('⚠️  CC_PUSH_URL não configurado — nota interna no ticket, resumo para a equipe e follow-up de reativação NÃO serão entregues (a resposta ao lead não depende dele).');
    if (!EQUIPE_NUMERO) console.warn('ℹ️  EQUIPE_NUMERO não configurado — resumo de lead só irá como nota interna.');
    if (!ADMIN_KEY)     console.warn('🔒 ADMIN_KEY não configurada — /leads e /diag ficarão BLOQUEADOS (503). Defina para liberar o acesso administrativo.');
    if (!WEBHOOK_SECRET) console.warn('🔓 WEBHOOK_SECRET vazio — a API está ABERTA. Antes do go-live, defina-o e aponte a URL do fluxo para /api/mensagem/<secret>.');
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
