#!/usr/bin/env node
/**
 * WAI live read-only x402 multi-offer probe.
 * One unsigned POST per endpoint. No wallet, signing, payment retry or secrets.
 * This script deliberately does not change the payment-capable runner.
 */
import { extractChallenge, validateChallenge, postURL, SERVICES, MAINNET, USDC } from '../src/core.mjs';
import { pathToFileURL } from 'node:url';

const BASE = 'https://wai.webberdoo.com';
const TESTS = [
  ['verify_uk_company', { companyNumber: '00000006' }],
  ['investigate_uk_company', { companyNumber: '00000006' }],
  ['inspect_smart_contract', { chainId: 8453, contractAddress: USDC[MAINNET] }],
  ['check_token_allowance', {
    chainId: 8453,
    ownerAddress: '0x000000000000000000000000000000000000dEaD',
    tokenAddress: USDC[MAINNET],
    spenderAddress: '0x0000000000000000000000000000000000000001',
    includePermit2: false
  }]
];
const guard = { network: MAINNET, callLimitCents: 3, sessionLimitCents: 3, receiver: '' };

export function inspectOffers(challenge, service) {
  const offers = challenge?.accepts;
  if (!Array.isArray(offers) || offers.length === 0) throw new Error('No x402 payment options');
  const expected = SERVICES[service]?.cents / 100;
  if (!Number.isFinite(expected)) throw new Error('Unknown service');
  const matching = [];
  for (const offer of offers) {
    try {
      // Existing validator checks USDC token, network, scheme, nonzero value and caps.
      // Pass one offer at a time solely for inspecting a multi-offer response.
      const price = validateChallenge({ ...challenge, accepts: [offer] }, guard, service);
      if (price === expected) matching.push({ offer, price });
    } catch { /* Other networks, tokens, schemes or prices are not eligible. */ }
  }
  const networks = [...new Set(offers.map(a => typeof a?.network === 'string' ? a.network : '(missing)'))];
  if (matching.length !== 1) {
    throw new Error(`${offers.length} advertised option(s), ${matching.length} match exact Base USDC $${expected.toFixed(2)}; networks: ${networks.join(', ').slice(0, 120)}; refusing ambiguous/unsupported quote`);
  }
  return { amount: matching[0].price, optionCount: offers.length, networks };
}

export async function probe(fetchImpl = globalThis.fetch) {
  let passed = 0;
  let failed = 0;
  console.log('WAI live read-only x402 multi-offer challenge check');
  console.log('Target:', BASE);
  console.log('Mode: unsigned POST only; no wallet, no payment, no retry');
  for (const [tool, input] of TESTS) {
    const url = postURL(BASE, tool);
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': 'wai-mcp-readonly/0.1.1' },
        body: JSON.stringify(input),
        redirect: 'error',
        signal: AbortSignal.timeout(20000)
      });
      if (response.status !== 402) throw new Error(`HTTP ${response.status} (expected HTTP 402 payment challenge)`);
      const { amount, optionCount, networks } = inspectOffers(extractChallenge(response), tool);
      console.log(`PASS  ${tool.padEnd(26)} HTTP 402  Base USDC $${amount.toFixed(2)}  (${optionCount} offered; networks: ${networks.join(', ').slice(0, 120)})`);
      passed++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`FAIL  ${tool.padEnd(26)} ${message.slice(0, 280)}`);
      failed++;
    }
  }
  console.log(`Results: ${passed}/${TESTS.length} passed, ${failed} failed.`);
  return { passed, failed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await probe();
  if (result.failed) process.exitCode = 1;
}
