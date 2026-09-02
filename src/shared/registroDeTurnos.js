// =============================================================
//  REGISTRO DE TURNOS EM VOO
//  O chamador (n8n) desiste quando o turno passa do timeout dele e reenvia a
//  MESMA mensagem. O dedupe antigo respondia "ignorado" com `respostas: []`, e
//  o lead ficava sem resposta: a resposta boa saia na conexao ja abandonada.
//  Aqui o reenvio passa a ESPERAR o turno original e receber a mesma resposta.
//  Puro: sem timers proprios, sem I/O. O relogio entra por parametro.
// =============================================================

const TTL_PADRAO_MS = 5 * 60 * 1000;
const MAX_PADRAO = 500;

function criarRegistroDeTurnos({ ttlMs = TTL_PADRAO_MS, max = MAX_PADRAO, agora = () => Date.now() } = {}) {
    const emVoo = new Map(); // msgId -> { promessa, em }

    // Sem msgId nao da para reconhecer reenvio: executa e nao registra.
    function obterOuCriar(msgId, fabrica) {
        if (!msgId) return { promessa: fabrica(), reenvio: false };

        const registrado = emVoo.get(msgId);
        if (registrado) return { promessa: registrado.promessa, reenvio: true };

        const promessa = fabrica();
        // Uma rejeicao guardada e observada so no reenvio viraria
        // unhandledRejection: o consumidor original ja tem o seu try/catch.
        promessa.catch(() => {});
        emVoo.set(msgId, { promessa, em: agora() });
        podar();
        return { promessa, reenvio: false };
    }

    function podar() {
        const limite = agora() - ttlMs;
        for (const [id, t] of emVoo) {
            if (t.em < limite) emVoo.delete(id);
        }
        // Map preserva ordem de insercao: os mais antigos saem primeiro.
        let excedente = emVoo.size - max;
        if (excedente <= 0) return;
        for (const id of emVoo.keys()) {
            if (excedente-- <= 0) break;
            emVoo.delete(id);
        }
    }

    return { obterOuCriar, tamanho: () => emVoo.size };
}

module.exports = { criarRegistroDeTurnos, TTL_PADRAO_MS, MAX_PADRAO };
