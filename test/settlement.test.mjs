import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generatePrivateKey } from 'viem/accounts';
import { MAINNET, SEPOLIA, SERVICES, USDC } from '../src/core.mjs';
import { makeRunner, toMcpResult } from '../src/runner.mjs';
import { DEX_INPUT_SCHEMA, readCatalog } from '../src/discovery.mjs';

const base = 'http://127.0.0.1:8765';
const receiver = '0x' + '1'.repeat(40);
const transaction = '0x' + 'a'.repeat(64);
const input = { companyNumber: 'SC001000' };
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64');
const makeChallenge = cents => encode({
  x402Version: 2,
  accepts: [{
    scheme: 'exact', network: MAINNET, asset: USDC[MAINNET], amount: String(cents * 10000),
    payTo: receiver, maxTimeoutSeconds: 120, extra: { name: 'USD Coin', version: '2' },
  }],
});
const receipt = encode({ success: true, network: MAINNET, transaction });
const failed = encode({ success: false, network: MAINNET, errorReason: 'mock_rejection' });
const reportId = 'a'.repeat(32);
const requestId = 'b'.repeat(32);
const companyReport = {
  reportId, serviceId: 'company-verification',
  findings: { recordFound: true, company: { company_number: input.companyNumber } },
  evidence: { profile: 'mock profile' },
};
const paidReply = (body, status = 200, paymentReceipt = receipt) =>
  Response.json(body, { status, headers: { 'payment-response': paymentReceipt } });

function paymentFixture(reply, {
  repeatedChallenge, tool = 'verify_uk_company', args = input, dex, saving = { WAI_SAVE_REPORTS: 'false' },
} = {}) {
  const { id, cents } = dex ?? SERVICES[tool];
  const limit = (cents / 100).toFixed(2);
  const challenge = makeChallenge(cents);
  let unsigned = 0;
  let signed = 0;
  const runner = makeRunner({
    env: {
      WAI_BASE_URL: base,
      WAI_PAYMENT_MODE: 'on',
      WAI_EVM_PRIVATE_KEY: generatePrivateKey(),
      WAI_EXPECTED_PAY_TO: receiver,
      WAI_MAX_PER_CALL_USDC: limit,
      WAI_MAX_SESSION_USDC: limit,
      WAI_DYNAMIC_PAID_ALLOWLIST: 'dex-liquidity',
      ...saving,
    },
    fetchImpl: async (url, options) => {
      assert.equal(url, base + '/api/v1/intelligence/' + id);
      assert.deepEqual(JSON.parse(options.body), args);
      if (new Headers(options.headers).has('payment-signature')) {
        signed++;
        return reply();
      }
      unsigned++;
      return new Response(null, { status: 402, headers: {
        'payment-required': unsigned === 2 && repeatedChallenge ? repeatedChallenge : challenge,
      } });
    },
  });
  const run = () => dex ? runner.runDynamic(dex, args) : runner.run(tool, args);
  return { run, counts: () => ({ unsigned, signed }) };
}

