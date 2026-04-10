param(
  [switch]$WhatIfOnly
)

$paths = @(
  (Join-Path $env:LOCALAPPDATA "KwanzaFolha\userData\developer-license.json"),
  (Join-Path $env:APPDATA "Kwanza Folha\developer-license.json")
)

foreach ($target in $paths) {
  if (Test-Path $target) {
    if ($WhatIfOnly) {
      Write-Output ("WOULD_REMOVE " + $target)
    } else {
      Remove-Item -LiteralPath $target -Force
      Write-Output ("REMOVED " + $target)
    }
  } else {
    Write-Output ("NOT_FOUND " + $target)
  }
}

