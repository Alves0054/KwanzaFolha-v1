param(
  [ValidateSet("installer", "all")]
  [string]$Target = "all",
  [string]$CertificatePath = "",
  [string]$CertificatePassword = "",
  [string]$TimestampServer = "https://timestamp.digicert.com",
  [bool]$AllowUnsignedTimestamp = $false
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
    if ($candidate -and -not ($candidate -match "^(https?|data):") -and (Test-Path $candidate)) {
      return @{
        Path = (Resolve-Path $candidate).Path
        IsTemporary = $false
      }
    }
  }

  if ($env:KWANZA_CERTIFICATE_BASE64) {
    $tempPath = Join-Path $env:TEMP "kwanza-code-signing-$([guid]::NewGuid().ToString('N')).p12"
    try {
      [System.IO.File]::WriteAllBytes($tempPath, [Convert]::FromBase64String($env:KWANZA_CERTIFICATE_BASE64))
    } catch {
      throw "KWANZA_CERTIFICATE_BASE64 invalido ou corrompido. Grave no secret apenas o conteudo Base64 puro do .p12."
    }
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

function Resolve-CertificateThumbprint {
  param([string]$CertPath)

  try {
    $cert = Get-PfxCertificate -FilePath $CertPath -ErrorAction Stop
    if ($cert -and $cert.Thumbprint) {
      return ($cert.Thumbprint -replace "\s", "").ToUpperInvariant()
    }
  } catch {}

  try {
    $match = Get-ChildItem Cert:\CurrentUser\My -ErrorAction SilentlyContinue |
      Where-Object { $_.Subject -match "CN=KwanzaPro" } |
      Sort-Object NotAfter -Descending |
      Select-Object -First 1
    if ($match -and $match.Thumbprint) {
      return ($match.Thumbprint -replace "\s", "").ToUpperInvariant()
    }
  } catch {}

  return ""
}

function Resolve-TimestampServers {
  param([string]$PrimaryServer)

  $servers = @(
    $PrimaryServer,
    "https://timestamp.digicert.com",
    "http://timestamp.sectigo.com",
    "http://timestamp.globalsign.com/tsa/r6advanced1"
  ) | Where-Object { $_ -and $_.Trim() } | ForEach-Object { $_.Trim() }

  $unique = New-Object System.Collections.Generic.List[string]
  foreach ($server in $servers) {
    if (-not $unique.Contains($server)) {
      $null = $unique.Add($server)
    }
  }

  return $unique
}

function Get-SignToolPath {
  $candidates = New-Object System.Collections.Generic.List[string]
  $staticCandidates = @(
    "$env:LOCALAPPDATA\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0\windows-10\x64\signtool.exe",
    "C:\Program Files (x86)\Windows Kits\10\App Certification Kit\signtool.exe"
  )
  foreach ($candidate in $staticCandidates) {
    if ($candidate -and -not $candidates.Contains($candidate)) {
      $null = $candidates.Add($candidate)
    }
  }

  $sdkMatches = Get-ChildItem -Path "C:\Program Files (x86)\Windows Kits\10\bin\*\x64\signtool.exe" -File -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending |
    Select-Object -ExpandProperty FullName
  foreach ($candidate in $sdkMatches) {
    if ($candidate -and -not $candidates.Contains($candidate)) {
      $null = $candidates.Add($candidate)
    }
  }

  $pathCommand = Get-Command signtool.exe -ErrorAction SilentlyContinue
  if ($pathCommand -and $pathCommand.Source -and -not $candidates.Contains($pathCommand.Source)) {
    $null = $candidates.Add($pathCommand.Source)
  }

  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) {
      return $candidate
    }
  }

  throw "Nao encontrei signtool.exe para assinatura manual."
}

function Get-ExpectedArtifacts {
  param(
    [string]$OutputDir,
    [string]$TargetName
  )

  $patterns = switch ($TargetName) {
    "installer" { @("KwanzaFolha-Setup-*.exe", "win-unpacked\Kwanza Folha.exe") }
    default { @("KwanzaFolha-Setup-*.exe", "win-unpacked\Kwanza Folha.exe") }
  }

  $files = @()
  foreach ($pattern in $patterns) {
    $matches = Get-ChildItem -Path (Join-Path $OutputDir $pattern) -File -ErrorAction SilentlyContinue
    if (-not $matches -or $matches.Count -eq 0) {
      throw "Nao encontrei artefactos esperados para o padrao '$pattern' em '$OutputDir'."
    }
    $files += $matches
  }

  if (-not $files.Count) {
    throw "Nao encontrei os artefactos esperados em '$OutputDir' depois da build assinada."
  }

  return $files | Sort-Object FullName -Unique
}

function Get-SigningTargets {
  param(
    [array]$ExpectedArtifacts,
    [string]$OutputDir
  )

  $targets = New-Object System.Collections.Generic.List[string]
  foreach ($artifact in $ExpectedArtifacts) {
    if (-not $targets.Contains($artifact.FullName)) {
      $null = $targets.Add($artifact.FullName)
    }
  }

  foreach ($extra in @(
    (Join-Path $OutputDir "__uninstaller-nsis-kwanza-folha.exe"),
    (Join-Path $OutputDir "win-unpacked\resources\elevate.exe")
  )) {
    if ((Test-Path $extra) -and -not $targets.Contains($extra)) {
      $null = $targets.Add($extra)
    }
  }

  return $targets
}

