// =============================================================
//  FLOW — lógica PURA do fluxo de qualificação do SDR.
//  Compartilhada entre o servidor (index.js) e o tester local
//  (test-chat.js) para não haver drift. Sem I/O, sem OpenAI.
// =============================================================

// Ordem oficial do fluxo (objetivo antes do nome, como o prompt-mestre)
const CAMPOS = ['objetivo', 'nome', 'empresa', 'segmento', 'cidadeEstado', 'canais', 'volume', 'dor', 'urgencia', 'decisor'];

// State machine: retorna o próximo campo a coletar (com a instrução p/ o modelo)
// ou null quando a qualificação está completa (marca leadData.qualificacaoCompleta).
function determinarProximoCampo(leadData) {
    if (!leadData.objetivo)     return { campo: 'objetivo',     pergunta: 'Pergunte, em uma frase, o que ele quer melhorar hoje: atendimento, organização ou vendas (passo 2).' };
    if (!leadData.nome)         return { campo: 'nome',         pergunta: 'Pergunte o nome dele (passo 3).' };
    if (!leadData.empresa)      return { campo: 'empresa',      pergunta: 'Pergunte o nome da empresa dele.' };
    if (!leadData.segmento)     return { campo: 'segmento',     pergunta: 'Pergunte em qual ramo/segmento a empresa atua.' };
    if (!leadData.cidadeEstado) return { campo: 'cidadeEstado', pergunta: 'Pergunte de qual cidade e estado ele fala.' };
    if (!leadData.canais)       return { campo: 'canais',       pergunta: 'Pergunte quais canais ele usa hoje para atender (WhatsApp, Instagram, site, Telegram...).' };
    if (!leadData.volume)       return { campo: 'volume',       pergunta: 'Pergunte mais ou menos quantos atendimentos ele recebe por dia ou por mês.' };
    if (!leadData.dor)          return { campo: 'dor',          pergunta: 'Pergunte qual o maior desafio/dor que ele sente hoje no atendimento ou nas vendas.' };
    if (!leadData.urgencia)     return { campo: 'urgencia',     pergunta: 'Pergunte se ele quer resolver isso agora ou está se planejando para os próximos dias.' };
    if (!leadData.decisor)      return { campo: 'decisor',      pergunta: 'Pergunte se ele decide sozinho ou tem mais alguém nesse processo.' };
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

module.exports = { CAMPOS, determinarProximoCampo, aplicarCampos, detectarSegmento, escolhaDeSlot };
