# Testes Fiscais

## Cobertura automatizada

Os testes fiscais estao em `tests/run-tests.js` e cobrem:

- salario isento em 2026;
- fronteira de 150.000 Kz;
- primeiro escalao tributavel;
- escaloes intermedios;
- salario alto;
- comparacao 2020/2025 versus 2026;
- INSS antes de IRT;
- subsidios tributaveis e isentos;
- faltas e reducao da base fiscal;
- processamento de folha com versao fiscal gravada;
- relatórios/mapas com versao fiscal.

## Comando

```powershell
npm run test:node:abi
```

## Validacao manual recomendada

Selecionar pelo menos cinco funcionários reais ou anonimizados, calcular manualmente com contabilista e comparar com recibo, mapa IRT e auditoria de calculo.

