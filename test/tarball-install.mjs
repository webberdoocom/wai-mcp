// Install and exercise the published binary against a loopback WAI fixture.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

import { MAINNET, SERVICES, USDC, VERSION } from '../src/core.mjs';
import { DEX_INPUT_SCHEMA, DEX_TOOL_NAME } from '../src/discovery.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run with npm run test:tarball');
const tmp = await mkdtemp(join(tmpdir(), 'wai-mcp-clean-install-'));
const npm = (...args) => {
  const result = spawnSync(process.execPath, [npmCli, ...args], {
    cwd: tmp, encoding: 'utf8', shell: false, timeout: 90000,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, WAI_PAYMENT_MODE: 'off', npm_config_update_notifier: 'false' },
  });
  if (result.error || result.status !== 0) throw new Error(`npm command failed: ${result.error?.message || (result.stderr || '').slice(0, 900)}`);
  return result;
};
let child;
let mock;
const firstAddress = '0x' + '1'.repeat(40);
const secondAddress = '0x' + '2'.repeat(40);
const zeroAddress = '0x' + '0'.repeat(40);
const dexName = DEX_TOOL_NAME;
const services = { ...SERVICES, [dexName]: { id: 'dex-liquidity', cents: 2 } };
const apiPath = name => '/api/v1/intelligence/' + services[name].id;
const requests = [];
let catalogueMode = 'valid';
let releaseCatalogue;
const catalogueGate = new Promise(resolve => { releaseCatalogue = resolve; });

async function stopClient() {
  if (child && child.exitCode === null && child.signalCode === null) {
    await new Promise(resolve => {
      child.once('close', resolve);
      child.kill();
    });
  }
  child = undefined;
}

