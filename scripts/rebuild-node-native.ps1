param()

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "A reconstruir modulos nativos para runtime Node..." -ForegroundColor Cyan
& npm rebuild better-sqlite3 --runtime=node

if ($LASTEXITCODE -ne 0) {
  throw "Falha ao reconstruir better-sqlite3 para Node ABI. Feche o aplicativo e tente novamente."
}

Write-Host "Rebuild Node ABI concluido com sucesso." -ForegroundColor Green
