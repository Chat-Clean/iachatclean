# Specs

Spec-Driven Development. Fatias de risco real nao comecam sem spec aprovada.

```
SPEC (o que / por que)  ->  PLAN (como)  ->  TASKS (passos)  ->  CODE + TESTS  ->  VERIFY
```

## Estrutura

```
specs/
  NNNN-nome-curto/
    spec.md       o problema, os criterios de aceite (CA-NNN), o que fica fora
    plan.md       a abordagem, os riscos, a ordem das etapas
    tasks.md      passos verificaveis, um por commit
    resultado.md  o que de fato saiu, incluindo o que mudou de plano
```

## Regras

- Numeracao sequencial de quatro digitos, sem reuso.
- Todo criterio de aceite tem ID `CA-NNN` e e referenciado pelo teste que o cobre.
- Achado fora de escopo nao vira correcao: vira divida em
  `docs/13-estado-e-continuacao.md` e, quando couber, teste que CONGELA o comportamento atual.
- `resultado.md` e escrito ao fim, com o que realmente aconteceu — inclusive o que deu errado.

## Indice

| Spec | Assunto | Estado |
|---|---|---|
| — | Fases 0 e 1 foram executadas direto, com teste de caracterizacao antes de cada extracao | concluidas |
