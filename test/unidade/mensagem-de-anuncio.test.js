// Mensagem que chega do clique em anúncio (Instagram/Facebook -> WhatsApp).
// Os textos abaixo foram copiados de conversas reais de 20 e 21/10/2026, em que
// a IA respondeu sobre a legenda da campanha ("Vi a peça...", "Recebemos o
// vídeo") em vez de atender o cliente.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    extrairFalaDoCliente,
    ehMensagemDeAnuncio,
    SAUDACAO_PADRAO
} = require('../../src/infrastructure/chatclean/acl/anuncio.js');
const { traduzir } = require('../../src/infrastructure/chatclean/acl/tradutor.js');

// Monta o corpo no formato da plataforma: o anúncio cerca a fala do cliente.
function corpoDeAnuncio(link, titulo, legenda, fala, sep = '\n') {
    const anuncio = `${titulo}${sep}${legenda}`;
    return `Url: ${link}${sep}title: ${anuncio}${sep}${fala}${sep}${anuncio}${sep}Link: ${link}`;
}

const DISPARO = {
    link: 'https://www.instagram.com/p/DeuakIyAEZv',
    titulo: 'Disparo em massa com a API Oficial da Meta',
    legenda:
        'Empresário, disparar pelo WhatsApp comum é um dos caminhos mais rápidos para ter o número bloqueado.\n\n' +
        'Com a ChatClean, sua empresa envia campanhas para toda a base de contatos pela API Oficial da Meta, com mais segurança para o número e alta taxa de entrega.\n\n' +
        '✅ Disparos em massa com modelos aprovados pela Meta\n✅ Seu número oficial, sem depender de conexões não oficiais\n' +
        '✅ Respostas dos clientes centralizadas no CRM, com a equipe toda atendendo\n\nSomos parceiros da Meta. Toque em Fale conosco e veja como funciona na sua operação.',
    fala: 'Olá! Quero saber mais sobre a ChatClean.'
};

const MADRUGADA = {
    link: 'https://www.instagram.com/p/DePnMOHAq41',
    titulo: 'Seu atendimento nunca dorme',
    legenda:
        'Seu cliente chamou às 2 da manhã. Quem respondeu?\n\nNa ChatClean, quem responde é a Jéssica, nossa agente de IA. ' +
        'Ela atende em segundos, entende até áudio, qualifica o lead e já deixa a reunião marcada na agenda do seu time. ' +
        'De manhã, sua equipe só precisa fechar.\n\nSeu atendimento funcionando 24h, sem perder nenhum lead de madrugada. ' +
        'Fale com um especialista e tenha um diagnóstigo gratuito.',
    fala: 'Olá! Quero saber mais sobre a ChatClean.'
};

const MIGRE = {
    link: 'https://www.instagram.com/p/Dehd00mgb5K',
    titulo: 'Migre agora para API Oficial da Meta!',
    legenda:
        'O WhatsApp vai mudar — e quem dispara mensagem de qualquer jeito vai ter o número bloqueado.\n\n' +
        'A Meta anunciou que em breve o WhatsApp vai funcionar com @, igual ao Instagram. E isso muda tudo pra quem vende pelo Zap. ' +
        'Com a API Oficial da Meta (o canal autorizado), você envia mensagem em massa com segurança, organiza sua equipe e ainda conta com IA no atendimento. ' +
        'A ChatClean já opera com a API Oficial. Comenta API ou clica abaixo e a gente te mostra tudo.',
    fala: 'Olá! Posso saber mais informações sobre isto?'
};

const BLOQUEIO = {
    link: 'https://fb.me/9d0wsRNqT',
    titulo: 'Seu WhatsApp foi bloqueado de novo? Proteja sua operação.',
    legenda:
        'Empresário, sua equipe depende do WhatsApp para vender, e um bloqueio pode parar tudo em um dia. ' +
        'Se o número da sua empresa já caiu mais de uma vez, o problema não é sorte. ' +
        'Com a API Oficial da Meta, seu número fica protegido e sua equipe continua atendendo e vendendo sem interrupção. ' +
        'Na ChatClean, você tem um CRM que organiza cada conversa, mostra o que cada colaborador está fazendo e acompanha de onde vêm os clientes que realmente compram. ' +
        'Quer saber se a sua operação está exposta? Fale com a gente pelo WhatsApp e receba um diagnóstico gratuito.',
    fala: 'Olá! Posso ter mais informações sobre isso?'
};

const CASOS = { DISPARO, MADRUGADA, MIGRE, BLOQUEIO };

