// =============================================================
//  OPENAI — CHAMADA COMPATIVEL ENTRE GERACOES DE MODELO, COM PRAZO
//
//  Os modelos antigos (gpt-4o, gpt-4.1) aceitam `temperature` e recusam
//  `reasoning_effort`. Os de raciocinio (gpt-5, gpt-6-luna) fazem o contrario.
//  Trocar o modelo por variavel de ambiente nao pode derrubar o atendimento por
//  causa de um parametro, entao a recusa e aprendida: na primeira vez o
//  parametro sai e a chamada e refeita; dali em diante ele nem e enviado para
//  aquele modelo.
//
//  Raciocinio alto melhora a resposta, mas a API e sincrona: o lead espera.
//  completarNoPrazo() usa o esforco pedido enquanto cabe no prazo e, se
//  estourar, refaz com um esforco rapido. O lead nunca fica sem resposta
//  por causa do raciocinio.
//
//  O cliente entra por parametro: quem le o ambiente e o chamador.
// =============================================================

// Parametros que um modelo pode recusar sem que a chamada perca o sentido.
const OPCIONAIS = ['temperature', 'reasoning_effort'];
const TEMPO_ESGOTADO = /timed out/i;
// Do menor para o maior esforco, para achar o substituto mais proximo.
const ESFORCOS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

// Um modelo pode aceitar o parametro e recusar so o VALOR. O gpt-6-luna, por
// exemplo, recusa "max" na Chat Completions e lista "none ... xhigh". Nesse caso
// o esforco vira o maior suportado que nao passa do pedido.
function esforcoSubstituto(pedido, msg) {
    const lista = /Supported values are: (.+)/.exec(msg);
    if (!/Unsupported value/i.test(msg) || !lista) return null;
    const suportados = ESFORCOS.filter((v) => lista[1].includes(`'${v}'`));
    if (!suportados.length) return null;
    const teto = ESFORCOS.indexOf(pedido);
    const abaixo = suportados.filter((v) => ESFORCOS.indexOf(v) <= teto);
    return abaixo.length ? abaixo.at(-1) : suportados[0];
}

function criarCompletar({ cliente, aviso = () => {} }) {
    const recusadosPorModelo = new Map(); // modelo -> Set de parametros recusados
    const substitutos = new Map();        // "modelo|esforco" -> esforco aceito

    async function completar(params, opcoes) {
        const recusados = recusadosPorModelo.get(params.model) || new Set();
        const pedido = { ...params };
        if (!pedido.reasoning_effort) delete pedido.reasoning_effort; // vazio = padrao do modelo
        const chave = `${params.model}|${pedido.reasoning_effort}`;
        if (substitutos.has(chave)) pedido.reasoning_effort = substitutos.get(chave);
        for (const p of recusados) delete pedido[p];

        try {
            return await cliente.chat.completions.create(pedido, opcoes);
        } catch (e) {
            const msg = e.message || '';
            const substituto = 'reasoning_effort' in pedido && msg.includes('reasoning_effort')
                && esforcoSubstituto(pedido.reasoning_effort, msg);
            if (substituto && substituto !== pedido.reasoning_effort) {
                aviso(`Modelo ${params.model} nao aceita esforco "${pedido.reasoning_effort}"; usando "${substituto}".`);
                substitutos.set(chave, substituto);
                return completar(params, opcoes);
            }
            const recusado = OPCIONAIS.find((p) => p in pedido && msg.includes(p));
            if (!recusado) throw e;
            aviso(`Modelo ${params.model} recusou ${recusado}; seguindo sem o parametro.`);
            recusados.add(recusado);
            recusadosPorModelo.set(params.model, recusados);
            return completar(params, opcoes); // termina: cada volta remove um parametro
        }
    }

    // `ate` e o instante (ms) em que a resposta precisa estar pronta. Os ultimos
    // `reservaMs` ficam guardados para a tentativa rapida. Sem retry do SDK: um
    // timeout repetido triplicaria a espera.
    async function completarNoPrazo(params, { ate, reservaMs, esforcoDeReserva = 'low' }) {
        const limiteMs = ate - Date.now() - reservaMs;
        if (limiteMs > 0) {
            try {
                return await completar(params, { timeout: limiteMs, maxRetries: 0 });
            } catch (e) {
                if (!TEMPO_ESGOTADO.test(e.message || '')) throw e;
                aviso(`Raciocinio "${params.reasoning_effort}" passou de ${limiteMs}ms; refazendo com "${esforcoDeReserva}".`);
            }
        }
        const reserva = { ...params, reasoning_effort: esforcoDeReserva };
        return completar(reserva, { timeout: Math.max(ate - Date.now(), 1000), maxRetries: 0 });
    }

    return { completar, completarNoPrazo };
}

module.exports = { criarCompletar };
