import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readCatalog, validateInputs, permittedDynamicPayment, fetchCatalog } from '../src/discovery.mjs';
import { makeRunner } from '../src/runner.mjs';
import { MAINNET, USDC } from '../src/core.mjs';
const base='https://wai.webberdoo.com';
const service=(id='wallet-counterparty')=>({id,name:'Wallet Counterparty',description:'Read-only counterparty report',available:true,endpoint:`${base}/api/v1/intelligence/${id}`, priceUsdc:'0.020000',inputSchema:{type:'object',additionalProperties:false,required:['chainId','address'],properties:{chainId:{type:'integer',enum:[8453]},address:{type:'string',pattern:'^0x[0-9a-fA-F]{40}$'}}}});
const wallet='0x'+'1'.repeat(40);
test('registers only new valid services, leaves original four static',()=>{
 const result=readCatalog({services:[service(), {...service('company-verification'),priceUsdc:'0.01'}, {...service('phishing'),endpoint:'https://other.example/api/v1/intelligence/phishing'}]});
 assert.deepEqual([...result.keys()],['wai_wallet_counterparty']);
 assert.equal(result.get('wai_wallet_counterparty').cents,2);
});
test('rejects dangerous catalogue endpoint and unsupported input schema',()=>{
 for(const endpoint of ['http://wai.webberdoo.com/api/v1/intelligence/x','https://wai.webberdoo.com.evil.test/api/v1/intelligence/x','https://wai.webberdoo.com/api/v1/intelligence/x?url=https://evil.test','https://wai.webberdoo.com/api/v1/intelligence/other']) {
   assert.equal(readCatalog({services:[{...service('x'),endpoint}]}).size,0);
 }
 assert.equal(readCatalog({services:[{...service('x'),inputSchema:{type:'object',required:[],properties:{url:{type:'array'}},additionalProperties:false}}]}).size,0);
});
test('validates properties and required inputs',()=>{
 const spec=[...readCatalog({services:[service()]}).values()][0];
 assert.deepEqual(validateInputs(spec,{chainId:8453,address:wallet}),{chainId:8453,address:wallet});
 assert.throws(()=>validateInputs(spec,{chainId:1,address:wallet}));
 assert.throws(()=>validateInputs(spec,{chainId:8453,address:wallet,extra:'abc'}));
 assert.throws(()=>validateInputs(spec,{address:wallet}));
});
test('new services are never payment enabled by default',()=>{
 const spec=[...readCatalog({services:[service()]}).values()][0];
 assert.equal(permittedDynamicPayment(spec,{}),false);
 assert.equal(permittedDynamicPayment(spec,{WAI_DYNAMIC_PAID_ALLOWLIST:'wallet-counterparty'}),true);
});
test('dynamic service can return an unsigned read-only challenge without a wallet',async()=>{
 const spec=[...readCatalog({services:[service()]}).values()][0];
 const challenge={x402Version:2,accepts:[{scheme:'exact',network:MAINNET,asset:USDC[MAINNET],amount:'20000',payTo:wallet}]};
 const fetchImpl=async(_url, _opts)=>new Response(JSON.stringify({error:'payment_required'}),{status:402,headers:{'payment-required':Buffer.from(JSON.stringify(challenge)).toString('base64')}});
 const runner=makeRunner({env:{WAI_PAYMENT_MODE:'off'},fetchImpl});
 const response=await runner.runDynamic(spec,{chainId:8453,address:wallet});
 assert.equal(response.status,'payment_required');assert.equal(response.priceUSDC,0.02);
});
test('catalogue loader enforces a fixed same-origin GET',async()=>{
 let seen;
 const fetched=await fetchCatalog(base, async (url,options)=>{seen={url,options};return new Response(JSON.stringify({services:[service()]}),{status:200,headers:{'content-type':'application/json'}});});
 assert.equal(seen.url,`${base}/api/v1/services`);
 assert.equal(seen.options.redirect,'error');
 assert.equal(fetched.size,1);
});
test('even with payments switched on, newly discovered services require allowlisting',async()=>{
 const spec=[...readCatalog({services:[service()]}).values()][0];
 const challenge={x402Version:2,accepts:[{scheme:'exact',network:MAINNET,asset:USDC[MAINNET],amount:'20000',payTo:wallet}]};
 const fetchImpl=async()=>new Response('',{status:402,headers:{'payment-required':Buffer.from(JSON.stringify(challenge)).toString('base64')}});
 let invoked=0;
 const runner=makeRunner({env:{WAI_PAYMENT_MODE:'on',WAI_EVM_PRIVATE_KEY:'0x'+'2'.repeat(64)},fetchImpl,paymentFetchFactory:async()=>{invoked++;return async()=>new Response('{}',{status:200})}});
 const result=await runner.runDynamic(spec,{chainId:8453,address:wallet});
 assert.equal(result.status,'payment_required');assert.equal(invoked,0);
});
