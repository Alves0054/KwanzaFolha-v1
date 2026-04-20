param(
  [string]$Domain = "license.alvesestudio.ao"
)

$ErrorActionPreference = "Stop"

Write-Output "=== DNS ==="
try {
  $dns = Resolve-DnsName -Name $Domain -Type A
  $dns | ForEach-Object { Write-Output ("A {0}" -f $_.IPAddress) }
} catch {
  Write-Output "DNS_FAIL: $($_.Exception.Message)"
  exit 1
}

Write-Output "=== HTTPS /health ==="
try {
  $health = Invoke-RestMethod -Uri ("https://{0}/health" -f $Domain) -Method Get -TimeoutSec 15
  Write-Output ("HEALTH_OK={0}" -f $health.ok)
} catch {
  Write-Output "HEALTH_FAIL: $($_.Exception.Message)"
  exit 1
}

Write-Output "=== HTTPS /plans ==="
try {
  $plans = Invoke-RestMethod -Uri ("https://{0}/plans" -f $Domain) -Method Get -TimeoutSec 15
  Write-Output ("PLANS_OK={0}" -f $plans.ok)
  Write-Output ("PLANS_COUNT={0}" -f @($plans.plans).Count)
  Write-Output ("SALES_ENABLED={0}" -f $plans.sales_enabled)
  $instructions = $plans.payment_instructions
  if ($instructions) {
    Write-Output ("PAYMENT_BANK={0}" -f ($instructions.bankName))
    Write-Output ("PAYMENT_ACCOUNT={0}" -f ($instructions.accountName))
    Write-Output ("PAYMENT_IBAN_SET={0}" -f (-not [string]::IsNullOrWhiteSpace($instructions.iban)))
    Write-Output ("PAYMENT_ENTITY_SET={0}" -f (-not [string]::IsNullOrWhiteSpace($instructions.entity)))
  } else {
    Write-Output "PAYMENT_INSTRUCTIONS_MISSING=true"
  }
} catch {
  Write-Output "PLANS_FAIL: $($_.Exception.Message)"
  exit 1
}

Write-Output "=== HTTPS /payment/create (diagnostico) ==="
try {
  $samplePayload = @{
    email = "diagnostico@alvesestudio.ao"
    nif = "5000000000"
    plan = "mensal"
    empresa = "Diagnostico Cloud"
    telefone = "+244900000000"
  } | ConvertTo-Json

  $payment = Invoke-RestMethod -Uri ("https://{0}/payment/create" -f $Domain) -Method Post -TimeoutSec 20 -Body $samplePayload -ContentType "application/json"
  Write-Output ("PAYMENT_CREATE_OK={0}" -f $payment.ok)
  if ($payment.reference) {
    Write-Output ("PAYMENT_REFERENCE={0}" -f $payment.reference)
  }
  if ($payment.message) {
    Write-Output ("PAYMENT_MESSAGE={0}" -f $payment.message)
  }
} catch {
  Write-Output "PAYMENT_CREATE_FAIL: $($_.Exception.Message)"
  exit 1
}

Write-Output "Cloud licensing endpoint pronto."
