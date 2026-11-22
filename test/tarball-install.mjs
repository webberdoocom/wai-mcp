// Installs the exact npm tarball to a disposable directory, launches the
// published binary, checks MCP initialise + tools/list, then removes temp files.
// Uses no buyer wallet and WAI_DYNAMIC_DISCOVERY=off: no WAI requests or payments.
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

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
try {
  const pack = spawnSync(process.execPath, [npmCli, 'pack', '--json', '--ignore-scripts', '--pack-destination', tmp], {
    cwd: root, encoding: 'utf8', shell: false, timeout: 60000, maxBuffer: 4 * 1024 * 1024,
  });
  if (pack.error || pack.status !== 0) throw new Error('npm pack failed: ' + (pack.error?.message || pack.stderr));
  const tgz = JSON.parse(pack.stdout)[0]?.filename;
  assert.match(tgz, /^webberdoo-wai-mcp-.*\.tgz$/);
  const pkgPath = join(tmp, 'package.json');
  await writeFile(pkgPath, JSON.stringify({ name: 'wai-mcp-clean-acceptance', version: '1.0.0', private: true, type: 'module' }));
  // Install runtime dependencies from the real package, not the development tree.
  npm('install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', '--fetch-retries=0', '--fetch-timeout=20000', join(tmp, tgz));
  const executable = join(tmp, 'node_modules', '@webberdoo', 'wai-mcp', 'bin', 'wai-mcp.mjs');
  const messages = [];
  let buffer = '';
  let errors = '';
  child = spawn(process.execPath, [executable], {
    cwd: tmp, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, WAI_PAYMENT_MODE: 'off', WAI_DYNAMIC_DISCOVERY: 'off', WAI_REPORT_DIR: '' },
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
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  const listing = await waitFor(2);
  const names = listing.result?.tools?.map(t => t.name) || [];
  for (const name of ['verify_uk_company', 'investigate_uk_company', 'inspect_smart_contract', 'check_token_allowance']) {
    assert.ok(names.includes(name), `Missing published MCP tool: ${name}`);
  }
  console.log(`PASS: clean npm tarball installed and registered ${names.length} MCP tools. No external calls or payments.`);
} finally {
  if (child) { child.kill(); await delay(100); }
  await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
