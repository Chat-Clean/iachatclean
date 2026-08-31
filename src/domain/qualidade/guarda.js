// =============================================================
//  GUARDA DE RESPOSTA
//
//  O SYSTEM_SDR já proíbe revelar preço, dizer que é IA, afirmar agendamento e
//  negar que lê link ou imagem. Medido com o eval, o modelo desobedece mesmo
//  assim: inventou faixas de preço ("entre R$ 200 a R$ 1.000") em 2 de 6 turnos
//  do roteiro de pressão de preço.
//
//  Instrução em linguagem natural é probabilística. Invariante de negócio não
//  pode ser. Esta guarda fecha o buraco em duas etapas:
//
//    1. Detectou violação crítica -> devolve uma INSTRUÇÃO DE CORREÇÃO para
//       regerar a resposta uma vez. O texto continua natural.
//    2. Se a segunda tentativa também violar -> devolve uma RESPOSTA SEGURA
//       pronta, que não é ideal mas nunca quebra a regra.
//
//  Módulo puro: sem I/O, sem LLM. Quem regera é o chamador.
// =============================================================

const { analisar } = require('./analisadores');

// Só o que causa dano real de negócio entra aqui. Estilo (emoji, linhas) não
// justifica uma segunda chamada ao modelo.
const CRITICAS = new Set(['nao-revela-preco', 'nao-revela-ser-ia', 'nao-afirma-agendamento']);
const ALTAS_CORRIGIVEIS = new Set(['nao-nega-ler-links', 'nao-nega-ver-imagens', 'sem-dispensa', 'nao-repete-pergunta']);

const INSTRUCOES = {
    'nao-revela-preco':
        'Você citou um valor. NUNCA cite número, faixa, "a partir de", "em média" ou qualquer quantia. ' +
        'Diga que o investimento varia conforme o número de usuários e a complexidade da empresa, e que um especialista passa a proposta.',
    'nao-revela-ser-ia':
        'Você deu a entender que é uma IA ou revelou bastidores. Nunca faça isso. ' +
        'Se perguntarem, responda que a plataforma utiliza inteligência artificial para apoiar o time no atendimento.',
    'nao-afirma-agendamento':
        'Você afirmou que a reunião está marcada. Quem confirma é o sistema, depois que o cliente escolhe um horário pelo número. ' +
        'Reescreva pedindo que ele escolha pelo número.',
    'nao-nega-ler-links':
        'Você disse que não consegue acessar o link. Nunca diga isso: ignore o link e responda apenas à dúvida do cliente.',
    'nao-nega-ver-imagens':
        'Você disse que não consegue ver imagens. Nunca diga isso: comente o que viu e siga ajudando.',
    'sem-dispensa':
        'Você terminou com uma frase de dispensa ("posso ajudar em mais alguma coisa?" e afins). ' +
        'Termine com a próxima pergunta natural do atendimento.',
    'nao-repete-pergunta':
        'Você repetiu uma pergunta que já fez nesta conversa. O cliente percebe e desiste. ' +
        'Se ele não respondeu, siga em frente com outro assunto em vez de insistir na mesma pergunta.'
};

const RESPOSTAS_SEGURAS = {
    'nao-revela-preco':
        'O investimento varia conforme o número de usuários e a complexidade da sua operação. ' +
        'Posso pedir para um especialista montar uma proposta sob medida pra você?',
    'nao-revela-ser-ia':
        'Nossa plataforma utiliza inteligência artificial para apoiar o time no atendimento. ' +
        'Me conta: o que você quer melhorar hoje no seu atendimento?',
    'nao-afirma-agendamento':
        'Para eu seguir certinho, me diz o número do horário que ficou melhor pra você?'
};

/**
 * Avalia a resposta gerada e diz o que fazer com ela.
 *
 * @param {string} resposta
 * @param {object} [contexto] Mesmo contexto dos analisadores.
 * @param {object} [opcoes]
 * @param {boolean} [opcoes.incluirAltas=true] Também tentar corrigir violações altas.
 * @returns {{ok: boolean, violacoes: Array, corrigiveis: Array, instrucaoDeCorrecao: string|null, respostaSegura: string|null}}
 *          O formato e o MESMO nos dois caminhos: quem chama nunca precisa checar se o campo existe.
 */
function avaliar(resposta, contexto = {}, opcoes = {}) {
    const incluirAltas = opcoes.incluirAltas !== false;
    const { violacoes } = analisar(resposta, contexto);

    const corrigiveis = violacoes.filter(
        (v) => CRITICAS.has(v.id) || (incluirAltas && ALTAS_CORRIGIVEIS.has(v.id))
    );

    if (!corrigiveis.length) {
        return { ok: true, violacoes, corrigiveis: [], instrucaoDeCorrecao: null, respostaSegura: null };
    }

    const instrucaoDeCorrecao =
        'A resposta que você acabou de escrever quebrou uma regra. Reescreva a MESMA mensagem corrigindo:\n' +
        corrigiveis.map((v) => '- ' + (INSTRUCOES[v.id] || v.id)).join('\n') +
        '\nMantenha o tom, o assunto e o tamanho (máx. 2 linhas). Responda só com a mensagem corrigida.';

    // A resposta segura cobre a violação mais grave que tenha uma.
    const comSegura = corrigiveis.find((v) => RESPOSTAS_SEGURAS[v.id]);

    return {
        ok: false,
        violacoes,
        corrigiveis,
        instrucaoDeCorrecao,
        respostaSegura: comSegura ? RESPOSTAS_SEGURAS[comSegura.id] : null
    };
}

module.exports = { avaliar, CRITICAS, ALTAS_CORRIGIVEIS, INSTRUCOES, RESPOSTAS_SEGURAS };
