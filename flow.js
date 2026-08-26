// =============================================================
//  FLOW — lógica PURA do fluxo de qualificação do SDR.
//  Compartilhada entre o servidor (index.js) e o tester local
//  (test-chat.js) para não haver drift. Sem I/O, sem OpenAI.
// =============================================================

// Ordem oficial do fluxo (objetivo antes do nome, como o prompt-mestre)
const CAMPOS = ['objetivo', 'nome', 'empresa', 'segmento', 'cidadeEstado', 'canais', 'volume', 'dor', 'urgencia', 'decisor'];

const PERGUNTAS = {
    objetivo:     'Pergunte, em uma frase, o que ele quer melhorar hoje: atendimento, organização ou vendas (passo 2).',
    nome:         'Pergunte o nome dele (passo 3).',
    empresa:      'Pergunte o nome da empresa dele.',
    segmento:     'Pergunte em qual ramo/segmento a empresa atua.',
    cidadeEstado: 'Pergunte de qual cidade e estado ele fala.',
    canais:       'Pergunte quais canais ele usa hoje para atender (WhatsApp, Instagram, site, Telegram...).',
    volume:       'Pergunte mais ou menos quantos atendimentos ele recebe por dia ou por mês.',
    dor:          'Pergunte qual o maior desafio/dor que ele sente hoje no atendimento ou nas vendas.',
    urgencia:     'Pergunte se ele quer resolver isso agora ou está se planejando para os próximos dias.',
    decisor:      'Pergunte se ele decide sozinho ou tem mais alguém nesse processo.'
};

// Quantas vezes o bot insiste num campo antes de desistir dele.
// Antes disto o funil TRAVAVA: o lead que se recusasse a informar a empresa
// deixava o campo null para sempre, `qualificacaoCompleta` nunca virava true e
// o passo 7 (encaminhar ao especialista) NUNCA disparava. O lead respondia
// tudo o mais e mesmo assim não era passado ao comercial.
const MAX_TENTATIVAS = 2;

// Registra que o bot vai perguntar este campo AGORA. Precisa ser chamado uma
// única vez por turno — por isso é separado de determinarProximoCampo, que é
// consultado mais de uma vez no mesmo turno e não pode contar duas vezes.
function registrarTentativa(leadData, campo) {
    if (!campo) return;
    leadData.tentativas = leadData.tentativas || {};
    leadData.tentativas[campo] = (leadData.tentativas[campo] || 0) + 1;
}

// true se já insistimos o suficiente e o campo deve ser dado como recusado.
function campoDesistido(leadData, campo, max = MAX_TENTATIVAS) {
    const n = (leadData.tentativas && leadData.tentativas[campo]) || 0;
    return n >= max;
}

// Campos que ficaram sem resposta depois de insistir. Vão para o resumo da
// equipe como "não informado", em vez de sumirem em silêncio.
function camposDesistidos(leadData, max = MAX_TENTATIVAS) {
    return CAMPOS.filter((c) => !leadData[c] && campoDesistido(leadData, c, max));
}

// State machine: retorna o próximo campo a coletar (com a instrução p/ o modelo)
// ou null quando a qualificação está completa (marca leadData.qualificacaoCompleta).
// Um campo já insistido MAX_TENTATIVAS vezes é pulado — o funil segue em frente.
function determinarProximoCampo(leadData, opcoes = {}) {
    const max = opcoes.maxTentativas || MAX_TENTATIVAS;
    for (const campo of CAMPOS) {
        if (leadData[campo]) continue;
        if (campoDesistido(leadData, campo, max)) continue;
        return { campo, pergunta: PERGUNTAS[campo] };
    }
    leadData.qualificacaoCompleta = true;
    return null;
}

// Aplica os campos extraídos ao leadData. Por padrão NÃO sobrescreve o que já
// foi coletado — exceto os campos que o cliente está CORRIGINDO explicitamente
// (extraido.correcao = lista de campos, ex.: "na verdade a empresa é X").
function aplicarCampos(leadData, extraido) {
    if (!extraido) return;
    const correcoes = Array.isArray(extraido.correcao) ? extraido.correcao : [];
    for (const c of CAMPOS) {
        const v = extraido[c];
        if (v === null || v === undefined || v === '') continue;
        if (!leadData[c] || correcoes.includes(c)) {
            leadData[c] = v;
        }
    }
}

// Detecta a chave de segmento (para o gancho de case) por palavras-chave.
const SEGMENTO_KEYWORDS = {
    energia_solar: ['solar', 'energia solar', 'fotovoltaic', 'painel solar', 'placa solar'],
    saude:         ['clinic', 'clínica', 'consultório', 'consultorio', 'dentist', 'odonto', 'médic', 'medic', 'saúde', 'saude', 'estética', 'estetica', 'hospital'],
    varejo:        ['loja', 'varejo', 'e-commerce', 'ecommerce', 'comércio', 'comercio', 'supermercado', 'store', 'roupa', 'moda'],
    automotivo:    ['moto', 'carro', 'veícul', 'veicul', 'concessionária', 'concessionaria', 'automotiv', 'oficina'],
    alimentacao:   ['bolo', 'confeitaria', 'restaurante', 'lanchonete', 'pizzaria', 'delivery', 'food', 'comida', 'padaria'],
    servicos:      ['cartório', 'cartorio', 'seguro', 'corretora', 'bpo', 'contabilidade', 'advocacia', 'escritório', 'escritorio', 'consultoria']
};
function detectarSegmento(texto) {
    if (!texto) return null;
    const t = texto.toLowerCase();
    for (const [key, kws] of Object.entries(SEGMENTO_KEYWORDS)) {
        if (kws.some(kw => t.includes(kw))) return key;
    }
    return null;
}

// Interpreta qual horário o cliente escolheu de uma lista NUMERADA de reuniões.
// Usa o que a IA extraiu (slotEscolhido) e, como reforço, lê o texto cru — dígito
// isolado ("1", "opção 2") ou ordinal por extenso ("o primeiro", "a segunda").
// Sem esse reforço, dependia só do LLM devolver slotEscolhido e um "1" às vezes
// escapava. Retorna o número (1..nSlots) ou null.
function escolhaDeSlot(texto, extraido, nSlots) {
    const n = Number(extraido?.slotEscolhido);
    if (Number.isInteger(n) && n >= 1 && n <= nSlots) return n;
    const t = String(texto || '').toLowerCase();
    const mDig = t.match(/\b([1-9])\b/);
    if (mDig) { const d = Number(mDig[1]); if (d >= 1 && d <= nSlots) return d; }
    const ordinais = [['primeir', 1], ['segund', 2], ['terceir', 3], ['quart', 4], ['quint', 5]];
    for (const [k, v] of ordinais) if (t.includes(k) && v <= nSlots) return v;
    return null;
}

module.exports = {
    CAMPOS,
    PERGUNTAS,
    MAX_TENTATIVAS,
    determinarProximoCampo,
    registrarTentativa,
    campoDesistido,
    camposDesistidos,
    aplicarCampos,
    detectarSegmento,
    escolhaDeSlot
};
