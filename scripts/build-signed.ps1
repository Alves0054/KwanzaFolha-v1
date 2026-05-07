param(
  [ValidateSet("installer", "all")]
  [string]$Target = "all",
  [string]$CertificatePath = "",
  [string]$CertificateThumbprint = "",
  [string]$CertificatePassword = "",
  [string]$TimestampServer = "https://timestamp.digicert.com",
  [switch]$AllowUnsignedTimestamp
)

$ErrorActionPreference = "Stop"

function Resolve-CertificatePath {
  param(
    [string]$PreferredPath,
    [string]$PreferredThumbprint
  )

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
      throw "KWANZA_CERTIFICATE_BASE64 inválido ou corrompido. Grave no secret apenas o conteudo Base64 puro do .p12."
    }
    return @{
      Path = $tempPath
      IsTemporary = $true
    }
  }

  $storeThumbprint = @($PreferredThumbprint, $env:KWANZA_CERTIFICATE_THUMBPRINT, $env:KWANZA_AUTHENTICODE_THUMBPRINT) |
    Where-Object { $_ -and $_.Trim() } |
    Select-Object -First 1
  if ($storeThumbprint) {
    return @{
      Path = ""
      IsTemporary = $false
      StoreOnly = $true
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
  param(
    [string]$CertPath,
    [string]$CertPassword,
    [string]$PreferredThumbprint = ""
  )

  if ($PreferredThumbprint) {
    return ($PreferredThumbprint -replace "\s", "").ToUpperInvariant()
  }

  try {
    if ($CertPath -and $CertPassword) {
      $securePassword = ConvertTo-SecureString $CertPassword -AsPlainText -Force
      $pfxData = Get-PfxData -FilePath $CertPath -Password $securePassword -ErrorAction Stop
      $cert = $pfxData.EndEntityCertificates | Select-Object -First 1
    } elseif ($CertPath) {
      $cert = Get-PfxCertificate -FilePath $CertPath -ErrorAction Stop
    }
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

function Resolve-ConfiguredSignerThumbprint {
  param([string]$RootDir)

  $licenseSourcePath = Join-Path $RootDir "electron\config\license-source.js"
  if (-not (Test-Path $licenseSourcePath)) {
    return ""
  }

  try {
    $content = Get-Content -LiteralPath $licenseSourcePath -Raw
    $match = [regex]::Match($content, "expectedSignerThumbprint\s*:\s*[""']([A-Fa-f0-9\s]+)[""']")
    if ($match.Success) {
      return (($match.Groups[1].Value) -replace "\s", "").ToUpperInvariant()
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

function Get-PackagedRuntimeTargets {
  param([string]$OutputDir)

  $targets = New-Object System.Collections.Generic.List[string]
  foreach ($candidate in @(
    (Join-Path $OutputDir "win-unpacked\Kwanza Folha.exe"),
    (Join-Path $OutputDir "win-unpacked\resources\elevate.exe")
  )) {
    if ((Test-Path $candidate) -and -not $targets.Contains($candidate)) {
      $null = $targets.Add($candidate)
    }
  }

  return $targets
}

function Get-InstallerTargets {
  param([string]$OutputDir)

  $targets = New-Object System.Collections.Generic.List[string]
  foreach ($artifact in (Get-ChildItem -Path (Join-Path $OutputDir "KwanzaFolha-Setup-*.exe") -File -ErrorAction SilentlyContinue)) {
    if (-not $targets.Contains($artifact.FullName)) {
      $null = $targets.Add($artifact.FullName)
    }
  }
  foreach ($candidate in @((Join-Path $OutputDir "__uninstaller-nsis-kwanza-folha.exe"))) {
    if ((Test-Path $candidate) -and -not $targets.Contains($candidate)) {
      $null = $targets.Add($candidate)
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
    if ($CertPath) {
      & $SignToolPath sign /fd SHA256 /td SHA256 /tr $server /f $CertPath /p $CertPassword /d "Kwanza Folha" /du "https://github.com/Alves0054/KwanzaFolha-v1" $FilePath
      if ($LASTEXITCODE -eq 0) {
        return @{ Signed = $true; Timestamped = $true; TimestampServer = $server }
      }
    }

    if ($CertThumbprint) {
      & $SignToolPath sign /fd SHA256 /td SHA256 /tr $server /sha1 $CertThumbprint /d "Kwanza Folha" /du "https://github.com/Alves0054/KwanzaFolha-v1" $FilePath
      if ($LASTEXITCODE -eq 0) {
        return @{ Signed = $true; Timestamped = $true; TimestampServer = $server }
      }
    }

    if ($CertPath) {
      & $SignToolPath sign /fd SHA256 /t $server /f $CertPath /p $CertPassword /d "Kwanza Folha" /du "https://github.com/Alves0054/KwanzaFolha-v1" $FilePath
      if ($LASTEXITCODE -eq 0) {
        return @{ Signed = $true; Timestamped = $true; TimestampServer = $server }
      }
    }

    if ($CertThumbprint) {
      & $SignToolPath sign /fd SHA256 /t $server /sha1 $CertThumbprint /d "Kwanza Folha" /du "https://github.com/Alves0054/KwanzaFolha-v1" $FilePath
      if ($LASTEXITCODE -eq 0) {
        return @{ Signed = $true; Timestamped = $true; TimestampServer = $server }
      }
    }
  }

  if ($AllowMissingTimestamp) {
    if ($CertPath) {
      & $SignToolPath sign /fd SHA256 /f $CertPath /p $CertPassword /d "Kwanza Folha" /du "https://github.com/Alves0054/KwanzaFolha-v1" $FilePath
      if ($LASTEXITCODE -eq 0) {
        return @{ Signed = $true; Timestamped = $false; TimestampServer = "" }
      }
    }

    if ($CertThumbprint) {
      & $SignToolPath sign /fd SHA256 /sha1 $CertThumbprint /d "Kwanza Folha" /du "https://github.com/Alves0054/KwanzaFolha-v1" $FilePath
      if ($LASTEXITCODE -eq 0) {
        return @{ Signed = $true; Timestamped = $false; TimestampServer = "" }
      }
    }
  }

  return @{ Signed = $false; Timestamped = $false; TimestampServer = "" }
}

function Sign-Targets {
  param(
    [System.Collections.Generic.List[string]]$Targets,
    [string]$SignToolPath,
    [string]$CertPath,
    [string]$CertPassword,
    [string]$CertThumbprint,
    [System.Collections.Generic.List[string]]$TimestampServers,
    [bool]$AllowMissingTimestamp
  )

  foreach ($targetPath in $Targets) {
    $result = Sign-WithFallback `
      -SignToolPath $SignToolPath `
      -FilePath $targetPath `
      -CertPath $CertPath `
      -CertPassword $CertPassword `
      -CertThumbprint $CertThumbprint `
      -TimestampServers $TimestampServers `
      -AllowMissingTimestamp $AllowMissingTimestamp

    if (-not $result.Signed) {
      throw "Falhou a assinatura manual do artefacto '$targetPath'."
    }

    if ($result.Timestamped) {
      Write-Host "Assinado com timestamp em '$targetPath' via $($result.TimestampServer)." -ForegroundColor Green
    } else {
      Write-Warning "Assinado sem timestamp em '$targetPath'."
    }
  }
}

function Assert-SignedArtifact {
  param(
    [string]$ArtifactPath,
    [bool]$RequireTimestamp,
    [string]$ExpectedThumbprint
  )

  $signature = Get-AuthenticodeSignature -FilePath $ArtifactPath
  if (-not $signature.SignerCertificate) {
    throw "O artefacto '$ArtifactPath' nao tem certificado de assinatura (NotSigned)."
  }

  $status = [string]$signature.Status
  if ($status -eq "NotSigned" -or $status -eq "HashMismatch") {
    throw "A assinatura digital do artefacto '$ArtifactPath' nao esta valida. Estado: $status."
  }

  if ($ExpectedThumbprint) {
    $actualThumbprint = ($signature.SignerCertificate.Thumbprint -replace "\s", "").ToUpperInvariant()
    $expected = ($ExpectedThumbprint -replace "\s", "").ToUpperInvariant()
    if ($actualThumbprint -ne $expected) {
      throw "O artefacto '$ArtifactPath' foi assinado com um certificado inesperado. Thumbprint: $actualThumbprint."
    }
  }
  if ($RequireTimestamp -and -not $signature.TimeStamperCertificate) {
    throw "O artefacto '$ArtifactPath' esta assinado mas sem timestamp."
  }
}

$root = Split-Path -Parent $PSScriptRoot
$outputDir = Join-Path $root "dist-electron"
$requestedThumbprint = @($CertificateThumbprint, $env:KWANZA_CERTIFICATE_THUMBPRINT, $env:KWANZA_AUTHENTICODE_THUMBPRINT) |
  Where-Object { $_ -and $_.Trim() } |
  Select-Object -First 1
$configuredThumbprint = Resolve-ConfiguredSignerThumbprint -RootDir $root
$requestedThumbprint = @($requestedThumbprint, $configuredThumbprint) |
  Where-Object { $_ -and $_.Trim() } |
  Select-Object -First 1
$certificate = Resolve-CertificatePath -PreferredPath $CertificatePath -PreferredThumbprint $requestedThumbprint
$resolvedPassword = if ($certificate.Path) { Resolve-CertificatePassword -PreferredPassword $CertificatePassword } else { "" }
$certificateThumbprint = Resolve-CertificateThumbprint `
  -CertPath $certificate.Path `
  -CertPassword $resolvedPassword `
  -PreferredThumbprint $requestedThumbprint
$timestampServers = Resolve-TimestampServers -PrimaryServer $TimestampServer

Set-Location $root

try {
  if ($certificate.Path) {
    $env:CSC_LINK = $certificate.Path
    $env:CSC_KEY_PASSWORD = $resolvedPassword
    $env:WIN_CSC_LINK = $certificate.Path
    $env:WIN_CSC_KEY_PASSWORD = $resolvedPassword
  } elseif ($certificateThumbprint) {
    $env:CSC_NAME = $certificateThumbprint
    $env:WIN_CSC_NAME = $certificateThumbprint
  }
  $env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
  $env:USE_HARD_LINKS = "false"
  $env:ELECTRON_BUILDER_ALLOW_UNRESOLVED_DEPENDENCIES = "true"
  $env:WIN_SIGNING_HASH_ALGORITHMS = "sha256"
  $env:CSC_TIMESTAMP_URL = $timestampServers[0]

  $buildError = $null
  try {
    switch ($Target) {
      "installer" { npm run build:installer:unsigned }
      default { npm run build:installer:unsigned }
    }
    if ($LASTEXITCODE -ne 0) {
      throw "A build interna sem assinatura falhou com exit code $LASTEXITCODE."
    }
  } catch {
    $buildError = $_
    throw "A build comercial foi interrompida antes da assinatura: $($_.Exception.Message)"
  }

  $expectedArtifacts = Get-ExpectedArtifacts -OutputDir $outputDir -TargetName $Target
  $signToolPath = Get-SignToolPath

  $runtimeTargets = Get-PackagedRuntimeTargets -OutputDir $outputDir
  Sign-Targets `
    -Targets $runtimeTargets `
    -SignToolPath $signToolPath `
    -CertPath $certificate.Path `
    -CertPassword $resolvedPassword `
    -CertThumbprint $certificateThumbprint `
    -TimestampServers $timestampServers `
    -AllowMissingTimestamp $AllowUnsignedTimestamp

  .\node_modules\.bin\electron-builder.cmd --win nsis --prepackaged "dist-electron\win-unpacked"
  if ($LASTEXITCODE -ne 0) {
    throw "A recriacao do instalador a partir da pasta assinada falhou com exit code $LASTEXITCODE."
  }

  $installerTargets = Get-InstallerTargets -OutputDir $outputDir
  Sign-Targets `
    -Targets $installerTargets `
    -SignToolPath $signToolPath `
    -CertPath $certificate.Path `
    -CertPassword $resolvedPassword `
    -CertThumbprint $certificateThumbprint `
    -TimestampServers $timestampServers `
    -AllowMissingTimestamp $AllowUnsignedTimestamp

  foreach ($artifact in $expectedArtifacts) {
    Assert-SignedArtifact -ArtifactPath $artifact.FullName -RequireTimestamp (-not $AllowUnsignedTimestamp) -ExpectedThumbprint $certificateThumbprint
  }

  if ($buildError) {
    Write-Warning "A build terminou com fallback manual de assinatura. Verifique os logs se precisar de diagnostico adicional."
  }

  Write-Host "Assinatura validada em $($expectedArtifacts.Count) artefacto(s)." -ForegroundColor Green
} finally {
  foreach ($envName in @(
    "CSC_LINK",
    "CSC_KEY_PASSWORD",
    "CSC_NAME",
    "WIN_CSC_LINK",
    "WIN_CSC_KEY_PASSWORD",
    "WIN_CSC_NAME",
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
