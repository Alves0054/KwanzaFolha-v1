param(
  [ValidateSet("installer", "all")]
  [string]$Target = "all",
  [string]$CertificatePath = "",
  [string]$CertificatePassword = "",
  [string]$TimestampServer = "https://timestamp.digicert.com"
)

$ErrorActionPreference = "Stop"

function Resolve-CertificatePath {
  param([string]$PreferredPath)

  if ($PreferredPath -and (Test-Path $PreferredPath)) {
    return @{
      Path = (Resolve-Path $PreferredPath).Path
      IsTemporary = $false
    }
  }

  foreach ($candidate in @($env:KWANZA_CERTIFICATE_PATH, $env:WIN_CSC_LINK, $env:CSC_LINK)) {
    if ($candidate -and -not ($candidate -match '^(https?|data):') -and (Test-Path $candidate)) {
      return @{
        Path = (Resolve-Path $candidate).Path
        IsTemporary = $false
      }
    }
  }

  if ($env:KWANZA_CERTIFICATE_BASE64) {
    $tempPath = Join-Path $env:TEMP "kwanza-code-signing-$([guid]::NewGuid().ToString('N')).p12"
    [System.IO.File]::WriteAllBytes($tempPath, [Convert]::FromBase64String($env:KWANZA_CERTIFICATE_BASE64))
    return @{
      Path = $tempPath
      IsTemporary = $true
    }
  }

  throw "Nao encontrei um certificado de assinatura. Defina -CertificatePath, KWANZA_CERTIFICATE_PATH ou KWANZA_CERTIFICATE_BASE64."
}

function Resolve-CertificatePassword {
  param([string]$PreferredPassword)

  if ($PreferredPassword) {
    return $PreferredPassword
  }

  foreach ($candidate in @($env:KWANZA_CERTIFICATE_PASSWORD, $env:WIN_CSC_KEY_PASSWORD, $env:CSC_KEY_PASSWORD)) {
    if ($candidate) {
      return $candidate
    }
  }

  throw "Indique a palavra-passe do certificado com -CertificatePassword ou defina KWANZA_CERTIFICATE_PASSWORD."
}

function Get-ExpectedArtifacts {
  param(
    [string]$OutputDir,
    [string]$TargetName
  )

  $patterns = switch ($TargetName) {
    "installer" { @("KwanzaFolha-Setup-*.exe", "win-unpacked\\Kwanza Folha.exe") }
    default { @("KwanzaFolha-Setup-*.exe", "win-unpacked\\Kwanza Folha.exe") }
  }

  $files = @()
  foreach ($pattern in $patterns) {
    $files += Get-ChildItem -Path (Join-Path $OutputDir $pattern) -File -ErrorAction SilentlyContinue
  }

  if (-not $files.Count) {
    throw "Nao encontrei os artefactos esperados em '$OutputDir' depois da build assinada."
  }

  return $files | Sort-Object FullName -Unique
}

function Assert-SignedArtifact {
  param([string]$ArtifactPath)

  $signature = Get-AuthenticodeSignature -FilePath $ArtifactPath
  if ($signature.Status -ne "Valid" -or -not $signature.SignerCertificate) {
    throw "A assinatura digital do artefacto '$ArtifactPath' nao esta valida. Estado: $($signature.Status)."
  }
}

$root = Split-Path -Parent $PSScriptRoot
$outputDir = Join-Path $root "dist-electron"
$certificate = Resolve-CertificatePath -PreferredPath $CertificatePath
$resolvedPassword = Resolve-CertificatePassword -PreferredPassword $CertificatePassword

Set-Location $root

try {
  $env:CSC_LINK = $certificate.Path
  $env:CSC_KEY_PASSWORD = $resolvedPassword
  $env:WIN_CSC_LINK = $certificate.Path
  $env:WIN_CSC_KEY_PASSWORD = $resolvedPassword
  $env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
  $env:USE_HARD_LINKS = "false"
  $env:ELECTRON_BUILDER_ALLOW_UNRESOLVED_DEPENDENCIES = "true"
  $env:WIN_SIGNING_HASH_ALGORITHMS = "sha256"
  $env:CSC_TIMESTAMP_URL = $TimestampServer

  switch ($Target) {
    "installer" {
      npm run build:installer
    }
    default {
      npm run build:installer
    }
  }

  $artifacts = Get-ExpectedArtifacts -OutputDir $outputDir -TargetName $Target
  foreach ($artifact in $artifacts) {
    Assert-SignedArtifact -ArtifactPath $artifact.FullName
  }

  Write-Host "Assinatura validada em $($artifacts.Count) artefacto(s)." -ForegroundColor Green
} finally {
  foreach ($envName in @(
    "CSC_LINK",
    "CSC_KEY_PASSWORD",
    "WIN_CSC_LINK",
    "WIN_CSC_KEY_PASSWORD",
    "CSC_IDENTITY_AUTO_DISCOVERY",
    "USE_HARD_LINKS",
    "ELECTRON_BUILDER_ALLOW_UNRESOLVED_DEPENDENCIES",
    "WIN_SIGNING_HASH_ALGORITHMS",
    "CSC_TIMESTAMP_URL"
  )) {
    Remove-Item "Env:$envName" -ErrorAction SilentlyContinue
  }

  if ($certificate.IsTemporary -and (Test-Path $certificate.Path)) {
    Remove-Item -LiteralPath $certificate.Path -Force -ErrorAction SilentlyContinue
  }
}
