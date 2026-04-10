param(
  [string]$CertificatePath = "C:\cert\kwanzapro.p12",
  [string]$OutputDir = "",
  [switch]$CopyBase64ToClipboard
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $CertificatePath)) {
  throw "Nao encontrei o certificado em '$CertificatePath'."
}

$resolvedCertificatePath = (Resolve-Path $CertificatePath).Path
$targetDir = if ($OutputDir) { $OutputDir } else { Join-Path $env:TEMP "kwanza-signing-secrets" }
New-Item -ItemType Directory -Path $targetDir -Force | Out-Null

$base64Value = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($resolvedCertificatePath))
$base64Path = Join-Path $targetDir "KWANZA_CERTIFICATE_BASE64.txt"
$instructionsPath = Join-Path $targetDir "github-secrets-instructions.txt"

[System.IO.File]::WriteAllText($base64Path, $base64Value, [System.Text.Encoding]::UTF8)

$instructions = @"
1. Guarde o conteudo de '$base64Path' como valor do segredo KWANZA_CERTIFICATE_BASE64.
2. Guarde a palavra-passe do ficheiro P12 como valor do segredo KWANZA_CERTIFICATE_PASSWORD.
3. Na GitHub Actions, publique a release com a workflow em '.github/workflows/release.yml'.
4. Nao grave estes valores no repositorio, em ficheiros versionados ou em logs.
"@

[System.IO.File]::WriteAllText($instructionsPath, $instructions, [System.Text.Encoding]::UTF8)

if ($CopyBase64ToClipboard) {
  Set-Clipboard -Value $base64Value
}

Write-Host "Certificado convertido com sucesso." -ForegroundColor Green
Write-Host "Base64: $base64Path"
Write-Host "Instrucoes: $instructionsPath"
if ($CopyBase64ToClipboard) {
  Write-Host "O valor base64 tambem foi copiado para a area de transferencia."
}