describe('extrairFalaDoCliente', () => {
    for (const [nome, c] of Object.entries(CASOS)) {
        it(`recorta só a fala do cliente no anúncio ${nome}`, () => {
            const r = extrairFalaDoCliente(corpoDeAnuncio(c.link, c.titulo, c.legenda, c.fala));
            expect(r).toEqual({ texto: c.fala, recortou: true, metodo: 'repeticao', link: c.link });
        });
    }

    it('fala pré-pronta personalizada pelo anunciante também é recortada inteira', () => {
        const fala = 'Vim pelo Instagram e quero a demonstração da Jéssica para minha clínica';
        const r = extrairFalaDoCliente(corpoDeAnuncio(MADRUGADA.link, MADRUGADA.titulo, MADRUGADA.legenda, fala));
        expect(r.texto).toBe(fala);
    });

    it('cliente que completa a mensagem pronta antes de enviar: a fala inteira segue', () => {
        const fala = 'Olá! Quero saber mais sobre a ChatClean. Tenho uma ótica com 3 lojas.';
        expect(extrairFalaDoCliente(corpoDeAnuncio(DISPARO.link, DISPARO.titulo, DISPARO.legenda, fala)).texto).toBe(
            fala
        );
    });

    it('ancoras: segunda cópia difere da primeira (emojis removidos)', () => {
        const c = DISPARO;
        const anuncio = `${c.titulo}\n${c.legenda}`;
        const corpo = `Url: ${c.link}\ntitle: ${anuncio}\n${c.fala}\n${anuncio.replace(/✅ /g, '')}\nLink: ${c.link}`;
        expect(extrairFalaDoCliente(corpo)).toMatchObject({ texto: c.fala, recortou: true, metodo: 'ancoras' });
    });

    it('saudacao: anúncio vem uma vez só, com a fala no fim', () => {
        const c = DISPARO;
        const corpo = `Url: ${c.link}\ntitle: ${c.titulo}\n${c.legenda}\n${c.fala}\nLink: ${c.link}`;
        expect(extrairFalaDoCliente(corpo)).toMatchObject({ texto: c.fala, recortou: true, metodo: 'saudacao' });
    });

    it('segunda cópia cortada pela metade não deixa a legenda vazar', () => {
        const c = MIGRE;
        const anuncio = `${c.titulo}\n${c.legenda}`;
        const corpo = `Url: ${c.link}\ntitle: ${anuncio}\n${c.fala}\n${anuncio.slice(0, 200)}\nLink: ${c.link}`;
        const r = extrairFalaDoCliente(corpo);
        expect(r.texto).toBe(c.fala);
        expect(r.texto).not.toMatch(/Meta|bloqueado|Instagram/);
    });

    it('pega o link da campanha do cabeçalho ou, sem ele, do rodapé', () => {
        const c = BLOQUEIO;
        const anuncio = `${c.titulo}\n${c.legenda}`;
        const semRodape = `Url: ${c.link}\ntitle: ${anuncio}\n${c.fala}\n${anuncio}`;
        const semCabecalho = `title: ${anuncio}\n${c.fala}\n${anuncio}\nLink: ${c.link}`;
        expect(extrairFalaDoCliente(semRodape)).toMatchObject({ texto: c.fala, link: c.link });
        expect(extrairFalaDoCliente(semCabecalho)).toMatchObject({ texto: c.fala, link: c.link });
    });

    it('anúncio que cita "link:" no meio da legenda não perde o recorte', () => {
        const legenda =
            'Clique no link: abaixo e fale com a gente. Atendimento com IA o dia todo, sem fila e sem espera.';
        const corpo = corpoDeAnuncio(DISPARO.link, 'Atendimento 24h com IA', legenda, DISPARO.fala);
        expect(extrairFalaDoCliente(corpo)).toMatchObject({ texto: DISPARO.fala, link: DISPARO.link });
    });

    it('recorta também com o texto como aparece no painel (barras e quebras viram espaço)', () => {
        const c = DISPARO;
        const corpo = corpoDeAnuncio(
            'https:  www.instagram.com p DeuakIyAEZv',
            c.titulo,
            c.legenda.replace(/\n+/g, '  '),
            c.fala,
            ' '
        );
        expect(extrairFalaDoCliente(corpo).texto).toBe(c.fala);
    });

    it('nada do rastreio sobra no texto que vai para a IA', () => {
        const c = MADRUGADA;
        const { texto } = extrairFalaDoCliente(corpoDeAnuncio(c.link, c.titulo, c.legenda, c.fala));
        expect(texto).not.toMatch(/url:|title:|link:|instagram|Jéssica|madrugada/i);
    });

    it('cliente que apaga o texto pré-pronto: vale a saudação padrão, não a legenda', () => {
        const c = BLOQUEIO;
        const r = extrairFalaDoCliente(corpoDeAnuncio(c.link, c.titulo, c.legenda, ''));
        expect(r).toEqual({ texto: SAUDACAO_PADRAO, recortou: false, metodo: 'padrao', link: c.link });
    });

    it('formato que não dá para recortar (anúncio uma vez só, sem fala): saudação padrão', () => {
        const corpo = `Url: ${DISPARO.link}\ntitle: ${DISPARO.titulo}\n${DISPARO.legenda}\nLink: ${DISPARO.link}`;
        expect(extrairFalaDoCliente(corpo)).toMatchObject({ texto: SAUDACAO_PADRAO, recortou: false });
    });

    it('mensagem comum não é tocada', () => {
        expect(extrairFalaDoCliente('Oi, vi o anúncio de vocês e quero saber o preço')).toBeNull();
        expect(extrairFalaDoCliente('Segue o link: https://minhaempresa.com.br')).toBeNull();
        expect(extrairFalaDoCliente('')).toBeNull();
        expect(extrairFalaDoCliente(null)).toBeNull();
    });

    it('cliente que digita "url:" no meio da frase não é confundido com anúncio', () => {
        expect(ehMensagemDeAnuncio('a url: do meu site tem title: errado')).toBe(false);
    });
});

