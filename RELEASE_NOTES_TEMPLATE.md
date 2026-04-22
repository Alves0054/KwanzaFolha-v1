# Release {{version}}

## Resumo

- principal entrega funcional
- principais correcoes tecnicas
- impacto para cliente

## Seguranca e integridade

- estado de assinatura digital
- estado de verificacao de integridade
- riscos residuais relevantes

## Fiscal/compliance

- alteracoes em calculo de folha/IRT/INSS
- alteracoes AGT/PS2/PSX
- itens ainda dependentes de validacao externa

## Scripts de validacao executados

- `npm test`
- `npm run release:validate`
- `npm run release:validate:packaged`
- `npm run verify:packaged:main`
- `npm run smoke:packaged`
- `npm run smoke:packaged:e2e`

## Artefactos publicados

- instalador
- blockmap
- SHA256SUMS
- release-manifest

## Rollback

- versao anterior estavel
- criterio objetivo para rollback
- owner tecnico do incidente
