import test from 'node:test';
import assert from 'node:assert/strict';
import { SERVICES, postURL, parseConfig, validateChallenge } from '../src/core.mjs';
import { readCatalog } from '../src/discovery.mjs';
const base='https://wai.webberdoo.com';
for(const [tool,id,cents] of [['inspect_uk_business_insolvency','business-insolvency',3],['inspect_website_trust','website-trust',2]]) {
 test(`${tool} maps to fixed priced service and is excluded from dynamic duplicate discovery`,()=>{
  assert.equal(SERVICES[tool].id,id);assert.equal(SERVICES[tool].cents,cents);
  assert.equal(postURL(base,tool),`${base}/api/v1/intelligence/${id}`);
  const catalog={services:[{id,available:true,endpoint:`${base}/api/v1/intelligence/${id}`,priceUsdc:(cents/100).toFixed(6),inputSchema:{type:'object',additionalProperties:false,required:[],properties:{}}}]};
  assert.equal(readCatalog(catalog,base).size,0);
 });
 test(`${tool} validates fixed price and wallet bound`,()=>{
  const config=parseConfig({WAI_PAYMENT_MODE:'off',WAI_NETWORK:'eip155:8453',WAI_MAX_PER_CALL_USDC:'0.03',WAI_MAX_SESSION_USDC:'0.05',WAI_EXPECTED_PAY_TO:'0x1111111111111111111111111111111111111111'});
  const offer={scheme:'exact',network:'eip155:8453',asset:'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',amount:String(cents*10000),payTo:'0x1111111111111111111111111111111111111111'};
  assert.equal(validateChallenge({accepts:[offer]},config,tool),cents/100);
  assert.throws(()=>validateChallenge({accepts:[{...offer,amount:String((cents+1)*10000)}]},config,tool));
 });
}