// Payload do ChatClean pelo n8n, com o criativo do anúncio como mídia.
function payloadDeAnuncio(caso, mediaType = 'video') {
    return [
        {
            headers: { 'content-type': 'application/json' },
            body: {
                event: 'NewMessage',
                message: {
                    id: 'msg-anuncio-1',
                    body: corpoDeAnuncio(caso.link, caso.titulo, caso.legenda, caso.fala),
                    fromMe: false,
                    note: false,
                    mediaType,
                    mediaUrl: 'https://exemplo.invalido/criativo.mp4',
                    quotedMsg: { body: corpoDeAnuncio(caso.link, caso.titulo, caso.legenda, caso.fala) },
                    ticket: {
                        status: 'pending',
                        userId: null,
                        contact: { id: 1, name: 'Anita Vasconcellos', number: '5584999313522' }
                    }
                }
            }
        }
    ];
}

describe('tradutor com mensagem de anúncio', () => {
    it('entrega à IA só a fala, como texto, sem a mídia do criativo', () => {
        const m = traduzir(payloadDeAnuncio(MIGRE, 'video'));
        expect(m.aceita).toBe(true);
        expect(m.texto).toBe(MIGRE.fala);
        expect(m.tipo).toBe('text');
        expect(m.mediaUrl).toBeNull();
        expect(m.quotedText).toBeNull();
        expect(m.anuncio).toEqual({ link: MIGRE.link, mensagem: MIGRE.fala, metodo: 'repeticao' });
    });

    it('sem fala recortável a origem fica registrada, com a mensagem em branco', () => {
        const p = payloadDeAnuncio({ ...BLOQUEIO, fala: '' });
        const m = traduzir(p);
        expect(m.texto).toBe(SAUDACAO_PADRAO);
        expect(m.anuncio).toEqual({ link: BLOQUEIO.link, mensagem: null, metodo: 'padrao' });
    });

    it('anúncio com imagem também vira texto', () => {
        const m = traduzir(payloadDeAnuncio(DISPARO, 'image'));
        expect(m.tipo).toBe('text');
        expect(m.texto).toBe(DISPARO.fala);
    });

    it('formato plano também é limpo', () => {
        const m = traduzir({
            number: '5585997987325',
            type: 'image',
            body: corpoDeAnuncio(BLOQUEIO.link, BLOQUEIO.titulo, BLOQUEIO.legenda, BLOQUEIO.fala)
        });
        expect(m.texto).toBe(BLOQUEIO.fala);
        expect(m.tipo).toBe('text');
    });

    it('resposta comum citando a mensagem do anúncio não leva a legenda junto', () => {
        const p = payloadDeAnuncio(MADRUGADA, 'text');
        p[0].body.message.body = 'Minha empresa é a Ótica 083';
        const m = traduzir(p);
        expect(m.texto).toBe('Minha empresa é a Ótica 083');
        expect(m.quotedText).toBeNull();
        expect(m.anuncio).toBeNull();
    });

    it('mensagem comum segue igual', () => {
        const m = traduzir({
            number: '5511999998888',
            type: 'text',
            body: 'oi',
            quotedText: 'Qual o nome da sua empresa?'
        });
        expect(m.texto).toBe('oi');
        expect(m.quotedText).toBe('Qual o nome da sua empresa?');
        expect(m.anuncio).toBeNull();
    });
});
