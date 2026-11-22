#!/usr/bin/env node
/** One explicitly confirmed live WAI MCP purchase for a selected remaining tool.
 * Does not print private keys, signed authorisations or report content.
 * Do not retry an uncertain result before checking the wallet and WAI admin.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { MAINNET } from '../src/core.mjs';

const cases = Object.freeze({
  investigate_uk_company: { cents:3, fields: ['companyNumber'] },
  inspect_smart_contract: { cents:3, fields: ['chainId','contractAddress'] },
  check_token_allowance: { cents:2, fields: ['chainId','ownerAddress','tokenAddress','spenderAddress','includePermit2'] },
});
const service=process.argv[2];
function refuse(msg){console.error(`REFUSED: ${msg}. No paid request started.`);process.exit(1);}
if (!Object.hasOwn(cases,service)) refuse('Choose exactly one permitted Phase 6 service');
const spec=cases[service], price=(spec.cents/100).toFixed(2);
const required={
  WAI_LIVE_PURCHASE_CONFIRM:`PAY-${service}-${price}-USDC`,
  WAI_PAYMENT_MODE:'on', WAI_NETWORK:MAINNET,
  WAI_MAX_PER_CALL_USDC:price, WAI_MAX_SESSION_USDC:price,
};
for(const [k,v] of Object.entries(required)) if(process.env[k]!==v) refuse(`${k} must equal ${v}`);
if(!/^0x[0-9a-fA-F]{64}$/.test(process.env.WAI_EVM_PRIVATE_KEY||'')) refuse('Dedicated buyer wallet key is absent or malformed');
if(!/^0x[0-9a-fA-F]{40}$/.test(process.env.WAI_EXPECTED_PAY_TO||'')) refuse('Expected receiving address is absent or malformed');
if(process.env.WAI_BASE_URL && process.env.WAI_BASE_URL !== 'https://wai.webberdoo.com') refuse('Only the production WAI origin is permitted');
let args;
try {args=JSON.parse(process.env.WAI_TEST_INPUT_JSON||'null');}catch{refuse('Invalid test input JSON');}
if(!args || typeof args!=='object' || Array.isArray(args)) refuse('Input must be a JSON object');
const keys=Object.keys(args).sort();
if(keys.some(k=>!spec.fields.includes(k)) || spec.fields.filter(k=>k!=='includePermit2').some(k=>!(k in args))) refuse('Unexpected or missing tool input fields');
const address=/^0x[0-9a-fA-F]{40}$/;
if(service==='investigate_uk_company') {
  if(typeof args.companyNumber!=='string'|| !/^\d{8}$/.test(args.companyNumber)) refuse('Company number must contain eight digits');
}else {
  if(args.chainId!==8453) refuse('Phase 6 only tests chainId 8453 (Base Mainnet)');
  const fields=service==='inspect_smart_contract'?['contractAddress']:['ownerAddress','tokenAddress','spenderAddress'];
  if(fields.some(k=>typeof args[k]!=='string'||!address.test(args[k]))) refuse('One or more EVM addresses are invalid');
  if('includePermit2' in args && typeof args.includePermit2!=='boolean') refuse('includePermit2 must be boolean');
}
const cwd=fileURLToPath(new URL('../',import.meta.url));
let child;let buffer='';let closed=false;let nextId=0;
const pending=new Map();
function failPending(msg){for(const p of pending.values())p.reject(new Error(msg));pending.clear();}
function send(obj){if(!child||closed)throw new Error('MCP process unavailable');child.stdin.write(JSON.stringify(obj)+'\n');}
async function rpc(method,params){
 const id=++nextId;
 const response=new Promise((resolve,reject)=>pending.set(id,{resolve,reject}));
 send({jsonrpc:'2.0',id,method,params});
 try{return await Promise.race([response,delay(45000).then(()=>{throw new Error('MCP timeout; payment state uncertain');})]);}
 finally{pending.delete(id);}
}
function readOutput(chunk){
 buffer+=String(chunk);const lines=buffer.split('\n');buffer=lines.pop();
 for(const line of lines){if(!line.trim())continue;let msg;try{msg=JSON.parse(line);}catch{failPending('Malformed MCP message');continue;}
   if(msg.id!==undefined&&pending.has(msg.id)){const p=pending.get(msg.id);pending.delete(msg.id);p.resolve(msg);}}
}
const categorise = msg =>
 /payment.*(not accepted|402)|HTTP 402/i.test(msg)?'payment_not_accepted':
 /Payment quote changed/i.test(msg)?'payment_quote_changed':
 /unexpected (URL|HTTP method)|report request body|extra unsigned|premature signed/i.test(msg)?'adapter_payment_guard':
 /payment.*(exceeds|recipient|asset|network)|challenge/i.test(msg)?'quote_validation':
 /sign|wallet|private.?key/i.test(msg)?'signing_or_wallet':
 /timeout|timed out|abort|fetch failed/i.test(msg)?'network_or_timeout':
 /WAI returned HTTP \d{3}/i.test(msg)?'wai_http_error':
 'other_tool_error';
try {
 console.log(`ONE LIVE WAI MCP PURCHASE: ${service} | ${price} USDC | Base Mainnet`);
 console.log('One paid tool call only. Do not repeat after an uncertain response.');
 const env={...process.env,WAI_BASE_URL:'https://wai.webberdoo.com'};
 child=spawn(process.execPath,['dist/server.mjs'],{cwd,env,stdio:['pipe','pipe','pipe']});
 child.on('error',e=>{closed=true;failPending('MCP runtime could not start');});
 child.on('exit',()=>{closed=true;failPending('MCP runtime exited; payment state must be checked');});
 child.stdout.on('data',readOutput);
 child.stderr.on('data',()=>{}); // Never display stderr, which may contain request or signer details.
 const init=await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'wai-phase6-one-purchase',version:'0.1.0'}});
 if(init.error)throw new Error('MCP initialization failed');
 send({jsonrpc:'2.0',method:'notifications/initialized'});
 const list=await rpc('tools/list',{});
 if(!list.result?.tools?.some(t=>t.name===service))throw new Error('Requested MCP tool not registered');
 console.log('MCP initialized. Invoking exactly one paid tool call.');
 const answer=await rpc('tools/call',{name:service,arguments:args});
 if(answer.error)throw new Error('MCP protocol error; outcome uncertain');
 const text=answer.result?.content?.find(c=>c.type==='text')?.text;
 if(answer.result?.isError)throw new Error('MCP tool error category: '+categorise(String(text||'')));
 let data;try{data=JSON.parse(text);}catch{throw new Error('MCP returned non-JSON content');}
 if(data?.status!=='ok'||data?.paymentAttempted!==true||!data.response||typeof data.response!=='object')throw new Error('MCP paid response missing successful structured JSON');
 console.log(`PASS: ${service} paid MCP tool returned structured JSON. Test price: ${price} USDC.`);
 console.log('ACTION: Confirm one matching settlement, report and buyer-wallet transaction in WAI admin.');
}catch(err){
 console.error('FAIL / UNCERTAIN: '+(err instanceof Error?err.message:'Unexpected test error'));
 console.error('STOP: Check WAI payments and the buyer wallet before any retry.');
 process.exitCode=1;
}finally{if(child)child.kill();}
