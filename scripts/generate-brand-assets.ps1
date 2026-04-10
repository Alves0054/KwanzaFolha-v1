Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$buildDir = Join-Path $root "build"
$srcAssetsDir = Join-Path $root "src\assets"
$sourceLogoPath = Join-Path $buildDir "logo.png"

New-Item -ItemType Directory -Force -Path $buildDir | Out-Null
New-Item -ItemType Directory -Force -Path $srcAssetsDir | Out-Null

if (-not (Test-Path $sourceLogoPath)) {
  throw "Nao encontrei o logo oficial em build\logo.png."
}

function New-Bitmap([int]$width, [int]$height) {
  return New-Object System.Drawing.Bitmap $width, $height
}

function Save-Png([System.Drawing.Image]$image, [string]$path) {
  $image.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
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

function Save-Bmp([System.Drawing.Image]$image, [string]$path) {
  $image.Save($path, [System.Drawing.Imaging.ImageFormat]::Bmp)
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

function New-BrushGradient([string]$startHex, [string]$endHex, [int]$width, [int]$height) {
  $rect = [System.Drawing.Rectangle]::new(0, 0, $width, $height)
  return New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $rect,
    [System.Drawing.ColorTranslator]::FromHtml($startHex),
    [System.Drawing.ColorTranslator]::FromHtml($endHex),
    90
  )
}

function Draw-CenteredLogo([System.Drawing.Graphics]$graphics, [System.Drawing.Image]$image, [int]$canvasWidth, [int]$canvasHeight, [int]$maxWidth, [int]$maxHeight) {
  $scale = [Math]::Min($maxWidth / $image.Width, $maxHeight / $image.Height)
  $drawWidth = [int]($image.Width * $scale)
  $drawHeight = [int]($image.Height * $scale)
  $x = [int](($canvasWidth - $drawWidth) / 2)
  $y = [int](($canvasHeight - $drawHeight) / 2)
  $graphics.DrawImage($image, $x, $y, $drawWidth, $drawHeight)
}

$logoImage = [System.Drawing.Image]::FromFile($sourceLogoPath)

try {
  $logoBitmap = New-Bitmap -width $logoImage.Width -height $logoImage.Height
  $logoGraphics = [System.Drawing.Graphics]::FromImage($logoBitmap)
  try {
    $logoGraphics.Clear([System.Drawing.Color]::Transparent)
    $logoGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $logoGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $logoGraphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $logoGraphics.DrawImage($logoImage, 0, 0, $logoImage.Width, $logoImage.Height)
  } finally {
    $logoGraphics.Dispose()
  }
  Save-Png $logoBitmap (Join-Path $srcAssetsDir "brand-logo.png")
  $logoBitmap.Dispose()

  $iconSize = 256
  $iconBitmap = New-Bitmap -width $iconSize -height $iconSize
  $iconGraphics = [System.Drawing.Graphics]::FromImage($iconBitmap)
  try {
    $iconGraphics.Clear([System.Drawing.Color]::Transparent)
    $iconGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $iconGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $iconGraphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $sourceRect = Get-CoverRectangle $logoImage.Width $logoImage.Height
    $targetRect = [System.Drawing.Rectangle]::new(0, 0, $iconSize, $iconSize)
    $iconGraphics.DrawImage($logoImage, $targetRect, $sourceRect, [System.Drawing.GraphicsUnit]::Pixel)
  } finally {
    $iconGraphics.Dispose()
  }

  Save-Png $iconBitmap (Join-Path $srcAssetsDir "brand-icon.png")
  Save-Ico $iconBitmap (Join-Path $buildDir "icon.ico")
  $iconBitmap.Dispose()

  $installerIconPath = Join-Path $buildDir "installerIcon.ico"
  $uninstallerIconPath = Join-Path $buildDir "uninstallerIcon.ico"
  Save-Ico ([System.Drawing.Bitmap]::FromFile((Join-Path $srcAssetsDir "brand-icon.png"))) $installerIconPath
  Save-Ico ([System.Drawing.Bitmap]::FromFile((Join-Path $srcAssetsDir "brand-icon.png"))) $uninstallerIconPath

  $headerWidth = 150
  $headerHeight = 57
  $headerBitmap = New-Bitmap -width $headerWidth -height $headerHeight
  $headerGraphics = [System.Drawing.Graphics]::FromImage($headerBitmap)
  try {
    $headerGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $headerGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $headerGraphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $brush = New-BrushGradient "#F4F8FF" "#DCEBFF" $headerWidth $headerHeight
    $headerGraphics.FillRectangle($brush, 0, 0, $headerWidth, $headerHeight)
    $brush.Dispose()
    Draw-CenteredLogo $headerGraphics $logoImage $headerWidth $headerHeight 110 34
  } finally {
    $headerGraphics.Dispose()
  }
  Save-Bmp $headerBitmap (Join-Path $buildDir "installerHeader.bmp")
  $headerBitmap.Dispose()

  $sidebarWidth = 164
  $sidebarHeight = 314
  $sidebarBitmap = New-Bitmap -width $sidebarWidth -height $sidebarHeight
  $sidebarGraphics = [System.Drawing.Graphics]::FromImage($sidebarBitmap)
  try {
    $sidebarGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $sidebarGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $sidebarGraphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $brush = New-BrushGradient "#0044CC" "#6FA8FF" $sidebarWidth $sidebarHeight
    $sidebarGraphics.FillRectangle($brush, 0, 0, $sidebarWidth, $sidebarHeight)
    $brush.Dispose()
    $overlay = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(36, 255, 255, 255))
    $sidebarGraphics.FillEllipse($overlay, -20, 210, 210, 110)
    $overlay.Dispose()
    Draw-CenteredLogo $sidebarGraphics $logoImage $sidebarWidth $sidebarHeight 118 118
  } finally {
    $sidebarGraphics.Dispose()
  }
  Save-Bmp $sidebarBitmap (Join-Path $buildDir "installerSidebar.bmp")
  Save-Bmp $sidebarBitmap (Join-Path $buildDir "uninstallerSidebar.bmp")
  $sidebarBitmap.Dispose()
} finally {
  $logoImage.Dispose()
}
