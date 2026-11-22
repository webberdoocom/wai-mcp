#!/usr/bin/env node
/**
 * Offline signing-and-retry compatibility check, no external network requests.
 * Uses an ephemeral test private key generated in memory and a mocked fetch.
 */
import { generatePrivateKey } from 'viem/accounts';
import { makeRunner } from '../src/runner.mjs';

const base = 'http://127.0.0.1:8765';
const receiver = '0x1111111111111111111111111111111111111111';
const url = `${base}/api/v1/intelligence/company-verification`;
const offer = (network, asset) => ({
  scheme: 'exact', network, asset, amount: '10000', payTo: receiver,
  maxTimeoutSeconds: 120,
  extra: {name: network === 'eip155:8453' ? 'USD Coin' : 'USDC', version: '2', assetTransferMethod: 'eip3009'},
});
const challenge = {
  x402Version: 2,
  resource: {url, description: 'Company Verification', mimeType: 'application/json'},
  accepts: [
    offer('eip155:84532', '0x036CbD53842c5426634e7929541eC2318f3dCF7e'),
    offer('eip155:8453', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'),
  ],
};
const body = JSON.stringify({error:'payment_required', ...challenge});
const encode = v => Buffer.from(JSON.stringify(v)).toString('base64');
const logs = {unsigned: 0, signed: 0, unexpected: 0};
const mockedFetch = async (target, init) => {
  if (String(target) !== url) throw new Error('Mock blocked unexpected URL');
  if (String(init?.method).toUpperCase() !== 'POST') throw new Error('Mock blocked unexpected method');
  const json = JSON.parse(init.body);
  if (json.companyNumber !== '00000006') throw new Error('Mock blocked changed request body');
  const headers = new Headers(init.headers);
  if (headers.has('payment-signature') || headers.has('x-payment')) {
    logs.signed++;
    if (logs.signed !== 1) throw new Error('More than one signed request');
    const encoded = headers.get('payment-signature') || headers.get('x-payment');
    let payload;
    try { payload = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')); }
    catch { throw new Error('Signed request header not parseable as x402 JSON'); }
    if (payload?.accepted?.network !== 'eip155:8453' || payload?.accepted?.amount !== '10000')
      throw new Error('Wrong network or amount in signed x402 header');
    if (!payload?.payload?.signature) throw new Error('Missing generated signature');
    return new Response(JSON.stringify({reportId: 'offline-mock-only', findings: [], evidence: [], payment: {status: 'mock'}}), {status:200, headers:{'content-type':'application/json'}});
  }
  logs.unsigned++;
  if (logs.unsigned > 2) throw new Error('Extra unsigned request');
  return new Response(body, {status:402, headers:{'content-type':'application/json', 'payment-required':encode(challenge)}});
};
const env = {
  WAI_BASE_URL: base,
  WAI_PAYMENT_MODE: 'on',
  WAI_NETWORK: 'eip155:8453',
  WAI_MAX_PER_CALL_USDC: '0.01',
  WAI_MAX_SESSION_USDC: '0.01',
  WAI_EXPECTED_PAY_TO: receiver,
  WAI_EVM_PRIVATE_KEY: generatePrivateKey(),
};
console.log('Offline x402 signing compatibility: mocked WAI response, ephemeral key, NO network calls');
try {
  const runner = makeRunner({env, fetchImpl:mockedFetch});
  const result = await runner.run('verify_uk_company', {companyNumber:'00000006'});
  if (result.status !== 'ok' || !result.paymentAttempted || logs.unsigned !== 2 || logs.signed !== 1)
    throw new Error('Unexpected result or number of signed/unsigned calls');
  console.log('PASS: x402 SDK created one signature and MCP adapter retried with payment header.');
  console.log(`Mock requests: ${logs.unsigned} unsigned, ${logs.signed} signed. USDC spent: 0.`);
} catch (e) {
  const err = e instanceof Error ? e.message : String(e);
  // Only print known-safe category information; never print private keys or signed headers.
  const kind = /unexpected URL|unexpected HTTP method|changed the report request body|Unexpected extra unsigned|Unexpected repeated/i.test(err) ? 'adapter_fetch_guard'
    : /quote changed/i.test(err) ? 'quote_comparison'
    : /network|asset|payment option|signature|payment/i.test(err) ? 'sdk_payment_or_quote'
    : /method|POST|body|JSON|fetch/i.test(err) ? 'sdk_fetch_request_shape'
    : 'other_sdk_runtime_error';
  console.error('FAIL: offline signing/retry compatibility. Category:', kind);
  console.error(`Mock requests: ${logs.unsigned} unsigned, ${logs.signed} signed. USDC spent: 0.`);
  if (process.env.WAI_OFFLINE_DIAG_DETAIL === '1') {
    // Only show a pre-approved subset of non-sensitive guard messages.
    const allowed = [
      'Payment client attempted an unexpected URL',
      'Payment client attempted unexpected HTTP method',
      'Payment client changed the report request body',
      'Unexpected extra unsigned payment request',
      'Unexpected repeated or premature signed payment request',
      'Payment quote changed between unsigned request and payment retry',
    ];
    if (allowed.some(x => err.startsWith(x))) console.error('Adapter guard:', err.slice(0, 160));
  }
  process.exitCode = 1;
} finally {
  env.WAI_EVM_PRIVATE_KEY = '';
}