for (const [name, status, settlementStatus, reply, references = {}] of [
  ['valid receipt', 'ok', 'confirmed',
    () => paidReply(companyReport)],
  ['failed receipt paired with HTTP 200', 'payment_failed', 'failed',
    () => new Response('{}', { headers: { 'payment-response': failed } })],
  ['failed receipt paired with HTTP 402', 'payment_failed', 'failed',
    () => new Response('{}', { status: 402, headers: { 'payment-response': failed } })],
  ['conflicting v2 and legacy receipts', 'payment_failed', 'failed',
    () => new Response('{}', { headers: { 'payment-response': receipt, 'x-payment-response': failed } })],
  ['missing receipt despite HTTP 200', 'payment_uncertain', 'uncertain',
    () => new Response('{"reportId":"fixture"}')],
  ['malformed receipt', 'payment_uncertain', 'uncertain',
    () => new Response('{}', { headers: { 'payment-response': 'invalid!' } })],
  ['success receipt for the wrong chain', 'payment_uncertain', 'uncertain',
    () => new Response('{}', { headers: {
      'payment-response': encode({ success: true, network: SEPOLIA, transaction }),
    } })],
  ['connection loss after sending the signature', 'payment_uncertain', 'uncertain',
    () => { throw new Error('Simulated transport failure'); }],
  ['confirmed charge with HTTP 204', 'report_failed', 'confirmed',
    () => new Response(null, { status: 204, headers: { 'payment-response': receipt } })],
  ['confirmed charge with a 200 error object', 'report_failed', 'confirmed',
    () => paidReply({ ...companyReport, requestId, error: { code: 'report_failed' } }),
    { requestId, reportId, errorCode: 'report_failed' }],
  ['confirmed charge with malformed JSON', 'report_failed', 'confirmed',
    () => new Response('{malformed', { headers: { 'payment-response': receipt } })],
  ['confirmed charge without evidence', 'report_failed', 'confirmed',
    () => paidReply({ ...companyReport, evidence: undefined })],
  ['confirmed charge with an invalid report ID', 'report_failed', 'confirmed',
    () => paidReply({ ...companyReport, reportId: 'invalid' })],
  ['confirmed charge with a report from the wrong service', 'report_failed', 'confirmed',
    () => paidReply({ ...companyReport, serviceId: 'company-due-diligence' })],
  ['confirmed charge with HTTP 502 report_failed', 'report_failed', 'confirmed',
    () => paidReply({ requestId, error: { code: 'report_failed', message: 'Provider unavailable' } }, 502),
    { requestId, errorCode: 'report_failed' }],
  ['HTTP 502 report_failed without a receipt', 'report_failed', 'uncertain',
    () => Response.json({ requestId: 'request-502', error: { code: 'report_failed' } }, { status: 502 }),
    { requestId: 'request-502', errorCode: 'report_failed' }],
  ['pending settlement', 'payment_uncertain', 'uncertain',
    () => paidReply({ requestId, error: { code: 'settlement_unconfirmed' } }, 503,
      encode({ success: false, network: MAINNET, transaction, errorReason: 'settlement_pending' })),
    { httpStatus: 503, requestId, transaction, errorCode: 'settlement_unconfirmed', errorReason: 'settlement_pending' }],
  ['unconfirmed settlement', 'payment_uncertain', 'uncertain',
    () => paidReply({ requestId, error: { code: 'settlement_unconfirmed' } }, 503,
      encode({ success: false, network: MAINNET, transaction: '', errorReason: 'settlement_unconfirmed' })),
    { requestId, errorReason: 'settlement_unconfirmed' }],
]) {
  test('settlement handles ' + name + ' without resending a payment', async () => {
    const { run, counts } = paymentFixture(reply);
    const result = await toMcpResult(run)(input);
    const content = JSON.parse(result.content[0].text);
    assert.equal(content.status, status);
    assert.equal(content.settlementStatus, settlementStatus);
    assert.equal(content.paymentAttempted, true);
    assert.equal(Boolean(result.isError), status !== 'ok');
    if (settlementStatus === 'confirmed') assert.equal(content.transaction, transaction);
    if (status === 'ok') assert.deepEqual(content.response, companyReport);
    assert.equal(content.localFile, undefined);
    assert.equal(content.localFileError, undefined);
    for (const [key, value] of Object.entries(references)) assert.equal(content[key], value);
    assert.deepEqual(counts(), { unsigned: 2, signed: 1 });
    await assert.rejects(run(), /WAI_MAX_SESSION_USDC/);
    assert.deepEqual(counts(), { unsigned: 3, signed: 1 });
  });
}

test('a rejected quote before signing retains its original error', async () => {
  const { run, counts } = paymentFixture(() => assert.fail('must stay unsigned'), { repeatedChallenge: 'invalid!' });
  await assert.rejects(run(), /Invalid x402 payment challenge/);
  assert.deepEqual(counts(), { unsigned: 2, signed: 0 });
});

test('an explicit failed settlement receipt on an unsigned response also blocks success', async () => {
  const runner = makeRunner({
    env: {},
    fetchImpl: async () => new Response('{}', { headers: { 'payment-response': failed } }),
  });
  const result = await runner.run('verify_uk_company', input);
  assert.equal(result.status, 'payment_failed');
  assert.equal(result.paymentAttempted, false);
});

