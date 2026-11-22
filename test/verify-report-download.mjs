// Existing signed URL acceptance. No wallet, payment or automatic retries.
// Give the URL in WAI_SIGNED_DOWNLOAD_URL (a bearer credential). Never print it.
import assert from 'node:assert/strict';
const raw = process.env.WAI_SIGNED_DOWNLOAD_URL;
if (!raw) {
  console.error('SKIP: Set WAI_SIGNED_DOWNLOAD_URL in this terminal to a VALID, UNEXPIRED purchased report link. No request made.');
  process.exit(2);
}
const url = new URL(raw);
if (url.origin !== 'https://wai.webberdoo.com' ||
    !/^\/api\/v1\/reports\/[a-f0-9]{32}\/download$/.test(url.pathname) ||
    !/^\d{10}$/.test(url.searchParams.get('expires') || '') ||
    !/^[a-f0-9]{64}$/i.test(url.searchParams.get('token') || '')) {
  throw new Error('The supplied URL does not match the expected WAI signed download route. No request made.');
}
const request = async (u) => fetch(u, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(20000), headers: { 'Accept': 'application/json' } });
const valid = await request(url);
assert.equal(valid.status, 200, `Valid download should return HTTP 200, got ${valid.status}`);
assert.match(valid.headers.get('content-type') || '', /application\/json/i);
assert.match(valid.headers.get('content-disposition') || '', /attachment/i);
assert.match(valid.headers.get('cache-control') || '', /no-store/i);
const report = await valid.json();
assert.equal(report.reportId, url.pathname.split('/')[4], 'Downloaded report ID mismatch');
assert.ok(report.findings && report.evidence, 'Report missing findings or evidence');
console.log('PASS: signed report URL returns a JSON attachment containing the report.');
const modified = new URL(url);
const token = modified.searchParams.get('token');
modified.searchParams.set('token', (token[0] === '0' ? '1' : '0') + token.slice(1));
const invalid = await request(modified);
assert.equal(invalid.status, 404, `Tampered token returned HTTP ${invalid.status}`);
console.log('PASS: modified signature is rejected.');
const expired = new URL(url);
expired.searchParams.set('expires', '1000000000');
const old = await request(expired);
assert.equal(old.status, 404, `Expired timestamp returned HTTP ${old.status}`);
console.log('PASS: expired timestamp is rejected. No payments made.');