try {
  const pack = spawnSync(process.execPath, [npmCli, 'pack', '--json', '--ignore-scripts', '--pack-destination', tmp], {
    cwd: root, encoding: 'utf8', shell: false, timeout: 60000, maxBuffer: 4 * 1024 * 1024,
  });
  if (pack.error || pack.status !== 0) throw new Error('npm pack failed: ' + (pack.error?.message || pack.stderr));
  const packed = JSON.parse(pack.stdout)[0];
  assert.equal(packed.version, VERSION);
  assert.ok(packed.files.every(({ path }) => !/^(?:RUN-PHASE.*\.ps1|test\/live-paid-.*\.mjs)$/i.test(path)));
  const tgz = packed.filename;
  assert.match(tgz, /^webberdoo-wai-mcp-.*\.tgz$/);
  const pkgPath = join(tmp, 'package.json');
  await writeFile(pkgPath, JSON.stringify({ name: 'wai-mcp-clean-acceptance', version: '1.0.0', private: true, type: 'module' }));
  // Install runtime dependencies from the real package, not the development tree.
  npm('install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', '--fetch-retries=0', '--fetch-timeout=20000', join(tmp, tgz));
  mock = createServer(async (request, response) => {
    if (request.url === '/api/v1/services' && request.method === 'GET') {
      if (catalogueMode === 'unavailable') {
        response.writeHead(503).end();
        return;
      }
      if (catalogueMode === 'invalid') {
        response.writeHead(200, { 'content-type': 'application/json' }).end('{');
        return;
      }
      await catalogueGate;
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ services: [{
        id: 'dex-liquidity', name: 'DEX Liquidity Intelligence', description: 'DEX liquidity report',
        available: true, endpoint: apiPath(dexName), priceUsdc: catalogueMode === 'valid' ? '0.020000' : '0.030000',
        payment: { network: MAINNET, asset: USDC[MAINNET] }, inputSchema: DEX_INPUT_SCHEMA,
      }] }));
      return;
    }
    const name = Object.keys(services).find(tool => apiPath(tool) === request.url);
    if (!name || request.method !== 'POST' || request.headers['payment-signature'] || request.headers['x-payment']) {
      response.writeHead(400).end();
      return;
    }
    const body = [];
    for await (const chunk of request) body.push(chunk);
    requests.push({ name, body: JSON.parse(Buffer.concat(body)), agent: request.headers['user-agent'] });
    const quote = { x402Version: 2, accepts: [{
      scheme: 'exact', network: MAINNET, asset: USDC[MAINNET],
      amount: String(services[name].cents * 10000), payTo: firstAddress,
    }] };
    response.writeHead(402, { 'payment-required': Buffer.from(JSON.stringify(quote)).toString('base64') }).end();
  });
  await new Promise((resolve, reject) => {
    mock.once('error', reject);
    mock.listen(0, '127.0.0.1', resolve);
  });
  const executable = join(tmp, 'node_modules', '@webberdoo', 'wai-mcp', 'bin', 'wai-mcp.mjs');
  async function startClient() {
    const messages = [];
    let buffer = '';
    let errors = '';
    child = spawn(process.execPath, [executable], {
      cwd: tmp, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
        WAI_BASE_URL: 'http://127.0.0.1:' + mock.address().port,
        WAI_PAYMENT_MODE: 'off',
      },
    });
    child.on('error', e => { errors += 'Launch: ' + e.message; });
    child.stdin.on('error', () => {});
    child.stderr.on('data', d => { errors += d.toString(); });
    child.stdout.on('data', d => {
      buffer += d.toString();
      const lines = buffer.split('\n'); buffer = lines.pop();
      for (const line of lines) if (line.trim()) {
        try { messages.push(JSON.parse(line)); } catch { errors += 'Non-JSON stdout'; }
      }
    });
    const send = message => child.stdin.write(JSON.stringify(message) + '\n');
    const waitFor = async id => {
      for (let i = 0; i < 120; i++) {
        const result = messages.find(m => m.id === id);
        if (result) return result;
        if (child.exitCode !== null || errors.includes('Launch:')) break;
        await delay(50);
      }
      throw new Error('Tarball MCP runtime did not respond. ' + errors.slice(0, 350));
    };
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'wai-clean-install', version: '1.0' },
    }});
    const init = await waitFor(1);
    assert.ok(init.result && !init.error, 'MCP initialize failed');
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    assert.equal(init.result.serverInfo.version, VERSION);
    let nextId = 2;
    const rpc = async (method, params) => {
      const id = nextId++;
      send({ jsonrpc: '2.0', id, method, params });
      return waitFor(id);
    };
    return rpc;
  }

  const rpc = await startClient();
  // Keep the catalogue response pending until this first list is checked.
  const first = await rpc('tools/list', {});
  const tools = first.result?.tools ?? [];
  assert.deepEqual(tools.map(tool => tool.name).sort(), Object.keys(services).sort());
  for (const tool of tools) {
    const price = (services[tool.name].cents / 100).toFixed(2);
    assert.ok(tool.description.includes('$' + price + ' USDC'), 'Missing price for ' + tool.name);
  }
  releaseCatalogue();
  const schema = tools.find(tool => tool.name === dexName).inputSchema;
  assert.deepEqual(schema.if, { required: ['poolAddress'] });
  assert.equal(schema.then.properties.protocol.not.const, 'uniswap-v4');
  assert.equal(schema.then.properties.tokenOut, false);
  assert.deepEqual(schema.else.required, ['tokenOut']);
  assert.deepEqual(schema.else.oneOf.find(rule => rule.properties.protocol.const === 'uniswap-v4').required, ['fee', 'tickSpacing']);

  const contract = { chainId: 84532, contractAddress: firstAddress };
  const allowance = { chainId: 8453, ownerAddress: firstAddress, tokenAddress: secondAddress, spenderAddress: firstAddress, includePermit2: false };
  const dex = { chainId: 8453, protocol: 'uniswap-v3', tokenIn: firstAddress };
  for (const [name, args] of [
    ['verify_uk_company', { companyNumber: 'SC001000' }],
    ['investigate_uk_company', { companyNumber: 'oc12345a' }],
    ['inspect_uk_business_insolvency', { companyNumber: '00000007' }],
    ['inspect_website_trust', { domain: 'iana.org' }],
    ['inspect_smart_contract', contract],
    ['check_token_allowance', allowance],
    [dexName, { ...dex, poolAddress: secondAddress }],
    [dexName, { ...dex, tokenOut: secondAddress, fee: 500, tradeSizes: ['2'] }],
  ]) {
    const reply = await rpc('tools/call', { name, arguments: args });
    assert.ok(reply.result && !reply.result.isError, JSON.stringify(reply));
    const quote = JSON.parse(reply.result.content[0].text);
    assert.equal(quote.status, 'payment_required');
    assert.equal(quote.network, MAINNET);
    assert.equal(quote.priceUSDC, services[name].cents / 100);
    assert.deepEqual(requests.at(-1), { name, body: args, agent: 'wai-mcp/' + VERSION });
  }
  assert.equal(requests.length, 8);

  for (const [name, args] of [
    ['verify_uk_company', { companyNumber: 'SC10' }],
    ['inspect_smart_contract', { ...contract, chainId: 1 }],
    ['inspect_smart_contract', { ...contract, contractAddress: zeroAddress }],
    ['check_token_allowance', { ...allowance, spenderAddress: zeroAddress }],
    [dexName, { ...dex, poolAddress: secondAddress, fee: 500 }],
    [dexName, { ...dex, tokenOut: secondAddress }],
    [dexName, { ...dex, protocol: 'uniswap-v4', poolAddress: secondAddress }],
  ]) {
    const reply = await rpc('tools/call', { name, arguments: args });
    assert.ok(reply.error || reply.result?.isError, 'Invalid arguments were accepted for ' + name);
  }
  assert.equal(requests.length, 8, 'Invalid arguments must be rejected before reaching WAI');
  await stopClient();

  for (catalogueMode of ['unavailable', 'invalid', 'incompatible']) {
    const call = await startClient();
    const reply = await call('tools/call', { name: dexName, arguments: { ...dex, poolAddress: secondAddress } });
    assert.equal(reply.result?.isError, true, catalogueMode);
    assert.match(reply.result.content[0].text, /DEX Liquidity Intelligence is unavailable/);
    assert.equal(requests.length, 8, 'Invalid catalogue must block DEX before an intelligence POST');
    const listing = await call('tools/list', {});
    assert.deepEqual(listing.result?.tools?.map(tool => tool.name).sort(), Object.keys(services).sort());
    await stopClient();
  }
  console.log('PASS: the installed tarball listed seven priced tools on its first response with a delayed catalogue.');
  console.log('PASS: all seven quote paths worked, and unavailable, invalid and incompatible catalogues blocked DEX before an intelligence POST. No payments.');
} finally {
  await stopClient();
  if (mock) { mock.closeAllConnections(); mock.close(); }
  await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
