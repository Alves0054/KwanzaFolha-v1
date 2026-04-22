# Release Process - Kwanza Folha

## Objetivo

Garantir release comercial reprodutivel, assinada, validada e auditavel.

## Fluxo automatizado (CI)

1. `npm ci`
2. `npm test`
3. `npm run release:validate` (preflight)
4. build (`npm run build:installer` em PR; `scripts/prepare-release.ps1` em tag)
5. `npm run release:validate:packaged`
6. `npm run verify:packaged:main`
7. smoke test empacotado (`smoke-packaged` e `smoke-packaged:e2e`)
8. validacao de assinatura (`scripts/verify-release-signatures.ps1`)
9. gerar `SHA256SUMS.txt`, `release-manifest.json`, `release-notes-template.md`
10. publicar GitHub Release em draft

## Fluxo manual local

1. `npm install`
2. `npm test`
3. `npm run release:validate`
4. `npm run release:prepare` ou `npm run release:prepare:beta`
5. `npm run release:validate:packaged`
6. validar assinaturas:
   - `powershell -ExecutionPolicy Bypass -File scripts/verify-release-signatures.ps1 -OutputDir dist-electron -RequireTimestamp`
7. validar smoke local:
   - `npm run smoke:packaged`
   - `npm run smoke:packaged:e2e`

## Artefactos obrigatorios

- `dist-electron/KwanzaFolha-Setup-<versao>.exe`
- `dist-electron/KwanzaFolha-Setup-<versao>.exe.blockmap`
- `dist-electron/SHA256SUMS.txt`
- `dist-electron/release-manifest.json`
- `dist-electron/release-notes-template.md`

## Regras de bloqueio de release

- falha de testes bloqueia release
- falha de assinatura bloqueia release
- ausencia de artefactos obrigatorios bloqueia release
- ausencia de documentacao minima bloqueia release
- detecao de ficheiros sensiveis no pacote bloqueia release

## Rollback basico

1. retirar publicacao da release atual (draft/unpublish conforme estado)
2. regressar para ultima versao estavel conhecida
3. abrir incidente com causa/impacto
4. corrigir em nova versao (nao reutilizar tag)
