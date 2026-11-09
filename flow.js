// =============================================================
//  FLOW — lógica PURA do fluxo de qualificação do SDR.
//  Compartilhada entre o servidor (index.js) e o tester local
//  (test-chat.js) para não haver drift. Sem I/O, sem OpenAI.
// =============================================================

// Ordem oficial do fluxo (spec 0003): tres perguntas, nesta ordem. Empresa,
// quem decide e quando quer comecar. Nome, segmento e dor deixaram de ser
// perguntados a pedido do negocio; seguem capturados quando o lead fala.
const CAMPOS = ['empresa', 'decisor', 'urgencia'];

// Nunca PERGUNTADOS, mas capturados quando o cliente fala por conta propria:
// alimentam o gancho de case, a nota da equipe e o nome usado na conversa.
const CAMPOS_SO_CAPTURA = ['nome', 'segmento', 'dor', 'duvidaPrincipal', 'objetivo', 'cidadeEstado', 'canais', 'volume'];

const CAMPOS_APLICAVEIS = [...CAMPOS, ...CAMPOS_SO_CAPTURA];

const PERGUNTAS = {
    empresa:  'Pergunte o nome da empresa dele. Se ele já disse que trabalha por conta própria, isso responde.',
    decisor:  'Pergunte quem decide isso com ele (se decide sozinho ou com mais alguém).',
    urgencia: 'Pergunte quando ele quer começar.'
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

// Intencao de reuniao NESTA mensagem: pedido explicito ou interesse em avancar.
// A extracao marca "quero marcar com um especialista" como querFalarComHumano E
// querAgendar; e isto que separa esse caso de "quero falar com uma pessoa".
function pediuReuniaoAgora(extraido) {
    return Boolean(extraido && (extraido.querAgendar || extraido.demonstrouInteresse));
}

// Quando oferecer a agenda do time. Antes so havia dois gatilhos, fim da
// qualificacao ou pedido explicito: o lead que dizia "gostei, quero contratar"
// seguia no questionario. O interesse fica guardado no lead. Recusou a
// reuniao: so um pedido explicito volta a oferecer.
// Preco, teste, app ou integracao que so o especialista responde com certeza
// (spec 0003, CA-010 e CA-011): a resposta e "o especialista mostra na reuniao",
// e a reuniao e oferecida em seguida.
function pedeEspecialista(extraido) {
    return Boolean(extraido && (extraido.duvidaParaEspecialista || extraido.objecao === 'preco'));
}

function deveOferecerReuniao(leadData, extraido) {
    if (leadData.reuniaoAgendada || leadData.aguardandoEscolhaSlot) return false;
    if (extraido && extraido.querAgendar) return true;
    if (leadData.qualificacaoCompleta) return true;
    if (leadData.recusouReuniao) return false;
    return Boolean(leadData.demonstrouInteresse || pedeEspecialista(extraido));
}

// O lead perguntou algo junto ("tenho interesse, quanto custa?"): a duvida e
// respondida primeiro e a agenda vai logo depois, no mesmo turno. So o pedido
// explicito de reuniao recebe a agenda direto, sem resposta antes.
function ofertaDepoisDaResposta(leadData, extraido) {
    if (!deveOferecerReuniao(leadData, extraido)) return false;
    if (extraido && extraido.querAgendar) return false;
    return Boolean(extraido && (extraido.perguntou || pedeEspecialista(extraido)));
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
    pedeEspecialista,
    pediuReuniaoAgora,
    deveOferecerReuniao,
    ofertaDepoisDaResposta
};
