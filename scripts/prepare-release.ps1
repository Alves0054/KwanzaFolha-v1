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

Write-Host "Release preparada com sucesso em dist-electron." -ForegroundColor Green
