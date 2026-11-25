import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { savePurchasedReport } from '../src/report-files.mjs';

const id = 'a'.repeat(32);
const tokenAddress = '0x' + '1'.repeat(40);
const transaction = '0x' + 'a'.repeat(64);
const report = {
  reportId: id,
  serviceId: 'token-allowance',
  payment: {
    network: 'eip155:8453', amountUsdc: '0.02', transaction,
    authorization: { nonce: 'mock-auth-nonce' }, token: 'mock-payment-token',
  },
  inputs: { tokenAddress },
  findings: { token: tokenAddress, status: 'observed', 'Payment-Signature': 'mock-nested-signature' },
  evidence: {
    publicUrl: 'https://example.test/reports',
    signedAttachment: 'https://example.test/download?token=mock-signed-attachment',
  },
  private_key: 'mock-private-key',
  download: { url: 'https://wai.webberdoo.com/download?token=mock-private-download' },
};
const paid = { status: 'ok', paymentAttempted: true, settlementStatus: 'confirmed', response: report };

async function scratch(t) {
  const dir = await mkdtemp(join(tmpdir(), 'wai-report-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('skips unpaid, incomplete, failed and uncertain results without creating a directory', async t => {
  const base = await scratch(t);
  const output = join(base, 'reports');
  for (const result of [
    { ...paid, paymentAttempted: false },
    { ...paid, status: 'report_failed' },
    { ...paid, status: 'payment_failed', settlementStatus: 'failed' },
    { ...paid, status: 'payment_uncertain', settlementStatus: 'uncertain' },
    { ...paid, settlementStatus: 'uncertain' },
  ]) {
    assert.equal(await savePurchasedReport(result, output), result);
  }
  assert.deepEqual(await readdir(base), []);
});

test('creates a custom absolute directory and omits credentials only from the disk copy', async t => {
  const output = join(await scratch(t), 'private', 'archive');
  const result = await savePurchasedReport(paid, output);
  assert.equal(result.response, report);
  assert.equal(result.localFile, join(output, 'wai-token-allowance-' + id + '.json'));
  const raw = await readFile(result.localFile, 'utf8');
  assert.doesNotMatch(raw, /mock-(?:auth|payment|nested|signed|private)/);
  assert.deepEqual(JSON.parse(raw), {
    reportId: id, serviceId: 'token-allowance',
    payment: { network: 'eip155:8453', amountUsdc: '0.02', transaction },
    inputs: { tokenAddress },
    findings: { token: tokenAddress, status: 'observed' },
    evidence: { publicUrl: 'https://example.test/reports' },
  });
});

test('duplicate filenames never overwrite an earlier report', async t => {
  const output = await scratch(t);
  const first = await savePurchasedReport(paid, output);
  const original = await readFile(first.localFile, 'utf8');
  const duplicate = { ...paid, response: { ...report, findings: { status: 'changed' } } };
  const result = await savePurchasedReport(duplicate, output);
  assert.deepEqual(result, { ...duplicate, localFileError: 'Report file already exists' });
  assert.equal(await readFile(first.localFile, 'utf8'), original);
});

test('an unusable path adds a local file error while preserving the successful purchase', async t => {
  const base = await scratch(t);
  const blocker = join(base, 'ordinary-file');
  await writeFile(blocker, 'fixture');
  for (const output of [blocker, join(blocker, 'reports')]) {
    const result = await savePurchasedReport(paid, output);
    assert.deepEqual(result, { ...paid, localFileError: 'Could not write report file' });
  }
  assert.equal(await readFile(blocker, 'utf8'), 'fixture');
});

test('refuses unsafe service names and report IDs', async t => {
  const output = await scratch(t);
  for (const response of [{ ...report, serviceId: '../malicious' }, { ...report, reportId: '../bad-id' }]) {
    const result = await savePurchasedReport({ ...paid, response }, output);
    assert.equal(result.localFileError, 'Completed report had invalid file metadata');
  }
  assert.deepEqual(await readdir(output), []);
});
