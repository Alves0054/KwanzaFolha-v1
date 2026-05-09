# Validacao Fiscal por Contabilista

## Obrigatorio antes da entrega comercial

Esta validação e obrigatoria antes de qualquer entrega comercial ou afirmacao de conformidade fiscal.

Versao da aplicação: `1.0.8`

Data da validação: ____ / ____ / ______

Fonte fiscal usada: Lei n.º 14/25, de 30 de Dezembro de 2025, OGE 2026, Anexo I ao Artigo 21.º.

## Tabela IRT 2026 implementada

Ver `docs/fiscalidade/IRT_2026_FONTES_E_VALIDACAO.md`.

## Exemplos de calculo a validar

| Matéria coletável | IRT esperado pelo sistema | Validado pelo contabilista |
|---:|---:|---|
| 150.000 Kz | 0 Kz | Sim / Não |
| 150.001 Kz | 12.500,16 Kz | Sim / Não |
| 242.500 Kz | 38.900 Kz | Sim / Não |
| 339.500 Kz | 56.755 Kz | Sim / Não |
| 11.000.000 Kz | 2.592.250 Kz | Sim / Não |

## Testes fiscais

- `IRT aplica escaloes legais`
- `IRT 2026 fica versionado e comparável com a tabela histórica 2020/2025`
- `Folha fiscal respeita a classificacao por verba e reduz a base por faltas`
- `PayrollService reprocessa o mês aberto e grava a versao fiscal aplicada`

## Pontos a confirmar

- Fonte oficial primária da tabela.
- Formula da parcela fixa e excesso por escalao.
- Tratamento fiscal de subsídios especificos do cliente.
- Arredondamentos aceites na pratica contabilística.
- Coerencia entre recibo, mapa IRT e exportação AGT.

## Declaracao

Declaro que analisei a tabela fiscal, exemplos de calculo e resultados automatizados do Kwanza Folha para a versao indicada.

Resultado: Aprovado / Aprovado com ressalvas / Reprovado

Ressalvas: ________________________________________________________________

Nome do contabilista: _________________________________________________

Numero profissional: _________________________________________________

Assinatura: ___________________________________________________________

Data: ____ / ____ / ______

