param(
  [string]$OutputDir = "dist-electron",
  [string]$LocalAppDataRoot = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$resolvedOutput = (Resolve-Path $OutputDir -ErrorAction Stop).Path
$effectiveLocalAppData = if ([string]::IsNullOrWhiteSpace($LocalAppDataRoot)) {
  $env:LOCALAPPDATA
} else {
  (Resolve-Path $LocalAppDataRoot -ErrorAction Stop).Path
}

$logDir = Join-Path $effectiveLocalAppData "KwanzaFolha\logs"
$mainLogPath = Join-Path $logDir "main.log"
$bootstrapFatalPath = Join-Path $logDir "bootstrap-fatal.log"
$smokeResultPath = Join-Path $resolvedOutput "smoke-e2e-result.json"
$reportPath = Join-Path $resolvedOutput "boot-integrity-report.json"
$diagnosticsLogDir = Join-Path $resolvedOutput "diagnostics-logs"

New-Item -ItemType Directory -Path $diagnosticsLogDir -Force | Out-Null

$mainLog = if (Test-Path $mainLogPath) { Get-Content -Path $mainLogPath -Raw -ErrorAction Stop } else { "" }
$bootstrapFatal = if (Test-Path $bootstrapFatalPath) { Get-Content -Path $bootstrapFatalPath -Raw -ErrorAction Stop } else { "" }
$smokeResult = if (Test-Path $smokeResultPath) { Get-Content -Path $smokeResultPath -Raw -ErrorAction Stop | ConvertFrom-Json } else { $null }

$copiedMainLogPath = ""
if (Test-Path $mainLogPath) {
  $copiedMainLogPath = Join-Path $diagnosticsLogDir "main.log"
  Copy-Item -LiteralPath $mainLogPath -Destination $copiedMainLogPath -Force
}

$copiedBootstrapFatalPath = ""
if (Test-Path $bootstrapFatalPath) {
  $copiedBootstrapFatalPath = Join-Path $diagnosticsLogDir "bootstrap-fatal.log"
  Copy-Item -LiteralPath $bootstrapFatalPath -Destination $copiedBootstrapFatalPath -Force
}

$bootStages = @(
  "[BOOT] starting app",
  "[BOOT] loading secure storage",
  "[BOOT] loading installation identity",
  "[BOOT] loading anti-tamper",
  "[BOOT] verifying executable signature",
  "[BOOT] verifying module integrity",
  "[BOOT] initializing application services",
  "[BOOT] registering ipc",
  "[BOOT] creating window",
  "[BOOT] startup sequence finished"
)

$bootStageStatus = @{}
foreach ($stage in $bootStages) {
  $bootStageStatus[$stage] = $mainLog -match [Regex]::Escape($stage)
}

$fallbackLines = @()
if ($mainLog) {
  $fallbackLines = $mainLog -split "`r?`n" | Where-Object { $_ -match "\[BOOT\]\[FALLBACK\]" }
}

$report = [ordered]@{
  generated_at = (Get-Date).ToString("o")
  paths = [ordered]@{
    local_appdata = $effectiveLocalAppData
    log_dir = $logDir
    main_log = $mainLogPath
    bootstrap_fatal_log = $bootstrapFatalPath
    smoke_result = $smokeResultPath
    report = $reportPath
    diagnostics_log_dir = $diagnosticsLogDir
    copied_main_log = $copiedMainLogPath
    copied_bootstrap_fatal_log = $copiedBootstrapFatalPath
  }
  files_present = [ordered]@{
    main_log = [bool](Test-Path $mainLogPath)
    bootstrap_fatal_log = [bool](Test-Path $bootstrapFatalPath)
    smoke_result = [bool](Test-Path $smokeResultPath)
  }
  boot_stage_status = $bootStageStatus
  fallback_count = @($fallbackLines).Count
  fallback_lines = @($fallbackLines | Select-Object -Last 50)
  startup_finished = ($mainLog -match "\[BOOT\] startup sequence finished")
  smoke_ok = [bool]($smokeResult -and $smokeResult.ok)
  smoke_steps = if ($smokeResult) { $smokeResult.steps } else { @() }
  bootstrap_fatal_excerpt = if ($bootstrapFatal) { ($bootstrapFatal -split "`r?`n" | Select-Object -Last 80) } else { @() }
  main_log_tail = if ($mainLog) { ($mainLog -split "`r?`n" | Select-Object -Last 200) } else { @() }
}

$report | ConvertTo-Json -Depth 12 | Set-Content -Path $reportPath -Encoding UTF8
Write-Host "Relatorio de boot/integridade gerado em '$reportPath'." -ForegroundColor Green
