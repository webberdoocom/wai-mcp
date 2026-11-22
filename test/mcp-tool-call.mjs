#!/usr/bin/env node
/**
 * Full MCP JSON-RPC tool-call acceptance test.
 * Default: localhost mock HTTP 402, no payments or external requests.
 * --live: 4 unsigned POSTs to real WAI, no wallet/payment attempts.
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { MAINNET, SEPOLIA, USDC, SERVICES } from '../src/core.mjs';

const live = process.argv.includes('--live');
const project = fileURLToPath(new URL('../', import.meta.url));
const tests = [
  ['verify_uk_company', { companyNumber: '00000006' }],
  ['investigate_uk_company', { companyNumber: '00000006' }],
  ['inspect_smart_contract', { chainId: 8453, contractAddress: USDC[MAINNET] }],
  ['check_token_allowance', { chainId: 8453, ownerAddress: '0x000000000000000000000000000000000000dEaD', tokenAddress: USDC[MAINNET], spenderAddress: '0x0000000000000000000000000000000000000001', includePermit2: false }],
];
const recipient = '0x1234567890123456789012345678901234567890';
const paymentRequired = (cents) => ({
  x402Version: 2,
  accepts: [SEPOLIA, MAINNET].map(network => ({
    scheme: 'exact', network, amount: String(cents * 10000), asset: USDC[network], payTo: recipient
  })),
});
let mockedRequests = 0;
let server;
let child;
let buffer = '';
let stderr = '';
let pending = new Map();
let childError;
let childExit;

async function startMockServer() {
  server = createServer(async (req, res) => {
    mockedRequests++;
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const target = Object.entries(SERVICES).find(([, v]) => req.url === `/api/v1/intelligence/${v.id}`);
      if (!target || req.method !== 'POST' || req.headers['payment-signature'] || req.headers['x-payment']) {
        res.writeHead(400).end('Unexpected request'); return;
      }
      const name = target[0];
      if (name.startsWith('verify_') || name.startsWith('investigate_')) {
        if (body.companyNumber !== '00000006') throw new Error('Bad payload');
      } else if (!body.chainId) throw new Error('Missing chainId');
      const quote = paymentRequired(target[1].cents);
      res.writeHead(402, { 'content-type': 'application/json', 'payment-required': Buffer.from(JSON.stringify(quote)).toString('base64') });
      res.end(JSON.stringify({error:'Payment Required'}));
    } catch {
      res.writeHead(400).end('Invalid request');
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return `http://127.0.0.1:${server.address().port}`;
}
function send(id, method, params) {
  child.stdin.write(JSON.stringify({jsonrpc:'2.0', id, method, params}) + '\n');
}
async function rpc(id, method, params) {
  if (childError) throw childError;
  const promise = new Promise((resolve, reject) => pending.set(id, {resolve, reject}));
  send(id, method, params);
  return Promise.race([promise, sleep(25000).then(() => {throw new Error(`Timeout awaiting MCP response ${id}: ${stderr.slice(-500)}`);})]);
}
function onStdout(chunk) {
  buffer += String(chunk);
  const parts = buffer.split('\n'); buffer = parts.pop();
  for (const line of parts) {
    if (!line.trim()) continue;
    let data;
    try { data = JSON.parse(line); } catch { throw new Error(`Non-JSON stdout: ${line.slice(0,300)}`); }
    if (data.id != null && pending.has(data.id)) {
      const wait = pending.get(data.id); pending.delete(data.id); wait.resolve(data);
    }
  }
}
try {
  const base = live ? 'https://wai.webberdoo.com' : await startMockServer();
  child = spawn(process.execPath, ['dist/server.mjs'], {
    cwd: project, stdio: ['pipe','pipe','pipe'],
    env: {
      ...process.env,
      WAI_BASE_URL: base,
      WAI_NETWORK: MAINNET,
      WAI_DYNAMIC_DISCOVERY: 'off', WAI_PAYMENT_MODE: 'off',
      WAI_EVM_PRIVATE_KEY: '',
      WAI_MAX_PER_CALL_USDC: '0.03',
      WAI_MAX_SESSION_USDC: '0.10',
      WAI_EXPECTED_PAY_TO: '',
    }
  });
  child.on('error', e => { childError = e; for (const p of pending.values()) p.reject(e); });
  child.on('exit', (code) => { childExit = code; for (const p of pending.values()) p.reject(new Error(`MCP child exited (${code}); ${stderr.slice(-400)}`)); });
  child.stdout.on('data', onStdout);
  child.stderr.on('data', chunk => {stderr += String(chunk);});
  child.stdin.on('error', e => {if (e.code !== 'EPIPE') childError=e;});
  const init = await rpc(1, 'initialize', { protocolVersion:'2025-06-18', capabilities:{}, clientInfo:{name:'wai-mcp-phase4-test',version:'0.1.0'} });
  if (init.error) throw new Error(`Initialize error: ${JSON.stringify(init.error)}`);
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'}) + '\n');
  const list = await rpc(2, 'tools/list', {});
  if (list.error) throw new Error(`List error: ${JSON.stringify(list.error)}`);
  const tools = new Set(list.result?.tools?.map(x => x.name) || []);
  for (const [name] of tests) if (!tools.has(name)) throw new Error(`Missing tool: ${name}`);
  console.log(`WAI MCP tool-call integration (${live ? 'LIVE read-only' : 'local mocked challenge'})`);
  console.log('Payment mode: OFF; wallet: NONE; no signing or payment');
  let i = 0;
  for (const [name, args] of tests) {
    const response = await rpc(10 + i++, 'tools/call', { name, arguments: args });
    if (response.error) throw new Error(`${name}: ${JSON.stringify(response.error)}`);
    if (response.result?.isError) throw new Error(`${name}: ${response.result?.content?.[0]?.text || 'Tool error'}`);
    const result = JSON.parse(response.result?.content?.[0]?.text || 'null');
    const expectPrice = SERVICES[name].cents / 100;
    if (result?.status !== 'payment_required' || result?.network !== MAINNET || result?.priceUSDC !== expectPrice)
      throw new Error(`${name}: unexpected response ${JSON.stringify(result).slice(0,400)}`);
    console.log(`PASS  ${name.padEnd(26)} MCP tools/call -> payment_required $${expectPrice.toFixed(2)} (unsigned)`);
  }
  if (!live && mockedRequests !== 4) throw new Error(`Expected 4 HTTP requests, received ${mockedRequests}`);
  console.log(`PASS: 4/4 MCP tools/call requests complete; no payment attempted.`);
} catch (error) {
  console.error('FAIL:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  if (child && childExit === undefined) child.kill();
  if (server) await new Promise(resolve => server.close(resolve));
}
