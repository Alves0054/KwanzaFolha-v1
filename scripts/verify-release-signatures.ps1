param(
  [string]$OutputDir = "dist-electron",
  [switch]$RequireTimestamp
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$resolvedOutputDir = (Resolve-Path $OutputDir -ErrorAction Stop).Path
$installer = Get-ChildItem -Path (Join-Path $resolvedOutputDir "KwanzaFolha-Setup-*.exe") -File -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
$appExe = Join-Path $resolvedOutputDir "win-unpacked\Kwanza Folha.exe"

if (-not $installer) {
  throw "Nao foi encontrado instalador em '$resolvedOutputDir'."
}
if (-not (Test-Path $appExe)) {
  throw "Nao foi encontrado executavel empacotado '$appExe'."
}

$targets = @($installer.FullName, $appExe)
foreach ($targetPath in $targets) {
  $signature = Get-AuthenticodeSignature -FilePath $targetPath
  if ($signature.Status -ne "Valid" -or -not $signature.SignerCertificate) {
    throw "Assinatura invalida para '$targetPath'. Estado: $($signature.Status)."
  }
  if ($RequireTimestamp -and -not $signature.TimeStamperCertificate) {
    throw "Assinatura sem timestamp para '$targetPath'."
  }
}

Write-Host "Assinaturas validadas com sucesso para release." -ForegroundColor Green
