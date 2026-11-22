#!/usr/bin/env node
/** One-shot WAI MCP x402 acceptance purchase. Never prints secrets or report data. */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { MAINNET } from '../src/core.mjs';

const required = {
  WAI_LIVE_PURCHASE_CONFIRM: 'PAY-EXACTLY-0.01-USDC',
  WAI_PAYMENT_MODE: 'on',
  WAI_NETWORK: MAINNET,
  WAI_MAX_PER_CALL_USDC: '0.01',
  WAI_MAX_SESSION_USDC: '0.01',
};
for (const [key, value] of Object.entries(required)) {
  if (process.env[key] !== value) {
    console.error(`REFUSED: ${key} must equal ${value}. No request made.`);
    process.exit(1);
  }
}
if (!/^0x[0-9a-fA-F]{64}$/.test(process.env.WAI_EVM_PRIVATE_KEY || '')) {
  console.error('REFUSED: missing buyer wallet private key. No request made.'); process.exit(1);
}
if (!/^0x[0-9a-fA-F]{40}$/.test(process.env.WAI_EXPECTED_PAY_TO || '')) {
  console.error('REFUSED: expected WAI payment receiver address is required. No request made.'); process.exit(1);
}
if (process.env.WAI_BASE_URL && process.env.WAI_BASE_URL !== 'https://wai.webberdoo.com') {
  console.error('REFUSED: live purchase restricted to https://wai.webberdoo.com. No request made.'); process.exit(1);
}
const cwd = fileURLToPath(new URL('../', import.meta.url));
const env = { ...process.env, WAI_BASE_URL: 'https://wai.webberdoo.com' };
let child;
let output = '';
let errors = '';
let closed = false;
const waiting = new Map();
const failPending = (message) => { for (const w of waiting.values()) w.reject(new Error(message)); waiting.clear(); };
function send(obj) { if (!child || closed) throw new Error('MCP process closed'); child.stdin.write(JSON.stringify(obj) + '\n'); }
async function rpc(id, method, params) {
  const pending = new Promise((resolve, reject) => waiting.set(id, { resolve, reject }));
  send({jsonrpc:'2.0', id, method, params});
  return Promise.race([pending, delay(45000).then(() => { throw new Error('MCP request timed out; payment state may be uncertain. DO NOT RETRY until checking WAI admin and wallet.'); })]);
}
function stdoutHandler(buf) {
  output += String(buf);
  const lines = output.split('\n'); output = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    let msg; try { msg = JSON.parse(line); } catch { failPending('Malformed MCP output'); return; }
    if (msg.id !== undefined && waiting.has(msg.id)) {const w = waiting.get(msg.id); waiting.delete(msg.id); w.resolve(msg);}
  }
}
try {
  console.log('WAI MCP live acceptance: ONE Company Verification request; Base Mainnet; EXACT $0.01 USDC cap');
  console.log('Buyer private key and report contents will NOT be printed. Do not rerun following an uncertain result.');
  child = spawn(process.execPath, ['dist/server.mjs'], {cwd, env, stdio:['pipe','pipe','pipe']});
  child.on('error', e => {closed = true; failPending(`Could not start MCP runtime (${e.code || 'error'})`);});
  child.on('exit', code => {closed = true; failPending(`MCP runtime exited (${code}). Verify wallet and WAI admin before any retry.`);});
  child.stdout.on('data', stdoutHandler);
  child.stderr.on('data', chunk => {errors += String(chunk).replace(/0x[0-9a-fA-F]{64}/g, '[redacted-key]'); errors = errors.slice(-1000);});
  const init = await rpc(1, 'initialize', {protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'wai-phase5-one-purchase',version:'0.1.0'}});
  if (init.error) throw new Error('MCP initialization failed');
  send({jsonrpc:'2.0',method:'notifications/initialized'});
  const list = await rpc(2, 'tools/list', {});
  if (!list.result?.tools?.some(t => t.name === 'verify_uk_company')) throw new Error('Company Verification MCP tool missing');
  console.log('MCP initialized; invoking one paid tool call now.');
  const answer = await rpc(3,'tools/call', {name:'verify_uk_company',arguments:{companyNumber:'00000006'}});
  if (answer.error) throw new Error('MCP returned protocol-level error; payment state may be uncertain');
  const text = answer.result?.content?.find(c => c.type === 'text')?.text;
  // MCP tool errors are often plain text. Classify them without printing
  // untrusted text, keys, signed payment headers, or report content.
  if (answer.result?.isError) {
    const message = String(text || '');
    const category = /Payment quote changed/i.test(message) ? 'payment_quote_changed'
      : /payment.*(not accepted|402)|HTTP 402/i.test(message) ? 'payment_not_accepted'
      : /Unexpected repeated|extra unsigned|premature signed|unexpected HTTP method|unexpected URL|changed the report request body/i.test(message) ? 'payment_sdk_request_guard'
      : /payment.*(exceeds|receiver|recipient|asset|network)|permitted.*option|challenge/i.test(message) ? 'payment_validation'
      : /timed out|abort|fetch failed|network/i.test(message) ? 'network_or_timeout'
      : /WAI returned HTTP (\d{3})/i.test(message) ? 'wai_http_error_' + message.match(/WAI returned HTTP (\d{3})/i)[1]
      : /sign|wallet|account|private.?key/i.test(message) ? 'signing_or_wallet'
      : 'unclassified_mcp_tool_error';
    throw new Error(`MCP tool error category: ${category}. No report returned; payment state may be uncertain`);
  }
  let result; try { result = JSON.parse(text); } catch { throw new Error('MCP returned non-JSON success content; payment state may be uncertain'); }
  if (result?.status !== 'ok' || result?.paymentAttempted !== true || !result.response) {
    throw new Error('Paid tool call did not report successful structured JSON. Verify settlement and report in WAI admin before retrying.');
  }
  console.log('PASS: Paid MCP tools/call returned successful structured JSON report.');
  console.log('ACTION: Verify exactly one 0.01 USDC settlement and report in WAI admin, and the buyer wallet transaction.');
} catch(e) {
  console.error('FAIL / UNCERTAIN:', e instanceof Error ? e.message : String(e));
  console.error('Do not run this paid test again until checking WAI payment records and the buyer wallet.');
  process.exitCode = 1;
} finally {
  if (child) child.kill();
  for (const key of ['WAI_EVM_PRIVATE_KEY']) delete env[key];
}