function Sign-WithFallback {
  param(
    [string]$SignToolPath,
    [string]$FilePath,
    [string]$CertPath,
    [string]$CertPassword,
    [string]$CertThumbprint,
    [System.Collections.Generic.List[string]]$TimestampServers,
    [bool]$AllowMissingTimestamp
  )

  foreach ($server in $TimestampServers) {
    & $SignToolPath sign /fd SHA256 /t $server /f $CertPath /p $CertPassword /d "Kwanza Folha" /du "https://github.com/Alves0054/KwanzaFolha" $FilePath
    if ($LASTEXITCODE -eq 0) {
      return @{ Signed = $true; Timestamped = $true; TimestampServer = $server }
    }

    if ($CertThumbprint) {
      & $SignToolPath sign /fd SHA256 /t $server /sha1 $CertThumbprint /d "Kwanza Folha" /du "https://github.com/Alves0054/KwanzaFolha" $FilePath
      if ($LASTEXITCODE -eq 0) {
        return @{ Signed = $true; Timestamped = $true; TimestampServer = $server }
      }
    }
  }

  if ($AllowMissingTimestamp) {
    & $SignToolPath sign /fd SHA256 /f $CertPath /p $CertPassword /d "Kwanza Folha" /du "https://github.com/Alves0054/KwanzaFolha" $FilePath
    if ($LASTEXITCODE -eq 0) {
      return @{ Signed = $true; Timestamped = $false; TimestampServer = "" }
    }

    if ($CertThumbprint) {
      & $SignToolPath sign /fd SHA256 /sha1 $CertThumbprint /d "Kwanza Folha" /du "https://github.com/Alves0054/KwanzaFolha" $FilePath
      if ($LASTEXITCODE -eq 0) {
        return @{ Signed = $true; Timestamped = $false; TimestampServer = "" }
      }
    }
  }

  return @{ Signed = $false; Timestamped = $false; TimestampServer = "" }
}

function Assert-SignedArtifact {
  param(
    [string]$ArtifactPath,
    [bool]$RequireTimestamp
  )

  $signature = Get-AuthenticodeSignature -FilePath $ArtifactPath
  if ($signature.Status -ne "Valid" -or -not $signature.SignerCertificate) {
    throw "A assinatura digital do artefacto '$ArtifactPath' nao esta valida. Estado: $($signature.Status)."
  }
  if ($RequireTimestamp -and -not $signature.TimeStamperCertificate) {
    throw "O artefacto '$ArtifactPath' esta assinado mas sem timestamp."
  }
}

$root = Split-Path -Parent $PSScriptRoot
$outputDir = Join-Path $root "dist-electron"
$certificate = Resolve-CertificatePath -PreferredPath $CertificatePath
$resolvedPassword = Resolve-CertificatePassword -PreferredPassword $CertificatePassword
$certificateThumbprint = Resolve-CertificateThumbprint -CertPath $certificate.Path
$timestampServers = Resolve-TimestampServers -PrimaryServer $TimestampServer

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
  $env:CSC_TIMESTAMP_URL = $timestampServers[0]

  $buildError = $null
  try {
    switch ($Target) {
      "installer" { npm run build:installer }
      default { npm run build:installer }
    }
  } catch {
    $buildError = $_
    Write-Warning "A build reportou falha durante assinatura automatica. Vou aplicar assinatura manual com fallback."
  }

  $expectedArtifacts = Get-ExpectedArtifacts -OutputDir $outputDir -TargetName $Target
  $signingTargets = Get-SigningTargets -ExpectedArtifacts $expectedArtifacts -OutputDir $outputDir
  $signToolPath = Get-SignToolPath

  foreach ($targetPath in $signingTargets) {
    $result = Sign-WithFallback `
      -SignToolPath $signToolPath `
      -FilePath $targetPath `
      -CertPath $certificate.Path `
      -CertPassword $resolvedPassword `
      -CertThumbprint $certificateThumbprint `
      -TimestampServers $timestampServers `
      -AllowMissingTimestamp $AllowUnsignedTimestamp

    if (-not $result.Signed) {
      throw "Falhou a assinatura manual do artefacto '$targetPath'."
    }

    if ($result.Timestamped) {
      Write-Host "Assinado com timestamp em '$targetPath' via $($result.TimestampServer)." -ForegroundColor Green
    } else {
      Write-Warning "Assinado sem timestamp em '$targetPath'."
    }
  }

  foreach ($artifact in $expectedArtifacts) {
    Assert-SignedArtifact -ArtifactPath $artifact.FullName -RequireTimestamp (-not $AllowUnsignedTimestamp)
  }

  if ($buildError) {
    Write-Warning "A build terminou com fallback manual de assinatura. Verifique os logs se precisar de diagnostico adicional."
  }

  Write-Host "Assinatura validada em $($expectedArtifacts.Count) artefacto(s)." -ForegroundColor Green
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
