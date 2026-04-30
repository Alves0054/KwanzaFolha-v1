# Release Process - Kwanza Folha

## Objetivo

Garantir release comercial reprodutivel, assinada, validada e auditavel.

## Fluxo automatizado (CI)

1. `npm ci`
2. `npm test`
3. `npm run security:scan` (bloqueia ficheiros sensíveis antes da build)
4. `npm run release:validate` (preflight)
5. build (`npm run build:installer` em PR; `scripts/prepare-release.ps1` em tag)
6. `npm run release:validate:packaged`
7. `npm run verify:packaged:main`
8. smoke test empacotado (`smoke-packaged` e `smoke-packaged:e2e`)
9. validacao de assinatura (`scripts/verify-release-signatures.ps1`)
10. gerar `SHA256SUMS.txt`, `release-manifest.json`, `release-notes-template.md`
11. publicar GitHub Release em draft

## Fluxo manual local

1. `npm install`
2. `npm test`
3. opcional: `npm run clean:workspace -- -All` (remove bases/logs/artifacts para validação limpa)
4. `npm run security:scan`
5. `npm run release:validate`
6. `npm run release:prepare` ou `npm run release:prepare:beta`
7. `npm run release:validate:packaged`
8. validar assinaturas:
   - `powershell -ExecutionPolicy Bypass -File scripts/verify-release-signatures.ps1 -OutputDir dist-electron -RequireTimestamp`
9. validar smoke local:
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
