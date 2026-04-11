param(
  [string]$OutputDir = "dist-electron",
  [int]$BootWaitSeconds = 12,
  [switch]$SkipSignatureCheck
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$resolvedOutput = Resolve-Path $OutputDir -ErrorAction Stop
$installer = Get-ChildItem -Path (Join-Path $resolvedOutput "KwanzaFolha-Setup-*.exe") -File -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

$appExe = Join-Path $resolvedOutput "win-unpacked\Kwanza Folha.exe"

if (-not $installer) {
  throw "Smoke falhou: nao encontrei o instalador em '$resolvedOutput'."
}
if (-not (Test-Path $appExe)) {
  throw "Smoke falhou: nao encontrei o executavel empacotado '$appExe'."
}

node scripts\verify-packaged-main-syntax.js --output $resolvedOutput
if ($LASTEXITCODE -ne 0) {
  throw "Smoke falhou: validacao de sintaxe do main empacotado falhou."
}

if (-not $SkipSignatureCheck) {
  function Assert-ValidSignature {
    param([string]$PathToFile)

    $signature = Get-AuthenticodeSignature -FilePath $PathToFile
    if ($signature.Status -ne "Valid" -or -not $signature.SignerCertificate) {
      throw "Smoke falhou: assinatura invalida para '$PathToFile'. Estado: $($signature.Status)."
    }
  }

  Assert-ValidSignature -PathToFile $installer.FullName
  Assert-ValidSignature -PathToFile $appExe
}

$logDir = Join-Path $env:LOCALAPPDATA "KwanzaFolha\logs"
$logPath = Join-Path $logDir "main.log"
if (Test-Path $logPath) {
  Remove-Item -LiteralPath $logPath -Force -ErrorAction SilentlyContinue
}

$previousDevMode = $env:KWANZA_DEV_LICENSE_MODE
$env:KWANZA_DEV_LICENSE_MODE = ""

$process = $null
try {
  $process = Start-Process -FilePath $appExe -WorkingDirectory (Split-Path $appExe -Parent) -PassThru
  Start-Sleep -Seconds $BootWaitSeconds

  if ($process.HasExited -and $process.ExitCode -ne 0) {
    throw "Smoke falhou: executavel terminou cedo com exit code $($process.ExitCode)."
  }
} finally {
  if ($process -and -not $process.HasExited) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  }

  if ($null -eq $previousDevMode) {
    Remove-Item Env:KWANZA_DEV_LICENSE_MODE -ErrorAction SilentlyContinue
  } else {
    $env:KWANZA_DEV_LICENSE_MODE = $previousDevMode
  }
}

if (-not (Test-Path $logPath)) {
  throw "Smoke falhou: log principal nao foi gerado em '$logPath'."
}

$logText = Get-Content -Path $logPath -Raw -ErrorAction Stop
if ($logText -notmatch "\[BOOT\] startup sequence finished") {
  throw "Smoke falhou: arranque nao concluiu (marcador [BOOT] startup sequence finished ausente)."
}

Write-Host "Smoke empacotado concluido com sucesso." -ForegroundColor Green
