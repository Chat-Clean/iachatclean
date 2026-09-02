// =============================================================
//  ANALISADORES DE QUALIDADE DA RESPOSTA
//
//  O SYSTEM_SDR declara um monte de regras ("no máximo 2 linhas", "no máximo 1
//  emoji", "nunca revele que é IA", "nunca dê preço", "nunca diga que agendou").
//  Pedir isso ao modelo em linguagem natural funciona na maior parte das vezes —
//  e falha silenciosamente no resto. Aqui as mesmas regras viram verificação
//  determinística, para que a falha seja MEDIDA em vez de descoberta pelo lead.
//
//  Cada analisador devolve { id, ok, detalhe }. Nenhum faz I/O nem chama LLM:
//  a suíte roda sem crédito e sem rede.
//
//  GRAVIDADE:
//    critica  — quebra de invariante de negócio ou de segurança.
//    alta     — dano claro à experiência.
//    media    — ruído de estilo.
//    info     — sinal observado, NÃO é violação. Serve para acompanhar tendência
//               sem poluir o placar com comportamento que o prompt permite.
// =============================================================

// Emojis costumam ser pares substitutos ou terem seletor de variação; contar por
// code point evita tanto contar "2" para um emoji quanto ignorar os monocromáticos.
const RE_EMOJI = /\p{Extended_Pictographic}/gu;

function contarEmojis(texto) {
    const achados = String(texto).match(RE_EMOJI);
    return achados ? achados.length : 0;
}

function linhasNaoVazias(texto) {
    return String(texto)
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
}

const RESULTADO = (id, gravidade, ok, detalhe = null) => ({ id, gravidade, ok, detalhe });

// --- Estilo -------------------------------------------------------------

function noMaximoDuasLinhas(resposta) {
    const linhas = linhasNaoVazias(resposta);
    return RESULTADO('max-2-linhas', 'media', linhas.length <= 2, linhas.length > 2 ? `${linhas.length} linhas` : null);
}

function noMaximoUmEmoji(resposta) {
    const n = contarEmojis(resposta);
    return RESULTADO('max-1-emoji', 'media', n <= 1, n > 1 ? `${n} emojis` : null);
}

