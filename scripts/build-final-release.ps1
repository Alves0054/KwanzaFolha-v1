param(
  [string]$Version = "",
  [switch]$SkipTests,
  [switch]$SkipBuild,
  [switch]$Signed
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not $Version) {
  $packageJson = Get-Content -Path "package.json" -Raw | ConvertFrom-Json
  $Version = [string]$packageJson.version
}

$releaseRoot = Join-Path $root "release"
$packageRoot = Join-Path $releaseRoot "Kwanza-Folha-v$Version"
$installerDir = Join-Path $packageRoot "installer"
$docsDir = Join-Path $packageRoot "docs"
$checksumsDir = Join-Path $packageRoot "checksums"

if (Test-Path $packageRoot) {
  Remove-Item -LiteralPath $packageRoot -Recurse -Force
}

New-Item -ItemType Directory -Path $installerDir -Force | Out-Null
New-Item -ItemType Directory -Path $docsDir -Force | Out-Null
New-Item -ItemType Directory -Path $checksumsDir -Force | Out-Null

if (-not $SkipTests) {
  npm run test:node:abi
}

if (-not $SkipBuild) {
  if ($Signed) {
    npm run build:installer
  } else {
    npm run build:installer:unsigned
  }
}

$installer = Get-ChildItem -Path "dist-electron" -Filter "KwanzaFolha-Setup-$Version.exe" -File -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $installer) {
  throw "Instalador KwanzaFolha-Setup-$Version.exe nao encontrado em dist-electron."
}

Copy-Item -LiteralPath $installer.FullName -Destination (Join-Path $installerDir $installer.Name) -Force

$blockMap = "$($installer.FullName).blockmap"
if (Test-Path $blockMap) {
  Copy-Item -LiteralPath $blockMap -Destination (Join-Path $installerDir (Split-Path $blockMap -Leaf)) -Force
}

Copy-Item -Path "docs\*" -Destination $docsDir -Recurse -Force
Copy-Item -LiteralPath "README.md" -Destination (Join-Path $packageRoot "README.md") -Force

$releaseNotesSource = "docs\entrega\RELEASE_NOTES.md"
if (Test-Path $releaseNotesSource) {
  Copy-Item -LiteralPath $releaseNotesSource -Destination (Join-Path $packageRoot "RELEASE_NOTES.md") -Force
}

$readmeEntregaSource = "docs\entrega\README_ENTREGA.md"
if (Test-Path $readmeEntregaSource) {
  Copy-Item -LiteralPath $readmeEntregaSource -Destination (Join-Path $packageRoot "README_ENTREGA.md") -Force
}

$checksumLines = @()
Get-ChildItem -Path $packageRoot -File -Recurse |
  Where-Object {
    $_.FullName -notlike "*\checksums\SHA256SUMS.txt" -and
    $_.FullName -notlike "*\docs\entrega\CHECKSUMS.md"
  } |
  Sort-Object FullName |
  ForEach-Object {
    $relative = Resolve-Path -LiteralPath $_.FullName -Relative
    $relative = $relative -replace "^\.\\release\\Kwanza-Folha-v$([regex]::Escape($Version))\\", ""
    $hash = Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName
    $checksumLines += "$($hash.Hash)  $relative"
  }

$checksumPath = Join-Path $checksumsDir "SHA256SUMS.txt"
$checksumLines | Set-Content -Path $checksumPath -Encoding UTF8
$packageDocsChecksumPath = Join-Path $docsDir "entrega\CHECKSUMS.md"
if (Test-Path (Split-Path $packageDocsChecksumPath -Parent)) {
  Copy-Item -LiteralPath $checksumPath -Destination $packageDocsChecksumPath -Force
}
Copy-Item -LiteralPath $checksumPath -Destination "docs\entrega\CHECKSUMS.md" -Force

$summary = [ordered]@{
  ok = $true
  version = $Version
  packagePath = $packageRoot
  installer = (Join-Path $installerDir $installer.Name)
  checksums = $checksumPath
  signed = [bool]$Signed
  fiscalValidationRequired = $true
  legalReviewRequired = $true
}

$summaryPath = Join-Path $packageRoot "release-summary.json"
$summary | ConvertTo-Json -Depth 4 | Set-Content -Path $summaryPath -Encoding UTF8

$summary | ConvertTo-Json -Depth 4
