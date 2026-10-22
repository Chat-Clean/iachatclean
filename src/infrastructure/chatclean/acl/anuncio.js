// =============================================================
//  ACL — MENSAGEM QUE CHEGA DE ANÚNCIO (clique para WhatsApp)
//
//  Quando o lead toca em "Saber mais" num anúncio do Instagram/Facebook, a
//  plataforma entrega no corpo da mensagem o rastreio da campanha junto com o
//  texto pré-pronto do cliente:
//
//    Url: <link> title: <texto do anúncio> <fala do cliente> <texto do anúncio> Link: <link>
//
//  A IA lia a legenda como se fosse o cliente falando e respondia sobre a
//  campanha. Aqui separamos as duas coisas: a fala do cliente segue para a IA e
//  o link da campanha segue como dado de origem, para metrificar o tráfego. A
//  legenda nunca chega ao modelo.
//
//  A fala é o que identifica a campanha, então o recorte tenta, em ordem:
//    repeticao — o anúncio vem idêntico antes e depois da fala (o caso comum);
//    ancoras   — as duas cópias diferem em algum ponto (emoji, quebra, corte):
//                acha o começo da segunda cópia e o fim da primeira;
//    saudacao  — o anúncio vem uma vez só: procura a frase pré-pronta típica
//                ("Olá! Quero saber mais...", "Posso ter mais informações...");
//    padrao    — nada funcionou: saudação neutra. Melhor perder a fala do que
//                entregar a legenda para a IA.
//  Todo recorte passa por aparar(): se começa no meio de uma frase ou é longo
//  demais, uma das cópias veio cortada e o recorte é refeito a partir da frase
//  pré-pronta.
//
//  Módulo puro: sem I/O, sem log.
// =============================================================

const SAUDACAO_PADRAO = 'Olá! Vim pelo anúncio e quero saber mais.';

// Repetição menor que isso nas duas pontas é coincidência, não o anúncio.
const MIN_TEXTO_ANUNCIO = 10;
// Trecho do começo/fim do anúncio usado para achar a outra cópia.
const TAM_ANCORA = 40;
// Mensagem pré-pronta costuma ser curta; acima disso o recorte é conferido.
const MAX_FALA_TIPICA = 160;
// Fala maior que isso indica que pedaço do anúncio veio junto no recorte.
const MAX_FALA = 400;

// Assinatura do formato: "title:" no começo, com ou sem "Url: <link>" antes.
const RE_CABECALHO = /^\s*(?:url:\s*(\S[\s\S]*?)\s+)?title:\s*/i;

// Frase pré-pronta: cumprimento seguido de pedido de informação, até o fim da frase.
const RE_FALA_PRONTA =
    /(?:^|[\s.!?])((?:ol[aá]|oi|oie|bom dia|boa tarde|boa noite)(?![a-zà-ú])[^.?!]{0,3}[.!?,]?\s*[^]{0,160}?(?:saber mais|mais informa[cç](?:[aã]o|[oõ]es)|informa[cç](?:[aã]o|[oõ]es)|tenho interesse|interesse|or[cç]amento|como funciona|quanto custa|valores?|pre[cç]os?)[^.?!]{0,80}[.?!]?)/gi;

function espacosSimples(s) {
    return String(s || '')
        .replace(/\s+/g, ' ')
        .trim();
}

function ehMensagemDeAnuncio(texto) {
    return RE_CABECALHO.test(String(texto || ''));
}

// Separa o rodapé "Link: <link>" (ou "Url: <link>") do resto. Usa a ÚLTIMA
// ocorrência, para não cortar o anúncio que cite a palavra no meio.
function separarRodape(texto) {
    const re = /(^|\s)(?:link|url):\s*/gi;
    let ultima = null;
    for (let m = re.exec(texto); m; m = re.exec(texto)) ultima = m;
    if (!ultima) return { resto: texto, link: '' };
    const inicio = ultima.index + ultima[1].length;
    const link = texto.slice(ultima.index + ultima[0].length).trim();
    // Rodapé de verdade é curto: só o link. Texto longo depois é anúncio.
    if (!link || link.length > 200) return { resto: texto, link: '' };
    return { resto: texto.slice(0, inicio), link };
}

