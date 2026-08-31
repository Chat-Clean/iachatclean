// =============================================================
//  TELEFONE — normalizacao e comparacao de numeros do WhatsApp.
//
//  Primeiro modulo de src/: nao tem I/O, nao le process.env e nao depende de
//  nada. E o inicio da camada compartilhada da arquitetura alvo
//  (docs/10-arquitetura-alvo.md), onde vira o Value Object ChatId na Fase 3.
//
//  Extraido do index.js sem alteracao de logica. A unica diferenca e que
//  contatoPermitido passou a receber a allow-list por parametro, em vez de ler
//  a constante de modulo — e o que tira process.env da camada pura.
// =============================================================

// JID do WhatsApp -> apenas digitos.
// "558491756446:24@s.whatsapp.net" tem o id do dispositivo (:24) e o servidor
// (@...). Sem cortar antes de limpar, o "24" grudaria no numero.
function normalizarPhone(phone) {
    return String(phone).split('@')[0].split(':')[0].replace(/\D/g, '');
}

// Nucleo canonico de um numero BR para COMPARACAO (ignora o 9o digito de
// celular). Ex.: 5584994610845 (13) e 558494610845 (12) viram o mesmo nucleo.
function nucleoNumero(n) {
    let d = normalizarPhone(n);
    if (d.length === 13 && d.startsWith('55') && d[4] === '9') {
        d = d.slice(0, 4) + d.slice(5); // remove o 9 logo apos o DDD
    }
    return d;
}

// true se o numero esta na allow-list (tolerante ao 9o digito).
// Lista vazia ou ausente libera todos.
function contatoPermitido(numero, listaPermitidos) {
    const lista = listaPermitidos || [];
    if (!lista.length) return true;
    const alvo = nucleoNumero(numero);
    return lista.some((a) => nucleoNumero(a) === alvo);
}

module.exports = { normalizarPhone, nucleoNumero, contatoPermitido };
