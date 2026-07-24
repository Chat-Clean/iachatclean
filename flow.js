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

// Aplica os campos extraídos ao leadData (não sobrescreve o que já foi coletado).
function aplicarCampos(leadData, extraido) {
    if (!extraido) return;
    for (const c of CAMPOS) {
        if (extraido[c] !== null && extraido[c] !== undefined && extraido[c] !== '' && !leadData[c]) {
            leadData[c] = extraido[c];
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

module.exports = { CAMPOS, determinarProximoCampo, aplicarCampos, detectarSegmento };
