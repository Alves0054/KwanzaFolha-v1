# IRT 2026 - Fontes e Validacao

## Estado

Implementado no motor fiscal como perfil versionado `ao-irt-oge-2026-lei-14-25`.

## Fonte usada

- Lei n.º 14/25, de 30 de Dezembro de 2025, Orçamento Geral do Estado para 2026.
- Referencia consultada: texto reproduzido em Angolex, Anexo I ao Artigo 21.º.
- Confirmacao de contexto: PwC Angola e AVM Advogados referem a publicacao da Lei n.º 14/25 e a atualização do limite de isencao de IRT para Kz 150.000,00.

## Nota bloqueante

TODO BLOQUEANTE: antes de entrega comercial, confirmar a tabela abaixo contra fonte oficial primária: Diário da República, AGT ou MINFIN. Sem esta validação, o produto não deve ser apresentado como fiscalmente validado.

## Tabela implementada - Grupo A

| Escalao | Materia colectavel mensal | Parcela fixa | Taxa sobre excesso |
|---|---:|---:|---:|
| 1 | 0 ate 150.000 Kz | 0 | 0% |
| 2 | Acima de 150.000 ate 200.000 Kz | 12.500 Kz | 16% sobre excesso de 150.000 |
| 3 | Acima de 200.000 ate 300.000 Kz | 31.250 Kz | 18% sobre excesso de 200.000 |
| 4 | Acima de 300.000 ate 500.000 Kz | 49.250 Kz | 19% sobre excesso de 300.000 |
| 5 | Acima de 500.000 ate 1.000.000 Kz | 87.250 Kz | 20% sobre excesso de 500.000 |
| 6 | Acima de 1.000.000 ate 1.500.000 Kz | 187.250 Kz | 21% sobre excesso de 1.000.000 |
| 7 | Acima de 1.500.000 ate 2.000.000 Kz | 292.250 Kz | 22% sobre excesso de 1.500.000 |
| 8 | Acima de 2.000.000 ate 2.500.000 Kz | 402.250 Kz | 23% sobre excesso de 2.000.000 |
| 9 | Acima de 2.500.000 ate 5.000.000 Kz | 517.250 Kz | 24% sobre excesso de 2.500.000 |
| 10 | Acima de 5.000.000 ate 10.000.000 Kz | 1.117.250 Kz | 24,5% sobre excesso de 5.000.000 |
| 11 | Acima de 10.000.000 Kz | 2.342.250 Kz | 25% sobre excesso de 10.000.000 |

## Decisoes tecnicas

- O perfil 2020/2025 foi preservado para reprocessamentos históricos.
- O perfil 2026 entra em vigor a partir de `2026-01`.
- INSS mantido em 3% trabalhador e 8% entidade empregadora.
- Recibos e auditorias registam a versao do perfil fiscal usado.

## Assinatura de validação

Contabilista: _______________________________

Numero profissional: ________________________

Data: ____ / ____ / ______

Assinatura: _________________________________