// repeticao: maior trecho que abre E fecha o texto sem se sobrepor.
function porRepeticao(s) {
    for (let k = Math.floor(s.length / 2); k >= MIN_TEXTO_ANUNCIO; k--) {
        if (s.startsWith(s.slice(s.length - k))) return s.slice(k, s.length - k).trim();
    }
    return '';
}

// ancoras: o começo do anúncio reaparece na segunda cópia; o fim da segunda
// cópia (fim do texto) aparece também no fim da primeira. A fala fica entre.
function porAncoras(s) {
    if (s.length < TAM_ANCORA * 3) return '';
    const segundaCopia = s.indexOf(s.slice(0, TAM_ANCORA), TAM_ANCORA);
    if (segundaCopia < 0) return '';
    const fim = s.slice(-TAM_ANCORA);
    const fimDaPrimeira = s.lastIndexOf(fim, segundaCopia - TAM_ANCORA);
    if (fimDaPrimeira < 0) return '';
    // Cópias de tamanhos muito diferentes: uma veio cortada e a âncora do fim
    // caiu no meio da primeira. O recorte traria legenda junto.
    const tamPrimeira = fimDaPrimeira + TAM_ANCORA;
    const tamSegunda = s.length - segundaCopia;
    if (Math.abs(tamPrimeira - tamSegunda) > Math.max(20, tamSegunda * 0.15)) return '';
    return s.slice(fimDaPrimeira + TAM_ANCORA, segundaCopia).trim();
}

function ultimaSaudacao(s) {
    let ultima = null;
    for (const m of s.matchAll(RE_FALA_PRONTA)) ultima = m;
    if (!ultima) return null;
    return { inicio: ultima.index + ultima[0].length - ultima[1].length, frase: ultima[1].trim() };
}

// saudacao: a última frase pré-pronta do texto (a fala vem depois do anúncio).
function porSaudacao(s) {
    const achada = ultimaSaudacao(s);
    return achada ? achada.frase : '';
}

// Recorte que começa no meio de uma frase, ou longo demais para uma mensagem
// pré-pronta, trouxe o fim do anúncio junto (uma das cópias veio cortada). Se
// houver frase pré-pronta lá dentro, a fala começa nela; o que o cliente
// acrescentou depois dela continua.
function aparar(fala) {
    const suspeita = fala.length > MAX_FALA_TIPICA || /^[a-zà-ú0-9,;:)]/.test(fala);
    if (!suspeita) return fala;
    const achada = ultimaSaudacao(fala);
    return achada && achada.inicio > 0 ? fala.slice(achada.inicio).trim() : fala;
}

function falaPlausivel(fala) {
    return Boolean(fala) && fala.length <= MAX_FALA;
}

/**
 * Separa a fala do cliente do rastreio do anúncio.
 *
 * @param {string} texto Corpo da mensagem como chegou da plataforma.
 * @returns {{ texto: string, recortou: boolean, metodo: string, link: string | null } | null}
 *   null quando não é mensagem de anúncio. `recortou` false indica que valeu a
 *   saudação padrão. `link` é o link da campanha, quando veio.
 */
function extrairFalaDoCliente(texto) {
    const bruto = String(texto || '');
    const cabecalho = bruto.match(RE_CABECALHO);
    if (!cabecalho) return null;

    const { resto, link: linkDoRodape } = separarRodape(bruto.slice(cabecalho[0].length));
    const corpo = espacosSimples(resto);
    const link = espacosSimples(cabecalho[1] || linkDoRodape) || null;

    const tentativas = [
        ['repeticao', () => porRepeticao(corpo)],
        ['ancoras', () => porAncoras(corpo)],
        ['saudacao', () => porSaudacao(corpo)]
    ];
    for (const [metodo, recortar] of tentativas) {
        const fala = aparar(recortar());
        if (falaPlausivel(fala)) return { texto: fala, recortou: true, metodo, link };
    }
    return { texto: SAUDACAO_PADRAO, recortou: false, metodo: 'padrao', link };
}

module.exports = { extrairFalaDoCliente, ehMensagemDeAnuncio, SAUDACAO_PADRAO };