const token = '0x' + '2'.repeat(40);
const dex = readCatalog({ services: [{
  id: 'dex-liquidity', name: 'DEX Liquidity', available: true, priceUsdc: '0.020000',
  endpoint: '/api/v1/intelligence/dex-liquidity', payment: { network: MAINNET, asset: USDC[MAINNET] },
  inputSchema: DEX_INPUT_SCHEMA,
}] }, base).get('wai_dex_liquidity');

for (const [tool, args, findings, evidence] of [
  ['verify_uk_company', input, companyReport.findings, companyReport.evidence],
  ['investigate_uk_company', input, { officers: { items: [] } }, { officers: 'mock officer register' }],
  ['inspect_uk_business_insolvency', input, { insolvency: { status: 'not_reported' } }, { insolvency: 'mock insolvency register' }],
  ['inspect_website_trust', { domain: 'iana.org' }, { dns: { addresses: [] } }, { website: 'https://iana.org/' }],
  ['inspect_smart_contract', { chainId: 8453, contractAddress: token }, { hasBytecode: true }, { chainId: 8453 }],
  ['check_token_allowance', { chainId: 8453, ownerAddress: receiver, tokenAddress: token, spenderAddress: receiver },
    { erc20: { amountAtomic: '0' } }, { chainId: 8453 }],
  ['wai_dex_liquidity', { chainId: 8453, protocol: 'uniswap-v2', tokenIn: receiver, tokenOut: token },
    { depth: [{ inputUnits: '1' }] }, { chainId: 8453 }],
]) {
  test('delivers and saves a paid report by default for ' + tool, async t => {
    const service = tool === 'wai_dex_liquidity' ? dex : SERVICES[tool];
    const report = { reportId, serviceId: service.id, findings, evidence };
    const cwd = await mkdtemp(join(tmpdir(), 'wai-default-report-'));
    const originalCwd = process.cwd();
    t.after(() => rm(cwd, { recursive: true, force: true }));
    const { run, counts } = paymentFixture(() => paidReply(report), {
      tool, args, dex: tool === 'wai_dex_liquidity' ? dex : undefined, saving: {},
    });
    process.chdir(cwd);
    try {
      const result = await run();
      assert.equal(result.status, 'ok');
      assert.deepEqual(result.response, report);
      assert.equal(result.localFile, join(cwd, 'reports', 'wai-' + service.id + '-' + reportId + '.json'));
      assert.deepEqual(JSON.parse(await readFile(result.localFile, 'utf8')), report);
      assert.deepEqual(counts(), { unsigned: 2, signed: 1 });
    } finally {
      process.chdir(originalCwd);
    }
  });
}

test('explicit opt-out overrides an absolute report directory', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'wai-optout-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { run, counts } = paymentFixture(() => paidReply(companyReport), {
    saving: { WAI_SAVE_REPORTS: 'false', WAI_REPORT_DIR: join(dir, 'custom') },
  });
  const result = await run();
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.response, companyReport);
  assert.equal(result.localFile, undefined);
  assert.equal(result.localFileError, undefined);
  assert.deepEqual(await readdir(dir), []);
  assert.deepEqual(counts(), { unsigned: 2, signed: 1 });
});

test('a filesystem error stays a successful MCP tool result without a payment retry', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'wai-write-error-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const blocker = join(dir, 'file');
  await writeFile(blocker, 'fixture');
  const { run, counts } = paymentFixture(() => paidReply(companyReport), {
    saving: { WAI_REPORT_DIR: join(blocker, 'reports') },
  });
  const reply = await toMcpResult(run)(input);
  assert.equal(reply.isError, undefined);
  const result = JSON.parse(reply.content[0].text);
  assert.equal(result.status, 'ok');
  assert.equal(result.settlementStatus, 'confirmed');
  assert.equal(result.localFileError, 'Could not write report file');
  assert.deepEqual(result.response, companyReport);
  assert.deepEqual(counts(), { unsigned: 2, signed: 1 });
});
