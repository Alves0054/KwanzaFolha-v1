$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$electronVersion = node -p "require('./node_modules/electron/package.json').version"
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($electronVersion)) {
  throw "Nao foi possivel resolver a versao local do Electron."
}

Write-Host "Recompilando modulos nativos para Electron $electronVersion..." -ForegroundColor Cyan

npm rebuild better-sqlite3-multiple-ciphers --runtime=electron --target=$electronVersion --dist-url=https://electronjs.org/headers
if ($LASTEXITCODE -ne 0) {
  throw "Falha ao reconstruir better-sqlite3-multiple-ciphers para Electron $electronVersion."
}

node scripts\verify-electron-native-modules.js
if ($LASTEXITCODE -ne 0) {
  throw "Falha na verificacao ABI dos modulos nativos do Electron."
}

Write-Host "Modulos nativos do Electron verificados com sucesso." -ForegroundColor Green
