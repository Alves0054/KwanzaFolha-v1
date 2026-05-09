$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$buildDir = Join-Path $root "build"
$assetsDir = Join-Path $root "assets"
$assetIconsDir = Join-Path $assetsDir "icons"

$sourceIcon = Join-Path $assetsDir "icon.ico"
$sourceInstallerIcon = Join-Path $assetIconsDir "installerIcon.ico"
$sourceUninstallerIcon = Join-Path $assetIconsDir "uninstallerIcon.ico"

if (-not (Test-Path $sourceIcon)) {
  throw "Nao encontrei o icone original em assets\icon.ico."
}

if (-not (Test-Path $sourceInstallerIcon)) {
  $sourceInstallerIcon = $sourceIcon
}

if (-not (Test-Path $sourceUninstallerIcon)) {
  $sourceUninstallerIcon = $sourceIcon
}

Copy-Item -LiteralPath $sourceIcon -Destination (Join-Path $buildDir "icon.ico") -Force
Copy-Item -LiteralPath $sourceInstallerIcon -Destination (Join-Path $buildDir "installerIcon.ico") -Force
Copy-Item -LiteralPath $sourceUninstallerIcon -Destination (Join-Path $buildDir "uninstallerIcon.ico") -Force

Write-Host "Icones originais copiados para a build sem recriar cores." -ForegroundColor Green
