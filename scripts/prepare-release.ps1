param(
  [ValidateSet("stable", "beta")]
  [string]$Channel = "stable",
  [ValidateSet("installer", "all")]
  [string]$Target = "all",
  [switch]$SkipTests,
  [string]$CertificatePath = "",
  [string]$CertificatePassword = "",
  [string]$TimestampServer = "https://timestamp.digicert.com"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "A validar pre-condicoes da release..." -ForegroundColor Cyan
node (Join-Path $PSScriptRoot "validate-release-readiness.js") --phase preflight
if ($LASTEXITCODE -ne 0) {
  throw "A validacao preflight da release falhou com exit code $LASTEXITCODE."
}

if (-not $SkipTests) {
  Write-Host "A executar a suite automatizada..." -ForegroundColor Cyan
  npm test
  if ($LASTEXITCODE -ne 0) {
    throw "A suite de testes falhou com exit code $LASTEXITCODE."
  }
}

Write-Host "A gerar a build assinada..." -ForegroundColor Cyan
& (Join-Path $PSScriptRoot "build-signed.ps1") `
  -Target $Target `
  -CertificatePath $CertificatePath `
  -CertificatePassword $CertificatePassword `
  -TimestampServer $TimestampServer `
  -AllowUnsignedTimestamp:$false

Write-Host "A gerar checksum e manifesto da release..." -ForegroundColor Cyan
node (Join-Path $PSScriptRoot "release-artifacts.js") --channel $Channel --target $Target
if ($LASTEXITCODE -ne 0) {
  throw "A geracao de checksums/manifesto falhou com exit code $LASTEXITCODE."
}

Write-Host "A validar artefactos empacotados da release..." -ForegroundColor Cyan
node (Join-Path $PSScriptRoot "validate-release-readiness.js") --phase packaged --distDir "dist-electron"
if ($LASTEXITCODE -ne 0) {
  throw "A validacao dos artefactos da release falhou com exit code $LASTEXITCODE."
}

Write-Host "Release preparada com sucesso em dist-electron." -ForegroundColor Green
