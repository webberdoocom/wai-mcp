// Minimal MCP stdio smoke test. --live-dex enables catalogue GETs only.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { API_BASE, MAINNET } from '../src/core.mjs';

const liveDex = process.argv.includes('--live-dex');
const child = spawn(process.execPath, ['dist/server.mjs'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  stdio: ['pipe','pipe','pipe'],
  env: {
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    WAI_BASE_URL: API_BASE,
    WAI_NETWORK: MAINNET,
    WAI_DYNAMIC_DISCOVERY: liveDex ? 'on' : 'off',
    WAI_PAYMENT_MODE: 'off',
  },
});
let buffer=''; let messages=[]; let stderr=''; let launchError;
child.on('error', e => { launchError = e; });
child.stdin.on('error', e => { if (e.code !== 'EPIPE') stderr += e.message; });
child.stdout.on('data', d => {
  buffer += d.toString();
  const lines=buffer.split('\n');buffer=lines.pop();
  for(const line of lines) if(line.trim()) try { messages.push(JSON.parse(line)); } catch { stderr+='Invalid stdout JSON-RPC: '+line; }
});
child.stderr.on('data', d => stderr+=d.toString());
const send = (x) => child.stdin.write(JSON.stringify(x)+'\n');
async function awaitResponse(id) {
  for(let i=0;i<100;i++) {
    if (launchError) throw new Error('Could not launch MCP child process: ' + launchError.message);
    const hit=messages.find(x=>x.id===id);
    if(hit) return hit;
    await delay(50);
  }
  throw new Error('MCP response timed out: '+id+' '+stderr.slice(0,300));
}
try {
  send({jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', capabilities:{}, clientInfo:{name:'wai-local-test',version:'0.1'} }});
  const init=await awaitResponse(1);
  if(init.error) throw new Error(JSON.stringify(init.error));
  send({jsonrpc:'2.0',method:'notifications/initialized'});
  const deadline = Date.now() + 10000;
  let dex;
  for (let id = 2; ; id++) {
    send({jsonrpc:'2.0',id,method:'tools/list',params:{}});
    const list = await awaitResponse(id);
    const tools = list.result?.tools;
    assert.ok(Array.isArray(tools), 'MCP tools/list failed');
    for (const name of ['verify_uk_company','investigate_uk_company','inspect_smart_contract','check_token_allowance','inspect_uk_business_insolvency','inspect_website_trust']) {
      assert.ok(tools.some(tool => tool.name === name), 'Missing MCP tool: ' + name);
    }
    dex = tools.find(tool => tool.name === 'wai_dex_liquidity');
    if (!liveDex || dex || Date.now() >= deadline) break;
    await delay(250);
  }
  if(stderr.includes('Invalid stdout JSON-RPC')) throw new Error(stderr);
  if (liveDex) {
    assert.ok(dex, 'Live DEX tool missing from MCP tools/list');
    assert.match(dex.description, /Price: \$0\.02 USDC\./);
    assert.equal(dex.inputSchema.properties.chainId.const, 8453);
    console.log(`PASS: MCP discovered wai_dex_liquidity (dex-liquidity), 0.020000 USDC, Base Mainnet (${MAINNET}). No tool calls or payments.`);
  } else {
    process.stdout.write('PASS: MCP initialized and all six tools registered; no external API calls made.\n');
  }
} catch(e) {
  process.stderr.write('FAIL: '+e.message+'\n'); process.exitCode=1;
} finally {
  child.kill();
}
