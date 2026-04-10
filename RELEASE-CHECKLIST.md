# Release Checklist

## Antes da release

- confirmar a versao em `package.json`
- confirmar que o tag segue o formato `vX.Y.Z` ou `vX.Y.Z-beta.N`
- confirmar `electron/config/update-source.js`
- confirmar certificado de assinatura e palavra-passe em ambiente seguro
- confirmar que o manifesto legal do instalador continua atual

## Validacoes minimas

- executar `npm test`
- validar login e logout
- validar recuperacao de acesso por codigo de redefinicao
- validar processamento mensal e fecho/reabertura de periodo
- validar exportacao Excel, pacote mensal e recibos
- validar backup e restauro
- validar verificacao e descarga de atualizacao

## Build de release

- usar `npm run release:prepare` para canal estavel
- usar `npm run release:prepare:beta` para beta controlada
- confirmar que foram gerados:
  - `dist-electron/KwanzaFolha-Setup-<versao>.exe`
  - `dist-electron/KwanzaFolha-Portable-<versao>.exe`
  - `dist-electron/SHA256SUMS.txt`
  - `dist-electron/release-manifest.json`
  - `dist-electron/release-notes-template.md`
- confirmar assinatura digital valida no `.exe`

## Publicacao GitHub Release

- publicar apenas artefactos assinados
- anexar sempre `SHA256SUMS.txt`
- anexar sempre `release-manifest.json`
- publicar como `draft` para revisao final
- marcar `prerelease` quando for canal beta
- rever as notas da release antes de publicar

## Pos-release

- testar o download da release no GitHub
- testar a verificacao de integridade do instalador descarregado
- validar instalacao por cima da versao anterior
- arquivar backup operacional e relatorio de validacao
