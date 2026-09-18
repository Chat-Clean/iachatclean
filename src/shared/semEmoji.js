// =============================================================
//  REMOÇÃO DE EMOJI DO TEXTO ENVIADO AO LEAD
//  A instrução no prompt e a guarda sao probabilisticas: o modelo pequeno
//  reincide. Aqui a regra vira deterministica, no unico ponto de saida das
//  mensagens ao lead. Nao se aplica a nota interna nem ao resumo da equipe,
//  que usam emoji como marcador visual.
// =============================================================

// Extended_Pictographic cobre os emoji modernos; VS16 e ZWJ removem os restos
// de sequencias compostas (bandeiras, familias, tons de pele).
const RE_EMOJI = /(?:\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}]|\u{FE0F}|\u{200D})/gu;

function removerEmojis(texto) {
    if (texto === null || texto === undefined) return texto;
    return String(texto)
        .replace(RE_EMOJI, '')
        .replace(/[ \t]{2,}/g, ' ')      // espaços que sobraram no lugar do emoji
        .replace(/[ \t]+([,.!?;:])/g, '$1')
        .split('\n')
        .map((l) => l.trim())
        .join('\n')
        .trim();
}

module.exports = { removerEmojis, RE_EMOJI };
