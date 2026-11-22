# One explicitly confirmed $0.01 USDC purchase through WAI MCP; Base Mainnet only.
# Run from the root of the existing wai-mcp-adapter-v0.1 directory.
$ErrorActionPreference = 'Stop'
if (-not (Test-Path (Join-Path $PSScriptRoot 'test/live-paid-once.mjs'))) { throw 'Run this from the wai-mcp-adapter-v0.1 folder after extracting this override.' }
Write-Host 'LIVE PAYMENT TEST: exactly one WAI Company Verification MCP call, price 0.01 USDC on Base Mainnet.' -ForegroundColor Yellow
Write-Host 'This may spend funds. If a timeout occurs, inspect WAI admin and your wallet BEFORE any retry.'
$confirmation = Read-Host 'To proceed, type PAY-EXACTLY-0.01-USDC'
if ($confirmation -cne 'PAY-EXACTLY-0.01-USDC') { Write-Host 'Cancelled; no purchase attempted.'; exit 0 }
$receiver = (Read-Host 'Paste YOUR VERIFIED WAI receiving wallet address (from the WAI admin payment settings)').Trim()
if ($receiver -cnotmatch '^0x[0-9a-fA-F]{40}$') { throw 'Invalid receiver address. No purchase attempted.' }
$secure = Read-Host 'Enter your DEDICATED BUYER wallet private key (input hidden; never paste it into chat)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  if ($key -notmatch '^0x[0-9a-fA-F]{64}$') { throw 'Expected 0x-prefixed 32-byte private key. No purchase attempted.' }
  $env:WAI_EVM_PRIVATE_KEY = $key
  $key = $null
  $env:WAI_LIVE_PURCHASE_CONFIRM = 'PAY-EXACTLY-0.01-USDC'
  $env:WAI_PAYMENT_MODE = 'on'
  $env:WAI_NETWORK = 'eip155:8453'
  $env:WAI_BASE_URL = 'https://wai.webberdoo.com'
  $env:WAI_EXPECTED_PAY_TO = $receiver
  $env:WAI_MAX_PER_CALL_USDC = '0.01'
  $env:WAI_MAX_SESSION_USDC = '0.01'
  node (Join-Path $PSScriptRoot 'test/live-paid-once.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'Paid acceptance test failed or outcome uncertain. Check the WAI admin and wallet BEFORE any retry.' }
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  $secure.Dispose()
  $env:WAI_EVM_PRIVATE_KEY = $null
  $env:WAI_LIVE_PURCHASE_CONFIRM = $null
  $env:WAI_PAYMENT_MODE = $null
  $env:WAI_EXPECTED_PAY_TO = $null
  $env:WAI_MAX_PER_CALL_USDC = $null
  $env:WAI_MAX_SESSION_USDC = $null
  $env:WAI_BASE_URL = $null
  $env:WAI_NETWORK = $null
}
