param(
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$targets = @(
  ".tmp-boot",
  ".tmp-electron-boot",
  ".tmp-secure-machine",
  ".tmp-secure-user",
  "electron-run.err.log",
  "electron-run.out.log",
  "packaged-run.err.log",
  "packaged-run.out.log",
  "artifacts-payroll.sqlite"
)

$artifactPatterns = @(
  "artifacts/activate-test.json",
  "artifacts/cron-line.txt",
  "artifacts/kwanza-folha-debug.sqlite",
  "artifacts/licensing-server-cloud",
  "artifacts/licensing-server-cloud.zip",
  "artifacts/payment-create.json",
  "artifacts/payment-status.json",
  "artifacts/remote-proxy",
  "artifacts/remote-start-screen.sh",
  "artifacts/set-license-cron.sh",
  "artifacts/update-remote-settings.js"
)

function Remove-Target([string]$relativePath) {
  $fullPath = Join-Path $root $relativePath
  if (-not (Test-Path $fullPath)) {
    return
  }

  if ($DryRun) {
    Write-Host "[DRY-RUN] remove $relativePath"
    return
  }

  Remove-Item -LiteralPath $fullPath -Recurse -Force
  Write-Host "[OK] removed $relativePath"
}

foreach ($target in $targets) {
  Remove-Target $target
}

foreach ($pattern in $artifactPatterns) {
  Get-ChildItem -Path (Join-Path $root $pattern) -Force -ErrorAction SilentlyContinue | ForEach-Object {
    $relativePath = Resolve-Path -Relative $_.FullName
    Remove-Target $relativePath
  }
}

Get-ChildItem -Path (Join-Path $root "artifacts") -Directory -Recurse -ErrorAction SilentlyContinue |
  Sort-Object { $_.FullName.Length } -Descending |
  ForEach-Object {
    if (-not (Get-ChildItem -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue)) {
      if ($DryRun) {
        Write-Host "[DRY-RUN] remove empty $($_.FullName)"
      } else {
        Remove-Item -LiteralPath $_.FullName -Force
        Write-Host "[OK] removed empty $($_.FullName)"
      }
    }
  }

Write-Host "Workspace cleanup finished."
