// Minimal MCP stdio smoke test; requires npm install, performs no WAI HTTP request.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const child = spawn(process.execPath, ['dist/server.mjs'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  stdio: ['pipe','pipe','pipe'],
  env: {...process.env, WAI_DYNAMIC_DISCOVERY: 'off', WAI_PAYMENT_MODE: 'off'}
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
  send({jsonrpc:'2.0',id:2,method:'tools/list',params:{}});
  const list=await awaitResponse(2);
  const tools=list.result?.tools?.map(x=>x.name) || [];
  for(const name of ['verify_uk_company','investigate_uk_company','inspect_smart_contract','check_token_allowance']) {
    if(!tools.includes(name)) throw new Error('Missing MCP tool: '+name);
  }
  if(stderr.includes('Invalid stdout JSON-RPC')) throw new Error(stderr);
  process.stdout.write('PASS: MCP initialized and all four tools registered; no external API calls made.\n');
} catch(e) {
  process.stderr.write('FAIL: '+e.message+'\n'); process.exitCode=1;
} finally {
  child.kill();
}
