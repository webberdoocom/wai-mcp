import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRunner } from '../src/runner.mjs';
import { MAINNET, USDC } from '../src/core.mjs';

const recipient = '0x1234567890123456789012345678901234567890';
const quote = {
  x402Version: 2,
  accepts: [{scheme: 'exact', network: MAINNET, asset: USDC[MAINNET], amount: '10000', payTo: recipient}],
};
const challenge = () => new Response(null, {
  status: 402,
  headers: {'payment-required': Buffer.from(JSON.stringify(quote)).toString('base64')},
});
const env = {
  WAI_PAYMENT_MODE: 'on',
  WAI_NETWORK: MAINNET,
  WAI_EVM_PRIVATE_KEY: '0x' + '1'.repeat(64), // fixture only; never transmitted or used to sign
  WAI_EXPECTED_PAY_TO: recipient,
  WAI_MAX_PER_CALL_USDC: '0.01',
  WAI_MAX_SESSION_USDC: '0.01',
};

test('two simultaneous paid MCP calls cannot exceed a one-cent session cap', async () => {
  let paidAttempts = 0;
  const runner = makeRunner({
    env,
    fetchImpl: async () => challenge(),
    paymentFetchFactory: async () => async () => {
      paidAttempts++;
      return new Response('{"status":"ok"}', {status: 200, headers: {'content-type':'application/json'}});
    },
  });
  const calls = await Promise.allSettled([
    runner.run('verify_uk_company', {companyNumber:'00000006'}),
    runner.run('verify_uk_company', {companyNumber:'00000006'}),
  ]);
  assert.equal(calls.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(calls.filter(x => x.status === 'rejected').length, 1);
  assert.match(calls.find(x => x.status === 'rejected').reason.message, /WAI_MAX_SESSION_USDC/);
  assert.equal(paidAttempts, 1);
});

test('an uncertain payment attempt retains its spending reservation', async () => {
  let paidAttempts = 0;
  const runner = makeRunner({
    env,
    fetchImpl: async () => challenge(),
    paymentFetchFactory: async () => async () => {
      paidAttempts++;
      throw new Error('Simulated timeout after payment attempt');
    },
  });
  await assert.rejects(runner.run('verify_uk_company',{companyNumber:'00000006'}), /Simulated timeout/);
  await assert.rejects(runner.run('verify_uk_company',{companyNumber:'00000006'}), /WAI_MAX_SESSION_USDC/);
  assert.equal(paidAttempts, 1);
});
