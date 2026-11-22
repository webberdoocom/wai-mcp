#!/usr/bin/env node
/** Verifies real installed SDK symbols and payment client construction.
 * No HTTP requests, no wallet key input, no signing, no payment.
 */
try {
  const [{ x402Client }, { ExactEvmScheme }, { wrapFetchWithPayment }, { privateKeyToAccount }] = await Promise.all([
    import('@x402/core/client'),
    import('@x402/evm/exact/client'),
    import('@x402/fetch'),
    import('viem/accounts')
  ]);
  for (const [name, value] of Object.entries({x402Client,ExactEvmScheme,wrapFetchWithPayment,privateKeyToAccount})) {
    if (typeof value !== 'function') throw new Error(`SDK symbol ${name} is unavailable`);
  }
  // This throwaway deterministic test-only key is NOT a funded wallet and is never
  // persisted. This script does not invoke sign or send any network requests.
  const account = privateKeyToAccount('0x' + '1'.repeat(64));
  const client = new x402Client();
  client.register('eip155:8453', new ExactEvmScheme(account));
  const noNetworkFetch = async () => {throw new Error('Network access forbidden in SDK compatibility probe');};
  const paymentFetch = wrapFetchWithPayment(noNetworkFetch, client);
  if (typeof paymentFetch !== 'function') throw new Error('wrapFetchWithPayment did not return a function');
  console.log('PASS: x402 SDK imports, EVM signer construction, network registration and payment fetch wrapper.');
  console.log('No network requests made; no signatures generated; no funds spent.');
} catch (e) {
  console.error('FAIL: x402 SDK runtime compatibility:', e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
}
