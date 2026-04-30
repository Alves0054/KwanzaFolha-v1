param(
  [string]$OutputZipPath = "artifacts\\licensing-server-cloud.zip",
  [string]$LicensingServerDir = "licensing-server"
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$absoluteOutputZipPath = Join-Path $projectRoot $OutputZipPath
$bundleRoot = Join-Path $projectRoot "artifacts\\licensing-server-cloud"
$licensingServerRoot = Join-Path $projectRoot $LicensingServerDir

if (-not (Test-Path $licensingServerRoot)) {
  throw "Nao existe '$LicensingServerDir' no projeto. Crie a pasta '$LicensingServerDir' (versao para cloud) antes de gerar o pacote. Caminho esperado: $licensingServerRoot"
}

$serverEntryPoint = Join-Path $licensingServerRoot "server.js"
$deployDocPath = Join-Path $licensingServerRoot "DEPLOY-CLOUD.md"
$settingsExamplePath = Join-Path $licensingServerRoot "config\\settings.production.example.json"

if (-not (Test-Path $serverEntryPoint)) {
  throw "Entry point do servidor cloud nao encontrado: $serverEntryPoint"
}
if (-not (Test-Path $deployDocPath)) {
  throw "Documento de deploy cloud nao encontrado: $deployDocPath"
}
if (-not (Test-Path $settingsExamplePath)) {
  throw "Exemplo de settings de producao nao encontrado: $settingsExamplePath"
}

if (Test-Path $bundleRoot) {
  Remove-Item -LiteralPath $bundleRoot -Recurse -Force
}

New-Item -ItemType Directory -Path $bundleRoot | Out-Null
New-Item -ItemType Directory -Path (Join-Path $bundleRoot "licensing-server\\config") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $bundleRoot "shared") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $bundleRoot "shared\\domain") -Force | Out-Null

Copy-Item -LiteralPath $serverEntryPoint -Destination (Join-Path $bundleRoot "licensing-server\\server.js")
Copy-Item -LiteralPath $deployDocPath -Destination (Join-Path $bundleRoot "licensing-server\\DEPLOY-CLOUD.md")
Copy-Item -LiteralPath $settingsExamplePath -Destination (Join-Path $bundleRoot "licensing-server\\config\\settings.production.example.json")
Copy-Item -LiteralPath $settingsExamplePath -Destination (Join-Path $bundleRoot "licensing-server\\config\\settings.json")
Copy-Item -LiteralPath (Join-Path $projectRoot "shared\\license-plans.js") -Destination (Join-Path $bundleRoot "shared\\license-plans.js")
Copy-Item -LiteralPath (Join-Path $projectRoot "shared\\domain\\license-plans.js") -Destination (Join-Path $bundleRoot "shared\\domain\\license-plans.js")

$rootPackageJsonPath = Join-Path $projectRoot "package.json"
$rootPackage = Get-Content -LiteralPath $rootPackageJsonPath -Raw | ConvertFrom-Json

$minimalPackage = [ordered]@{
  name = "kwanza-licensing-server"
  private = $true
  type = "commonjs"
  version = "1.0.0"
  scripts = @{
    start = "node licensing-server/server.js"
  }
  dependencies = @{
    bcryptjs = $rootPackage.dependencies.bcryptjs
    "better-sqlite3" = $rootPackage.dependencies."better-sqlite3"
    nodemailer = $rootPackage.dependencies.nodemailer
    "pdf-lib" = $rootPackage.dependencies."pdf-lib"
  }
}

$minimalPackage | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $bundleRoot "package.json") -Encoding UTF8

$appShim = @'
// Shim para hosts cPanel/Passenger que preferem `app.js` como entrypoint.
require("./licensing-server/server.js");
'@
Set-Content -LiteralPath (Join-Path $bundleRoot "app.js") -Value $appShim -Encoding UTF8

$ecosystemConfig = @'
module.exports = {
  apps: [
    {
      name: "kwanza-license",
      cwd: ".",
      script: "licensing-server/server.js",
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
'@

Set-Content -LiteralPath (Join-Path $bundleRoot "ecosystem.config.cjs") -Value $ecosystemConfig -Encoding UTF8

$envExample = @'
KWANZA_LICENSE_PRIVATE_KEY_PATH=./licensing-server/storage/keys/license-private.pem
KWANZA_ADMIN_PASSWORD_HASH=
KWANZA_ADMIN_TOKEN_HASH=
KWANZA_WEBHOOK_SECRET=
KWANZA_SMTP_HOST=
KWANZA_SMTP_PORT=587
KWANZA_SMTP_SECURE=false
KWANZA_SMTP_USER=
KWANZA_SMTP_PASSWORD=
KWANZA_SMTP_FROM_NAME=Kwanza Folha
KWANZA_SMTP_FROM_EMAIL=
'@

Set-Content -LiteralPath (Join-Path $bundleRoot ".env.example") -Value $envExample -Encoding UTF8

if (Test-Path $absoluteOutputZipPath) {
  Remove-Item -LiteralPath $absoluteOutputZipPath -Force
}

$outputDirectory = Split-Path -Parent $absoluteOutputZipPath
if (!(Test-Path $outputDirectory)) {
  New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
}

Compress-Archive -Path (Join-Path $bundleRoot "*") -DestinationPath $absoluteOutputZipPath

Write-Output "Pacote cloud gerado em: $absoluteOutputZipPath"
