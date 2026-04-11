Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$buildDir = Join-Path $root "build"
$sourcePath = Join-Path $buildDir "Folha.png"

if (-not (Test-Path $sourcePath)) {
  throw "Nao encontrei o ficheiro de icone em build\Folha.png."
}

function Save-Ico([System.Drawing.Bitmap]$bitmap, [string]$path) {
  $icon = [System.Drawing.Icon]::FromHandle($bitmap.GetHicon())
  $stream = [System.IO.File]::Create($path)
  try {
    $icon.Save($stream)
  } finally {
    $stream.Dispose()
    $icon.Dispose()
  }
}

function Get-CoverRectangle([int]$sourceWidth, [int]$sourceHeight) {
  if ($sourceWidth -eq $sourceHeight) {
    return [System.Drawing.Rectangle]::new(0, 0, $sourceWidth, $sourceHeight)
  }

  if ($sourceWidth -gt $sourceHeight) {
    $offsetX = [int](($sourceWidth - $sourceHeight) / 2)
    return [System.Drawing.Rectangle]::new($offsetX, 0, $sourceHeight, $sourceHeight)
  }

  $offsetY = [int](($sourceHeight - $sourceWidth) / 2)
  return [System.Drawing.Rectangle]::new(0, $offsetY, $sourceWidth, $sourceWidth)
}

$sourceImage = [System.Drawing.Image]::FromFile($sourcePath)
try {
  $iconSize = 256
  $iconBitmap = New-Object System.Drawing.Bitmap $iconSize, $iconSize
  $graphics = [System.Drawing.Graphics]::FromImage($iconBitmap)
  try {
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    $sourceRect = Get-CoverRectangle $sourceImage.Width $sourceImage.Height
    $targetRect = [System.Drawing.Rectangle]::new(0, 0, $iconSize, $iconSize)
    $graphics.DrawImage($sourceImage, $targetRect, $sourceRect, [System.Drawing.GraphicsUnit]::Pixel)
  } finally {
    $graphics.Dispose()
  }

  Save-Ico $iconBitmap (Join-Path $buildDir "icon.ico")
  Save-Ico $iconBitmap (Join-Path $buildDir "installerIcon.ico")
  Save-Ico $iconBitmap (Join-Path $buildDir "uninstallerIcon.ico")
  $iconBitmap.Dispose()
} finally {
  $sourceImage.Dispose()
}

Write-Host "Icones sincronizados a partir de build\\Folha.png." -ForegroundColor Green
