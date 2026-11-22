import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePaymentRequest } from '../src/runner.mjs';
const url='https://wai.webberdoo.com/api/v1/intelligence/company-verification';
const body=JSON.stringify({companyNumber:'00000006'});
test('payment guard supports URL strings and Fetch Request objects', async () => {
  for (const input of [url, new URL(url), new Request(url,{method:'POST',body,headers:{'content-type':'application/json'}})]) {
    const init = input instanceof Request ? undefined : {method:'POST',body};
    const normalized = await normalizePaymentRequest(input,init,url,body);
    assert.equal(normalized.signed,false);
  }
});
test('payment guard detects signed Request headers, without changing request', async () => {
  const request = new Request(url,{method:'POST',body,headers:{'payment-signature':'redacted-mock-header'}});
  const normalized = await normalizePaymentRequest(request,undefined,url,body);
  assert.equal(normalized.signed,true);
  assert.equal(normalized.headers.get('payment-signature'),'redacted-mock-header');
});
test('payment guard rejects changed destination, verb, and payload', async () => {
  await assert.rejects(normalizePaymentRequest(url+'?extra=1',{method:'POST',body},url,body),/unexpected URL/);
  await assert.rejects(normalizePaymentRequest(url,{method:'GET'},url,body),/HTTP method/);
  await assert.rejects(normalizePaymentRequest(url,{method:'POST',body:'{}'},url,body),/request body/);
  await assert.rejects(normalizePaymentRequest(new Request(url,{method:'POST',body:'{}'}),undefined,url,body),/request body/);
});
