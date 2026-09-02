// =============================================================
//  FLOW — lógica PURA do fluxo de qualificação do SDR.
//  Compartilhada entre o servidor (index.js) e o tester local
//  (test-chat.js) para não haver drift. Sem I/O, sem OpenAI.
// =============================================================

// Ordem oficial do fluxo. A triagem foi ENCURTADA a pedido do negocio: nome,
// depois a dor em uma pergunta aberta, e so o que qualifica comercialmente
// (urgencia e decisor). Perguntar nome da empresa, segmento, cidade, canais e
// volume alongava a triagem sem ajudar o especialista, que levanta isso na
// reuniao.
const CAMPOS = ['nome', 'dor', 'urgencia', 'decisor'];

// Nunca PERGUNTADOS, mas capturados quando o cliente fala por conta propria:
// alimentam o CRM (nome da oportunidade), o gancho de case e o resumo da equipe.
const CAMPOS_SO_CAPTURA = ['objetivo', 'empresa', 'segmento', 'cidadeEstado', 'canais', 'volume'];

const CAMPOS_APLICAVEIS = [...CAMPOS, ...CAMPOS_SO_CAPTURA];

const PERGUNTAS = {
    nome:         'Pergunte o nome dele.',
    dor:          'Faça exatamente esta pergunta, com suas palavras mas sem perder nada: me fala um pouco no que está acontecendo na sua empresa; em poucas palavras, quais são as maiores dores ou demandas que você tem em relação a ferramentas de tecnologia e ferramentas de gestão empresarial.',
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
    for (const c of CAMPOS_APLICAVEIS) {
        const v = extraido[c];
        if (v === null || v === undefined || v === '') continue;
        if (!leadData[c] || correcoes.includes(c)) {
            leadData[c] = v;
        }
    }
    // O nome da empresa costuma entregar o ramo sozinho. Preencher aqui evita
    // que determinarProximoCampo pergunte o obvio logo depois.
    if (leadData.empresa && !leadData.segmento) {
        const inferido = inferirSegmentoDaEmpresa(leadData.empresa);
        if (inferido) leadData.segmento = inferido;
    }
}

// Palavras que, sozinhas no NOME DA EMPRESA, ja entregam o ramo. Lista propria e
// mais restrita que SEGMENTO_KEYWORDS: aqui o casamento e por palavra INTEIRA,
// para "Motorola" nao virar automotivo por causa de "moto".
const SEGMENTO_POR_NOME = {
    energia_solar: ['solar', 'fotovoltaica', 'fotovoltaico', 'energia solar'],
    saude:         ['clinica', 'clínica', 'consultorio', 'consultório', 'odontologia', 'odontologica', 'odontológica', 'dentista', 'laboratorio', 'laboratório', 'hospital', 'farmacia', 'farmácia', 'estetica', 'estética', 'fisioterapia', 'psicologia', 'veterinaria', 'veterinária'],
    varejo:        ['loja', 'lojas', 'supermercado', 'mercadinho', 'boutique', 'papelaria', 'livraria', 'otica', 'ótica', 'joalheria', 'floricultura', 'magazine', 'distribuidora'],
    automotivo:    ['concessionaria', 'concessionária', 'oficina', 'autopecas', 'autopeças', 'auto pecas', 'auto peças', 'funilaria', 'lava jato', 'motopecas', 'motopeças'],
    alimentacao:   ['pizzaria', 'restaurante', 'lanchonete', 'padaria', 'confeitaria', 'hamburgueria', 'churrascaria', 'cafeteria', 'sorveteria', 'doceria', 'pastelaria', 'marmitaria', 'acai', 'açai', 'açaí'],
    servicos:      ['cartorio', 'cartório', 'contabilidade', 'advocacia', 'advogados', 'corretora', 'seguros', 'imobiliaria', 'imobiliária', 'consultoria', 'despachante', 'barbearia', 'salao', 'salão', 'academia', 'grafica', 'gráfica', 'transportadora', 'construtora']
};

// Rotulo legivel gravado no campo `segmento` quando ele foi deduzido do nome.
const SEGMENTO_ROTULOS = {
    energia_solar: 'energia solar',
    saude:         'saúde',
    varejo:        'varejo',
    automotivo:    'automotivo',
    alimentacao:   'alimentação',
    servicos:      'serviços'
};

// "Pizzaria 3 Irmaos" ja diz o ramo. Perguntar o segmento depois disso soa
// desatento e irrita o cliente — era a queixa que originou esta funcao.
// Casa por palavra INTEIRA (ou expressao exata, quando o termo tem espaco).
function inferirSegmentoDaEmpresa(empresa) {
    if (!empresa) return null;
    const t = String(empresa).toLowerCase();
    const palavras = t.split(/[^0-9a-zà-ÿ]+/).filter(Boolean);
    for (const [key, termos] of Object.entries(SEGMENTO_POR_NOME)) {
        for (const termo of termos) {
            const casou = termo.includes(' ') ? t.includes(termo) : palavras.includes(termo);
            if (casou) return SEGMENTO_ROTULOS[key];
        }
    }
    return null;
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
    CAMPOS_SO_CAPTURA,
    CAMPOS_APLICAVEIS,
    PERGUNTAS,
    MAX_TENTATIVAS,
    determinarProximoCampo,
    registrarTentativa,
    campoDesistido,
    camposDesistidos,
    aplicarCampos,
    detectarSegmento,
    inferirSegmentoDaEmpresa,
    escolhaDeSlot
};
