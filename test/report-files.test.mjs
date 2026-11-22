import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { savePurchasedReport } from '../src/report-files.mjs';
const id = 'a'.repeat(32);
const report = { reportId: id, serviceId: 'company-verification', findings: { status: 'observed' }, download: {url: 'https://wai.webberdoo.com/private-token'} };
test('does not write unless explicit directory and completed paid result', async () => {
  const base = await mkdtemp(join(tmpdir(), 'wai-no-save-'));
  const result = { status: 'ok', paymentAttempted: false, response: report };
  assert.equal(await savePurchasedReport(result, base), result);
  assert.deepEqual(await readdir(base), []);
  assert.equal((await savePurchasedReport({ ...result, paymentAttempted: true }, '')).localFile, undefined);
});
test('stores full paid report as JSON but not ephemeral download credentials', async () => {
  const base = await mkdtemp(join(tmpdir(), 'wai-save-'));
  const saved = await savePurchasedReport({ status: 'ok', paymentAttempted: true, response: report }, base);
  assert.ok(saved.localFile.endsWith('.json'));
  const raw = await readFile(saved.localFile, 'utf8');
  assert.equal(JSON.parse(raw).findings.status, 'observed');
  assert.equal(JSON.parse(raw).download, undefined);
  assert.equal((await savePurchasedReport({status:'ok', paymentAttempted: true, response: report},base)).localFileError,'Report file already exists');
});
test('refuses unsafe service names or report IDs', async () => {
  const base = await mkdtemp(join(tmpdir(), 'wai-safe-'));
  const res = await savePurchasedReport({status:'ok', paymentAttempted:true, response:{...report, serviceId:'../malicious'}},base);
  assert.equal(res.localFileError,'Completed report had invalid file metadata');
  assert.deepEqual(await readdir(base),[]);
});
