param(
  [switch]$DryRun,
  [switch]$All
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

if ($All) {
  $targets += @(
    "dist",
    "dist-electron",
    "logs",
    "kwanza-folha.sqlite",
    "kwanza-folha.sqlite.enc",
    "kwanza-folha.runtime.sqlite",
    "licensing-server.local\\storage",
    "licensing-server.local\\config\\settings.json",
    ".env",
    ".env.local",
    ".env.production",
    ".env.development"
  )
}

$artifactPatterns = @(
  "artifacts/activate-test.json",
  "artifacts/cron-line.txt",
  "artifacts/kwanza-folha-debug.sqlite",
  "artifacts/payment-create.json",
  "artifacts/payment-status.json",
  "artifacts/remote-proxy",
  "artifacts/remote-start-screen.sh",
  "artifacts/set-license-cron.sh",
  "artifacts/update-remote-settings.js"
)

function Remove-Target([string]$relativePath) {
  if ($relativePath.StartsWith(".\\")) {
    $relativePath = $relativePath.Substring(2)
  }
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

if ($All) {
  $sensitiveNamePatterns = @(
    "*.sqlite",
    "*.sqlite.enc",
    "*.db",
    ".env",
    ".env.local",
    ".env.production",
    ".env.development",
    ".env.test",
    "*.p12",
    "*.pfx",
    "*.key",
    "license-private.pem"
  )

  Get-ChildItem -Path $root -Recurse -File -Force -ErrorAction SilentlyContinue |
    Where-Object {
      $_.FullName -notmatch "\\\\node_modules\\\\" -and
        $_.FullName -notmatch "\\\\.git\\\\" -and
        $_.FullName -notmatch "\\\\artifacts\\\\licensing-server-cloud\\\\"
    } |
    ForEach-Object {
      foreach ($pattern in $sensitiveNamePatterns) {
        if ($_.Name -like $pattern) {
          $relativePath = Resolve-Path -Relative $_.FullName
          Remove-Target $relativePath
          break
        }
      }
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
