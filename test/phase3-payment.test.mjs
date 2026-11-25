import test from 'node:test';
import assert from 'node:assert/strict';
import { selectPaymentOffer, paymentTermsMatch, parseConfig, MAINNET, SEPOLIA, USDC } from '../src/core.mjs';
import { makeRunner } from '../src/runner.mjs';
const to = '0x1234567890123456789012345678901234567890';
const offer = (network, cents=1) => ({ scheme: 'exact', network, asset: USDC[network], amount: String(cents * 10000), payTo: to });
const challenge = (...accepts) => ({ x402Version: 2, accepts });
const payment402 = (q) => new Response(null, { status: 402, headers: { 'payment-required': Buffer.from(JSON.stringify(q)).toString('base64') } });
test('selects Base mainnet from WAI two-network quote in any order', () => {
  const config = parseConfig({});
  for (const q of [challenge(offer(SEPOLIA), offer(MAINNET)), challenge(offer(MAINNET), offer(SEPOLIA))]) {
    const selected = selectPaymentOffer(q, config, 'verify_uk_company');
    assert.equal(selected.offer.network, MAINNET);
    assert.equal(selected.priceUSDC, 0.01);
  }
});
test('refuses Sepolia configuration and selects the Mainnet service price', () => {
  assert.throws(() => parseConfig({ WAI_NETWORK: SEPOLIA }), /Mainnet/);
  const config = parseConfig({});
  const chosen = selectPaymentOffer(challenge(offer(MAINNET,3),offer(SEPOLIA,3)),config,'inspect_smart_contract');
  assert.equal(chosen.offer.network, MAINNET);
  assert.equal(chosen.priceUSDC, 0.03);
});
test('rejects duplicate, wrong asset, bad price, unknown protocol version and absent network', () => {
  const config = parseConfig({});
  assert.throws(() => selectPaymentOffer(challenge(offer(MAINNET), offer(MAINNET)),config,'verify_uk_company'),/exactly one/);
  assert.throws(() => selectPaymentOffer(challenge(offer(SEPOLIA)),config,'verify_uk_company'),/exactly one/);
  assert.throws(() => selectPaymentOffer(challenge({ ...offer(MAINNET), asset:'0x0000000000000000000000000000000000000001' }),config,'verify_uk_company'),/exactly one/);
  assert.throws(() => selectPaymentOffer(challenge(offer(MAINNET,4)),config,'verify_uk_company'),/exceeds/);
  assert.throws(() => selectPaymentOffer({x402Version:1,accepts:[offer(MAINNET)]},config,'verify_uk_company'),/x402 v2/);
});
test('rejects changed quote payment terms', () => {
  assert.ok(paymentTermsMatch(offer(MAINNET), {...offer(MAINNET)}));
  assert.equal(paymentTermsMatch(offer(MAINNET), { ...offer(MAINNET),payTo:'0x0000000000000000000000000000000000000001'}), false);
  assert.equal(paymentTermsMatch(offer(MAINNET), offer(SEPOLIA)), false);
});
test('dry-run runner accepts multi-offer and never invokes signing', async () => {
  let calls = 0;
  const runner = makeRunner({ fetchImpl: async () => { calls++; return payment402(challenge(offer(SEPOLIA),offer(MAINNET))); },
    paymentFetchFactory: async () => { throw new Error('Signing must not be invoked'); } });
  const result = await runner.run('verify_uk_company',{companyNumber:'00000006'});
  assert.equal(result.status,'payment_required');
  assert.equal(result.priceUSDC,0.01);
  assert.equal(calls,1);
});
test('opted-in mock remains bounded with multi-offer, no real signatures', async () => {
  let attempts = 0;
  const runner = makeRunner({ env: { WAI_SAVE_REPORTS:'false', WAI_PAYMENT_MODE:'on', WAI_EVM_PRIVATE_KEY: '0x'+'1'.repeat(64), WAI_MAX_PER_CALL_USDC:'0.01',WAI_MAX_SESSION_USDC:'0.01' },
    fetchImpl: async () => payment402(challenge(offer(SEPOLIA),offer(MAINNET))),
    paymentFetchFactory: async () => async () => {
      attempts++;
      const receipt = Buffer.from(JSON.stringify({
        success: true, network: MAINNET, transaction: '0x' + 'a'.repeat(64),
      })).toString('base64');
      return Response.json({
        reportId: 'a'.repeat(32), serviceId: 'company-verification',
        findings: { recordFound: true }, evidence: { profile: 'mock profile' },
      }, { headers: { 'payment-response': receipt } });
    },
  });
  const result = await runner.run('verify_uk_company',{companyNumber:'00000006'});
  assert.equal(result.status,'ok'); assert.equal(attempts,1);
  await assert.rejects(runner.run('verify_uk_company',{companyNumber:'00000006'}),/SESSION/);
  assert.equal(attempts,1);
});
