param(
  [string]$OutputDir = "dist-electron",
  [int]$TimeoutSeconds = 120,
  [switch]$SkipSignatureCheck
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$resolvedOutput = (Resolve-Path $OutputDir -ErrorAction Stop).Path
$installer = Get-ChildItem -Path (Join-Path $resolvedOutput "KwanzaFolha-Setup-*.exe") -File -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
$appExe = Join-Path $resolvedOutput "win-unpacked\Kwanza Folha.exe"

if (-not $installer) {
  throw "Smoke E2E falhou: nao encontrei o instalador em '$resolvedOutput'."
}
if (-not (Test-Path $appExe)) {
  throw "Smoke E2E falhou: nao encontrei o executavel empacotado '$appExe'."
}

node scripts\verify-packaged-main-syntax.js --output $resolvedOutput
if ($LASTEXITCODE -ne 0) {
  throw "Smoke E2E falhou: validacao de sintaxe do main empacotado falhou."
}

function Assert-ValidSignature {
  param([string]$PathToFile)

  $signature = Get-AuthenticodeSignature -FilePath $PathToFile
  if ($signature.Status -ne "Valid" -or -not $signature.SignerCertificate) {
    throw "Smoke E2E falhou: assinatura invalida para '$PathToFile'. Estado: $($signature.Status)."
  }
}

if (-not $SkipSignatureCheck) {
  Assert-ValidSignature -PathToFile $installer.FullName
  Assert-ValidSignature -PathToFile $appExe
}

$smokeLocalAppData = Join-Path $resolvedOutput ".smoke-localappdata"
$smokeDataRoot = Join-Path $smokeLocalAppData "KwanzaFolha"
$smokeProgramDataRoot = Join-Path $resolvedOutput ".smoke-programdata"
$smokeResultPath = Join-Path $resolvedOutput "smoke-e2e-result.json"

if (Test-Path $smokeResultPath) {
  Remove-Item -LiteralPath $smokeResultPath -Force -ErrorAction SilentlyContinue
}

if (Test-Path $smokeDataRoot) {
  Remove-Item -LiteralPath $smokeDataRoot -Recurse -Force -ErrorAction SilentlyContinue
}
if (Test-Path $smokeProgramDataRoot) {
  Remove-Item -LiteralPath $smokeProgramDataRoot -Recurse -Force -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Path $smokeLocalAppData -Force | Out-Null
New-Item -ItemType Directory -Path $smokeProgramDataRoot -Force | Out-Null

$originalEnv = @{
  KWANZA_SMOKE_E2E = [Environment]::GetEnvironmentVariable("KWANZA_SMOKE_E2E", "Process")
  KWANZA_SMOKE_OUTPUT_PATH = [Environment]::GetEnvironmentVariable("KWANZA_SMOKE_OUTPUT_PATH", "Process")
  KWANZA_DEV_LICENSE_MODE = [Environment]::GetEnvironmentVariable("KWANZA_DEV_LICENSE_MODE", "Process")
  LOCALAPPDATA = [Environment]::GetEnvironmentVariable("LOCALAPPDATA", "Process")
  ProgramData = [Environment]::GetEnvironmentVariable("ProgramData", "Process")
}

[Environment]::SetEnvironmentVariable("KWANZA_SMOKE_E2E", "1", "Process")
[Environment]::SetEnvironmentVariable("KWANZA_SMOKE_OUTPUT_PATH", $smokeResultPath, "Process")
[Environment]::SetEnvironmentVariable("KWANZA_DEV_LICENSE_MODE", "", "Process")
[Environment]::SetEnvironmentVariable("LOCALAPPDATA", $smokeLocalAppData, "Process")
[Environment]::SetEnvironmentVariable("ProgramData", $smokeProgramDataRoot, "Process")

$process = $null
try {
  $process = Start-Process -FilePath $appExe -WorkingDirectory (Split-Path $appExe -Parent) -PassThru
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

  while ((Get-Date) -lt $deadline) {
    if (Test-Path $smokeResultPath) {
      break
    }
    if ($process.HasExited) {
      break
    }
    Start-Sleep -Seconds 1
  }

  if (-not (Test-Path $smokeResultPath)) {
    if ($process -and -not $process.HasExited) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
    throw "Smoke E2E falhou: relatorio nao foi gerado em '$smokeResultPath' dentro do timeout (${TimeoutSeconds}s)."
  }

  $report = Get-Content -Path $smokeResultPath -Raw -ErrorAction Stop | ConvertFrom-Json
  if (-not $report.ok) {
    $errorDetail = [string]($report.error)
    throw "Smoke E2E falhou no cenario funcional: $errorDetail"
  }

  $requiredSteps = @(
    "license",
    "login",
    "employee-create",
    "attendance-close",
    "payroll-process",
    "exports"
  )

  foreach ($requiredStep in $requiredSteps) {
    $stepOk = $report.steps | Where-Object { $_.step -eq $requiredStep -and $_.ok -eq $true } | Select-Object -First 1
    if (-not $stepOk) {
      throw "Smoke E2E falhou: etapa obrigatoria '$requiredStep' nao foi concluida."
    }
  }

  if ($process -and -not $process.HasExited) {
    Wait-Process -Id $process.Id -Timeout 15 -ErrorAction SilentlyContinue
  }
  if ($process -and -not $process.HasExited) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  }

  if ($process -and $process.HasExited -and $process.ExitCode -ne 0) {
    throw "Smoke E2E falhou: executavel terminou com exit code $($process.ExitCode)."
  }

  Write-Host "Smoke E2E empacotado concluido com sucesso." -ForegroundColor Green
  if ($report.artifacts) {
    Write-Host ("Artefactos validados: " + (($report.artifacts.PSObject.Properties | ForEach-Object { $_.Value }) -join ", ")) -ForegroundColor DarkGreen
  }
} finally {
  foreach ($key in $originalEnv.Keys) {
    [Environment]::SetEnvironmentVariable($key, $originalEnv[$key], "Process")
  }
}
