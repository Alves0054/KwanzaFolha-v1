param(
  [string]$OutputDir = "dist-electron",
  [int]$BootWaitSeconds = 12,
  [int]$TimeoutSeconds = 90,
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
    if (-not $signature.SignerCertificate) {
      throw "Smoke falhou: assinatura ausente para '$PathToFile' (NotSigned)."
    }

    $status = [string]$signature.Status
    if ($status -eq "NotSigned" -or $status -eq "HashMismatch") {
      throw "Smoke falhou: assinatura inválida para '$PathToFile'. Estado: $status."
    }
    if (-not $signature.TimeStamperCertificate) {
      throw "Smoke falhou: '$PathToFile' esta assinado sem timestamp."
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
$previousLocalPackagedDevMode = $env:KWANZA_LOCAL_PACKAGED_DEV_MODE
$env:KWANZA_DEV_LICENSE_MODE = ""
if ($SkipSignatureCheck) {
  $env:KWANZA_LOCAL_PACKAGED_DEV_MODE = "1"
} else {
  $env:KWANZA_LOCAL_PACKAGED_DEV_MODE = ""
}

$process = $null
try {
  $launchStartedAt = Get-Date
  $process = Start-Process -FilePath $appExe -WorkingDirectory (Split-Path $appExe -Parent) -PassThru
  Start-Sleep -Seconds $BootWaitSeconds

  $deadline = (Get-Date).AddSeconds([Math]::Max($TimeoutSeconds, $BootWaitSeconds))
  $startupFinished = $false
  while ((Get-Date) -lt $deadline) {
    if ($process.HasExited) {
      break
    }
    if (Test-Path $logPath) {
      $logItem = Get-Item -LiteralPath $logPath -ErrorAction SilentlyContinue
      $logText = Get-Content -Path $logPath -Raw -ErrorAction SilentlyContinue
      if ($logItem -and $logItem.LastWriteTime -ge $launchStartedAt -and $logText -match "\[BOOT\] startup sequence finished") {
        $startupFinished = $true
        break
      }
    }
    Start-Sleep -Milliseconds 700
  }

  if ($process.HasExited -and $process.ExitCode -ne 0) {
    throw "Smoke falhou: executavel terminou cedo com exit code $($process.ExitCode)."
  }

  if (-not $startupFinished) {
    throw "Smoke falhou: arranque nao concluiu dentro do timeout de ${TimeoutSeconds}s."
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
  if ($null -eq $previousLocalPackagedDevMode) {
    Remove-Item Env:KWANZA_LOCAL_PACKAGED_DEV_MODE -ErrorAction SilentlyContinue
  } else {
    $env:KWANZA_LOCAL_PACKAGED_DEV_MODE = $previousLocalPackagedDevMode
  }
}

if (-not (Test-Path $logPath)) {
  throw "Smoke falhou: log principal nao foi gerado em '$logPath'."
}

$logText = Get-Content -Path $logPath -Raw -ErrorAction Stop
if ($logText -notmatch "\[BOOT\] startup sequence finished") {
  throw "Smoke falhou: marcador [BOOT] startup sequence finished ausente no log final."
}
if ($logText -match "NODE_MODULE_VERSION|compiled against a different Node\.js version|Falha de compatibilidade dos modulos SQLite") {
  throw "Smoke falhou: o log contem falha de ABI/SQLite nativo."
}

Write-Host "Smoke empacotado concluido com sucesso." -ForegroundColor Green
