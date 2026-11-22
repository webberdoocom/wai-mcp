import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectOffers, probe } from './live-readonly.mjs';
import { MAINNET, SEPOLIA, USDC } from '../src/core.mjs';
const receiver = '0x1234567890123456789012345678901234567890';
const offer = (network, amount = '10000', asset = USDC[network]) => ({ scheme: 'exact', network, amount, asset, payTo: receiver });
const quote = (...accepts) => ({ x402Version: 2, accepts });
test('accepts one matching mainnet offer among different-network options', () => {
  const result = inspectOffers(quote(offer(SEPOLIA), offer(MAINNET)), 'verify_uk_company');
  assert.equal(result.amount, 0.01);
  assert.equal(result.optionCount, 2);
});
test('rejects duplicate matching offers and unsupported offers', () => {
  assert.throws(() => inspectOffers(quote(offer(MAINNET), offer(MAINNET)), 'verify_uk_company'), /2 match/);
  assert.throws(() => inspectOffers(quote(offer(SEPOLIA)), 'verify_uk_company'), /0 match/);
  assert.throws(() => inspectOffers(quote(offer(MAINNET, '40000')), 'verify_uk_company'), /0 match/);
  assert.throws(() => inspectOffers(quote(offer(MAINNET, '10000', '0x0000000000000000000000000000000000000001')), 'verify_uk_company'), /0 match/);
});
test('four mocked challenges are tested without a payment signature', async () => {
  let calls = 0;
  const dummyFetch = async (_url, init) => {
    calls++;
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['payment-signature'], undefined);
    const cents = [1, 3, 3, 2][calls-1];
    return new Response(null, { status: 402, headers: {
      'payment-required': Buffer.from(JSON.stringify(quote(offer(SEPOLIA, String(cents*10000)), offer(MAINNET, String(cents*10000))))).toString('base64')
    }});
  };
  const res = await probe(dummyFetch);
  assert.equal(res.passed, 4);
  assert.equal(calls, 4);
});
