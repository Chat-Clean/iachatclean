// =============================================================
//  CHATCLEAN — PIPELINE COMERCIAL (Oportunidades / CRM)
//  Cria uma oportunidade no funil comercial quando o lead AGENDA
//  uma reunião (etapa "REUNIÃO MARCADA").
//
//  Reaproveita a MESMA base+token do CC_PUSH_URL (endpoint externo):
//     CC_PUSH_URL = https://.../v1/api/external/{uuid}/?token=JWT
//     POST         https://.../v1/api/external/{uuid}/opportunities?token=JWT
//
//  Contrato confirmado por engenharia reversa (2026-08-05):
//    Campos: name, contactId, pipelineStepId, userId, responsibleId,
//            value, description
//    - pipelineStepId JÁ define o funil (não precisa pipelineId).
//    - A API externa NÃO tem DELETE; PUT edita (exige contactId+userId+step).
//    - Etapas: GET .../pipeline-steps (instável). REUNIÃO MARCADA = id 5.
//
//  Env (.env) — ver .env.example:
//    PIPELINE_ENABLED        = "true"/"false" (padrão: auto — liga se tiver o essencial)
//    PIPELINE_STEP_ID        = id da etapa (padrão 5 = REUNIÃO MARCADA)
//    PIPELINE_STEP_NOME      = nome da etapa (só p/ log/diag)
//    PIPELINE_USER_ID        = userId que "cria" a oportunidade (OBRIGATÓRIO)
//    PIPELINE_RESPONSIBLE_ID = userId do responsável (Roni) — padrão = PIPELINE_USER_ID
//    PIPELINE_OPP_NOME       = nome da oportunidade (padrão "REUNIÃO MARCADA")
//    PIPELINE_VALOR          = valor padrão da oportunidade (padrão 1)
// =============================================================

const axios = require('axios');

const CC_PUSH_URL     = process.env.CC_PUSH_URL || '';
const STEP_ID         = parseInt(process.env.PIPELINE_STEP_ID || '5', 10);
const STEP_NOME       = process.env.PIPELINE_STEP_NOME || 'REUNIÃO MARCADA';
const USER_ID         = parseInt(process.env.PIPELINE_USER_ID || '', 10);
const RESPONSIBLE_ID  = parseInt(process.env.PIPELINE_RESPONSIBLE_ID || process.env.PIPELINE_USER_ID || '', 10);
const OPP_NOME        = process.env.PIPELINE_OPP_NOME || 'REUNIÃO MARCADA';
const VALOR           = parseFloat(String(process.env.PIPELINE_VALOR || '1').replace(',', '.'));
const ENABLED_ENV     = process.env.PIPELINE_ENABLED; // "true" | "false" | undefined (auto)

// Deriva { base, token } da CC_PUSH_URL.
// CC_PUSH_URL = https://host/v1/api/external/{uuid}/?token=JWT
//   base  → https://host/v1/api/external/{uuid}   (sem barra final)
//   token → JWT
function derivar() {
    if (!CC_PUSH_URL) return null;
    const idx = CC_PUSH_URL.indexOf('?');
    const urlPart = idx === -1 ? CC_PUSH_URL : CC_PUSH_URL.slice(0, idx);
    const query   = idx === -1 ? ''          : CC_PUSH_URL.slice(idx + 1);
    const m = /(?:^|&)token=([^&]+)/.exec(query);
    const token = m ? m[1] : '';
    const base = urlPart.replace(/\/+$/, ''); // remove barras finais → .../external/{uuid}
    if (!base || !token) return null;
    return { base, token };
}

// Está pronto para criar oportunidades?
function configurado() {
    if (ENABLED_ENV === 'false') return false;
    const d = derivar();
    return !!(d && Number.isFinite(USER_ID) && Number.isFinite(RESPONSIBLE_ID) && Number.isFinite(STEP_ID));
}

// Cria a oportunidade no CRM. NUNCA lança — retorna o objeto criado ou null.
// A criação é best-effort: se falhar, o agendamento em si não é afetado.
async function criarOportunidade({ contactId, descricao, nome, valor } = {}) {
    if (!configurado()) {
        console.warn('⚠️ Pipeline não configurado (falta CC_PUSH_URL / PIPELINE_USER_ID / PIPELINE_RESPONSIBLE_ID) — oportunidade não criada.');
        return null;
    }
    if (!contactId) {
        console.warn('⚠️ Sem contactId no lead — não dá pra criar a oportunidade no CRM.');
        return null;
    }
    const { base, token } = derivar();
    const payload = {
        name:           nome || OPP_NOME,
        contactId:      Number(contactId),
        pipelineStepId: STEP_ID,
        userId:         USER_ID,
        responsibleId:  RESPONSIBLE_ID,
        value:          Number.isFinite(valor) ? valor : VALOR,
        description:    descricao || ''
    };
    try {
        const { data } = await axios.post(`${base}/opportunities?token=${token}`, payload, {
            headers: { 'Content-Type': 'application/json' }, timeout: 20000
        });
        const opp = data?.data || data;
        console.log(`💼 Oportunidade criada no CRM (id ${opp?.id}) — etapa "${STEP_NOME}" p/ contato ${contactId}`);
        return opp;
    } catch (e) {
        console.error('❌ Erro ao criar oportunidade no CRM:', e.response?.data || e.message);
        return null;
    }
}

// Diagnóstico da config (sem expor token) — usado pelo /diag.
function diag() {
    const d = derivar();
    return {
        configurado:      configurado(),
        pushUrlOk:        !!d,
        stepId:           STEP_ID,
        stepNome:         STEP_NOME,
        userIdSet:        Number.isFinite(USER_ID),
        responsibleIdSet: Number.isFinite(RESPONSIBLE_ID),
        oppNome:          OPP_NOME,
        valor:            VALOR,
        enabled:          ENABLED_ENV || '(auto)'
    };
}

module.exports = { configurado, criarOportunidade, diag };