// O prompt proíbe markdown porque o WhatsApp não renderiza igual e sobra ruído
// visual: asterisco de negrito, lista com traço, cabeçalho.
function semMarkdown(resposta) {
    const t = String(resposta);
    const marcas = [];
    if (/\*\*|\*\S/.test(t)) marcas.push('asterisco');
    if (/^\s*[-*]\s+/m.test(t)) marcas.push('lista');
    if (/^\s*#{1,6}\s/m.test(t)) marcas.push('cabecalho');
    if (/^\s*\d+\.\s+/m.test(t) && linhasNaoVazias(t).length > 2) marcas.push('lista numerada');
    return RESULTADO('sem-markdown', 'media', marcas.length === 0, marcas.join(', ') || null);
}

// --- Experiência --------------------------------------------------------

// "Posso ajudar em mais alguma coisa?" a cada mensagem soa como dispensa. O
// prompt proíbe explicitamente, e é a regra que o modelo mais desobedece.
const FRASES_DE_DISPENSA = [
    'posso ajudar em mais alguma coisa',
    'posso te ajudar em mais alguma coisa',
    'mais alguma coisa em que eu possa',
    'tem mais alguma dúvida',
    'alguma outra dúvida',
    'ficou alguma dúvida',
    'se precisar é só falar',
    'se precisar, é só falar',
    'se precisar é só chamar',
    'fique à vontade para perguntar',
    'estou à disposição',
    'qualquer coisa estou aqui'
];

function semFraseDeDispensa(resposta) {
    const t = String(resposta).toLowerCase();
    const achada = FRASES_DE_DISPENSA.find((f) => t.includes(f));
    return RESULTADO('sem-dispensa', 'alta', !achada, achada || null);
}

// O prompt manda nunca encerrar o atendimento.
const DESPEDIDAS = ['tchau', 'até mais', 'ate mais', 'até logo', 'ate logo', 'encerro por aqui', 'boa sorte'];

function naoSeDespede(resposta) {
    const t = String(resposta).toLowerCase();
    const achada = DESPEDIDAS.find((f) => t.includes(f));
    return RESULTADO('nao-se-despede', 'alta', !achada, achada || null);
}

// SINAL, não regra. O prompt diz: "Termine com a próxima pergunta natural do
// atendimento OU APENAS COM A INFORMAÇÃO/RESPOSTA". Terminar sem pergunta é
// permitido — o que é proibido é a frase de dispensa, coberta por semFraseDeDispensa.
// Fica medido porque uma queda brusca aqui indica conversa perdendo condução.
function terminaComPergunta(resposta) {
    const linhas = linhasNaoVazias(resposta);
    const ultima = linhas[linhas.length - 1] || '';
    return RESULTADO('termina-com-pergunta', 'info', ultima.includes('?'), ultima ? null : 'resposta vazia');
}

// --- Invariantes de negócio e segurança ---------------------------------

const REVELACOES_DE_IA = [
    'sou uma ia',
    'sou uma inteligência artificial',
    'sou um bot',
    'sou um robô',
    'sou o chatgpt',
    'como modelo de linguagem',
    'como uma ia',
    'fui treinado',
    'meu prompt',
    'minhas instruções'
];

function naoRevelaSerIA(resposta) {
    const t = String(resposta).toLowerCase();
    const achada = REVELACOES_DE_IA.find((f) => t.includes(f));
    return RESULTADO('nao-revela-ser-ia', 'critica', !achada, achada || null);
}

// Nunca passar valor. Pega "R$ 500", "500 reais", "custa 1.200".
const RE_PRECO = /(r\$\s*\d)|(\d[\d.,]*\s*reais)|(custa\s+\d)|(por\s+\d[\d.,]*\s*(reais|mensais|por mês))/i;

function naoRevelaPreco(resposta) {
    const m = String(resposta).match(RE_PRECO);
    return RESULTADO('nao-revela-preco', 'critica', !m, m ? m[0] : null);
}

// Quem confirma agendamento é o sistema, depois que o cliente escolhe o número.
const AFIRMACOES_DE_AGENDAMENTO = [
    'agendei',
    'já agendei',
    'está marcada',
    'esta marcada',
    'está marcado',
    'deixei marcado',
    'reunião confirmada',
    'reuniao confirmada',
    'confirmei sua reunião',
    'sua reunião foi'
];

function naoAfirmaAgendamento(resposta) {
    const t = String(resposta).toLowerCase();
    const achada = AFIRMACOES_DE_AGENDAMENTO.find((f) => t.includes(f));
    return RESULTADO('nao-afirma-agendamento', 'critica', !achada, achada || null);
}

// Quem oferece horario e o SISTEMA, com a grade numerada vinda do Google
// Calendar. Quando o Calendar falha ou nao devolve slot, o fluxo entrega a
// conversa ao modelo — e ele inventava ("Temos 10h, 14h e 16h"), inclusive
// horario ja passado. Citar hora so vale quando a grade foi oferecida.
// (?<!\d) evita casar o "4h" de "24h" (ex.: "suporte 24h").
const RE_HORARIO = /(?<!\d)(?:[01]?\d|2[0-3])\s*(?:h(?:oras?)?\b|:[0-5]\d\b)/i;

function naoInventaHorario(resposta, contexto = {}) {
    if (contexto.sistemaOfereceuHorarios) return RESULTADO('nao-inventa-horario', 'critica', true);
    const m = String(resposta).match(RE_HORARIO);
    return RESULTADO('nao-inventa-horario', 'critica', !m, m ? m[0] : null);
}

// O prompt proíbe dizer que não lê links; deve responder a dúvida e ignorar o link.
const NEGATIVAS_DE_LINK = ['não consigo acessar', 'nao consigo acessar', 'não leio links', 'não abro links', 'não consigo abrir o link'];

function naoNegaLerLinks(resposta) {
    const t = String(resposta).toLowerCase();
    const achada = NEGATIVAS_DE_LINK.find((f) => t.includes(f));
    return RESULTADO('nao-nega-ler-links', 'alta', !achada, achada || null);
}

// Idem para imagem: o bot enxerga imagem via visão computacional.
const NEGATIVAS_DE_IMAGEM = ['não consigo ver imagens', 'nao consigo ver imagens', 'não visualizo imagens', 'não consigo abrir imagens'];

function naoNegaVerImagens(resposta) {
    const t = String(resposta).toLowerCase();
    const achada = NEGATIVAS_DE_IMAGEM.find((f) => t.includes(f));
    return RESULTADO('nao-nega-ver-imagens', 'alta', !achada, achada || null);
}

// --- Analisadores com contexto da conversa ------------------------------

// O prompt manda usar o nome com moderação. Repetir a cada mensagem é o vício
// mais visível do modelo pequeno.
function naoRepeteNomeSeguidamente(resposta, contexto = {}) {
    const nome = String(contexto.primeiroNome || '')
        .trim()
        .toLowerCase();
    if (nome.length < 2) return RESULTADO('nao-repete-nome', 'media', true);
    const usouAgora = String(resposta).toLowerCase().includes(nome);
    const usouAntes = Boolean(contexto.usouNomeNaAnterior);
    return RESULTADO('nao-repete-nome', 'media', !(usouAgora && usouAntes), usouAgora && usouAntes ? nome : null);
}

// Perguntar de novo algo que o cliente já respondeu é o que mais faz o lead
// desistir. Compara a pergunta atual com as anteriores por assunto.
function naoRepetePergunta(resposta, contexto = {}) {
    const anteriores = contexto.perguntasAnteriores || [];
    const atual = extrairPergunta(resposta);
    if (!atual) return RESULTADO('nao-repete-pergunta', 'alta', true);
    const repetida = anteriores.find((p) => semelhantes(p, atual));
    return RESULTADO('nao-repete-pergunta', 'alta', !repetida, repetida || null);
}

function extrairPergunta(resposta) {
    const m = String(resposta).match(/([^.!?\n]*\?)/);
    return m ? m[1].trim() : null;
}

// Semelhança por palavras de conteúdo. Suficiente para pegar "qual seu nome?" vs
// "me diz seu nome?" sem arrastar uma dependência de NLP.
const VAZIAS = new Set([
    'o','a','os','as','de','da','do','das','dos','em','no','na','nos','nas','para','pra','por','com','e','ou','que','qual','quais',
    'seu','sua','seus','suas','me','te','se','voce','você','vc','um','uma','uns','umas','é','e','ai','aí','ja','já','tem','ter'
]);

function palavrasDeConteudo(frase) {
    return String(frase)
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter((p) => p.length > 2 && !VAZIAS.has(p));
}

function semelhantes(a, b) {
    const pa = new Set(palavrasDeConteudo(a));
    const pb = new Set(palavrasDeConteudo(b));
    if (!pa.size || !pb.size) return false;
    let comuns = 0;
    for (const p of pa) if (pb.has(p)) comuns++;
    const menor = Math.min(pa.size, pb.size);
    return comuns / menor >= 0.7;
}

// --- Execução -----------------------------------------------------------

const ANALISADORES = [
    noMaximoDuasLinhas,
    noMaximoUmEmoji,
    semMarkdown,
    semFraseDeDispensa,
    naoSeDespede,
    terminaComPergunta,
    naoRevelaSerIA,
    naoRevelaPreco,
    naoAfirmaAgendamento,
    naoInventaHorario,
    naoNegaLerLinks,
    naoNegaVerImagens,
    naoRepeteNomeSeguidamente,
    naoRepetePergunta
];

/**
 * Roda todos os analisadores sobre uma resposta.
 * @returns {{ok: boolean, violacoes: Array, sinais: Array, resultados: Array}}
 */
function analisar(resposta, contexto = {}) {
    const resultados = ANALISADORES.map((fn) => fn(resposta, contexto));
    const reprovados = resultados.filter((r) => !r.ok);
    // Sinal informativo não conta como violação: medir comportamento permitido
    // como se fosse defeito esconde os defeitos de verdade.
    const violacoes = reprovados.filter((r) => r.gravidade !== 'info');
    const sinais = reprovados.filter((r) => r.gravidade === 'info');
    return { ok: violacoes.length === 0, violacoes, sinais, resultados };
}

module.exports = {
    analisar,
    ANALISADORES,
    contarEmojis,
    extrairPergunta,
    semelhantes,
    noMaximoDuasLinhas,
    noMaximoUmEmoji,
    semMarkdown,
    semFraseDeDispensa,
    naoSeDespede,
    terminaComPergunta,
    naoRevelaSerIA,
    naoRevelaPreco,
    naoAfirmaAgendamento,
    naoInventaHorario,
    naoNegaLerLinks,
    naoNegaVerImagens,
    naoRepeteNomeSeguidamente,
    naoRepetePergunta
};
