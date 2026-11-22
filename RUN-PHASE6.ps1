param(
  [Parameter(Mandatory=$true)]
  [ValidateSet('investigate_uk_company','inspect_smart_contract','check_token_allowance')]
  [string]$Service
)
# Exactly one live paid MCP call per invocation. PowerShell 5.1 compatible.
$ErrorActionPreference='Stop'
if(-not (Test-Path (Join-Path $PSScriptRoot 'test/live-paid-remaining.mjs'))){throw 'Run from the wai-mcp-adapter-v0.1 directory after applying the Phase 6 override.'}
$price=if($Service -eq 'check_token_allowance'){'0.02'}else{'0.03'}
Write-Host "LIVE PAYMENT: ONE $Service report, $price USDC on Base Mainnet" -ForegroundColor Yellow
Write-Host 'No automatic retries. Check WAI admin and the buyer wallet before rerunning an uncertain purchase.'
$phrase="PAY-$Service-$price-USDC"
$answer=Read-Host "To AUTHORISE this single payment, type $phrase"
if($answer -cne $phrase){Write-Host 'Cancelled; nothing purchased.';exit 0}
$receiver=(Read-Host 'Verified WAI receiving wallet address (from WAI admin)').Trim()
if($receiver -notmatch '^0x[0-9a-fA-F]{40}$'){throw 'Invalid WAI receiver address; no purchase attempted.'}
$inputData=@{}
if($Service -eq 'investigate_uk_company'){
 $company=(Read-Host 'UK company number (8 digits)').Trim()
 if($company -cnotmatch '^\d{8}$'){throw 'Invalid company number; no purchase attempted.'}
 $inputData=@{companyNumber=$company}
}elseif($Service -eq 'inspect_smart_contract'){
 $contract=(Read-Host 'Contract address on Base Mainnet').Trim()
 if($contract -notmatch '^0x[0-9a-fA-F]{40}$'){throw 'Invalid contract address; no purchase attempted.'}
 $inputData=@{chainId=8453;contractAddress=$contract}
}else{
 $owner=(Read-Host 'Owner wallet address on Base Mainnet').Trim()
 $token=(Read-Host 'Token contract address on Base Mainnet').Trim()
 $spender=(Read-Host 'Spender address on Base Mainnet').Trim()
 foreach($value in @($owner,$token,$spender)){if($value -notmatch '^0x[0-9a-fA-F]{40}$'){throw 'Invalid EVM address; no purchase attempted.'}}
 $inputData=@{chainId=8453;ownerAddress=$owner;tokenAddress=$token;spenderAddress=$spender;includePermit2=$false}
}
$secure=Read-Host 'Dedicated BUYER private key (hidden; never share it)' -AsSecureString
$bstr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try{
 $key=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
 if($key -notmatch '^0x[0-9a-fA-F]{64}$'){throw 'Invalid buyer private key format; no purchase attempted.'}
 $env:WAI_EVM_PRIVATE_KEY=$key; $key=$null
 $env:WAI_LIVE_PURCHASE_CONFIRM=$phrase
 $env:WAI_PAYMENT_MODE='on'
 $env:WAI_NETWORK='eip155:8453'
 $env:WAI_BASE_URL='https://wai.webberdoo.com'
 $env:WAI_EXPECTED_PAY_TO=$receiver
 $env:WAI_MAX_PER_CALL_USDC=$price
 $env:WAI_MAX_SESSION_USDC=$price
 $env:WAI_TEST_INPUT_JSON=($inputData|ConvertTo-Json -Compress -Depth 5)
 node (Join-Path $PSScriptRoot 'test/live-paid-remaining.mjs') $Service
 if($LASTEXITCODE -ne 0){throw 'Paid test failed or uncertain. Do not retry until wallet and WAI admin have been checked.'}
}finally{
 [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
 $secure.Dispose()
 foreach($name in @('WAI_EVM_PRIVATE_KEY','WAI_LIVE_PURCHASE_CONFIRM','WAI_PAYMENT_MODE','WAI_NETWORK','WAI_BASE_URL','WAI_EXPECTED_PAY_TO','WAI_MAX_PER_CALL_USDC','WAI_MAX_SESSION_USDC','WAI_TEST_INPUT_JSON')){Remove-Item "Env:$name" -ErrorAction SilentlyContinue}
}
