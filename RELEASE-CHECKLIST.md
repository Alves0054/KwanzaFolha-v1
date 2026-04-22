# Release Checklist

## Antes da release

- confirmar versao em `package.json`
- confirmar tag no formato `vX.Y.Z` ou `vX.Y.Z-beta.N`
- confirmar `electron/config/update-source.js`
- confirmar secrets de assinatura (`KWANZA_CERTIFICATE_BASE64`, `KWANZA_CERTIFICATE_PASSWORD`)
- executar `npm run release:validate`

## Validacoes tecnicas obrigatorias

- `npm test`
- `npm run release:validate:packaged`
- `npm run verify:packaged:main`
- `npm run smoke:packaged`
- `npm run smoke:packaged:e2e`
- `powershell -ExecutionPolicy Bypass -File scripts/verify-release-signatures.ps1 -OutputDir dist-electron -RequireTimestamp`

## Artefactos obrigatorios

- `dist-electron/KwanzaFolha-Setup-<versao>.exe`
- `dist-electron/KwanzaFolha-Setup-<versao>.exe.blockmap`
- `dist-electron/SHA256SUMS.txt`
- `dist-electron/release-manifest.json`
- `dist-electron/release-notes-template.md`

## Publicacao

- publicar inicialmente em `draft`
- marcar `prerelease` para canal beta
- anexar apenas artefactos obrigatorios assinados
- validar hash SHA256 e manifesto antes de publicar

## Pos-release

- validar instalacao limpa em maquina de teste
- validar upgrade sobre versao anterior
- exportar bundle de diagnostico de referencia
- registar validacao operacional da release
