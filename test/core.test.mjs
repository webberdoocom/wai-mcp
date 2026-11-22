import test from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig, validateChallenge, extractChallenge, postURL, MAINNET, USDC, SEPOLIA } from '../src/core.mjs';
import { makeRunner } from '../src/runner.mjs';
const config = parseConfig({});
const challenge = (amount='10000', network=MAINNET) => ({ x402Version: 2, accepts: [{ scheme: 'exact', network, amount, asset: USDC[network], payTo: '0x1234567890123456789012345678901234567890' }] });
test('payments disabled by default and HTTPS base origin', () => {
  assert.equal(config.mode,'off');assert.equal(config.base,'https://wai.webberdoo.com');
  assert.throws(()=>parseConfig({WAI_BASE_URL:'http://evil.example'}));
  assert.throws(()=>parseConfig({WAI_BASE_URL:'https://wai.webberdoo.com/foo'}));
  assert.throws(()=>parseConfig({WAI_PAYMENT_MODE:'on'}));
});
test('correct four endpoints', () => {
  for (const name of ['verify_uk_company','investigate_uk_company','inspect_smart_contract','check_token_allowance']) assert.match(postURL(config.base,name), /^https:\/\/wai\.webberdoo\.com\/api\/v1\/intelligence\//);
});
test('only exact USDC and expected price accepted',()=>{
  assert.equal(validateChallenge(challenge(),config,'verify_uk_company'),0.01);
  assert.throws(()=>validateChallenge(challenge('40000'),config,'verify_uk_company'));
  assert.throws(()=>validateChallenge(challenge('999999'),config,'verify_uk_company'));
  assert.throws(()=>validateChallenge(challenge('10000', SEPOLIA),config,'verify_uk_company'));
  assert.throws(()=>validateChallenge({accepts: [...challenge().accepts,...challenge().accepts]},config,'verify_uk_company'));
  assert.throws(()=>validateChallenge({accepts:[{...challenge().accepts[0],asset:'0x0000000000000000000000000000000000000001'}]},config,'verify_uk_company'));
  assert.throws(()=>validateChallenge(challenge('10000'),config,'verify_uk_company',10));
});
test('validates raw x402 v2 402 and returns dry-run quote without payment',async()=>{
  let calls=0;
  const fetchImpl=async () => {calls++;return new Response(JSON.stringify({}),{status:402, headers:{'payment-required':Buffer.from(JSON.stringify(challenge())).toString('base64')}})};
  const runner=makeRunner({fetchImpl});
  const res=await runner.run('verify_uk_company',{companyNumber:'00000006'});
  assert.equal(res.status,'payment_required');assert.equal(res.priceUSDC,0.01);assert.equal(calls,1);
});
test('malformed payment challenge is rejected', async()=>{
 const response=new Response(null,{status:402,headers:{'payment-required':'not-base64'}});
 assert.throws(()=>extractChallenge(response));
});
test('successful free response remains readable without wallet',async()=>{
 const runner=makeRunner({fetchImpl:async()=>new Response(JSON.stringify({ok:true}),{status:200})});
 assert.deepEqual((await runner.run('verify_uk_company',{companyNumber:'00000006'})).response,{ok:true});
});
test('opted-in mock payment consumes budget once and returns JSON',async()=>{
 const env={WAI_PAYMENT_MODE:'on',WAI_EVM_PRIVATE_KEY:'0x'+'1'.repeat(64),WAI_MAX_SESSION_USDC:'0.03'};
 let signed=0;
 const fetchImpl=async()=>new Response(null,{status:402,headers:{'payment-required':Buffer.from(JSON.stringify(challenge())).toString('base64')}});
 const runner=makeRunner({env,fetchImpl,paymentFetchFactory:async()=>async()=>{signed++;return new Response('{"report":1}',{status:200});}});
 assert.equal((await runner.run('verify_uk_company',{companyNumber:'00000006'})).status,'ok');
 assert.equal(signed,1);
});
