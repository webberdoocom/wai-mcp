import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const directory = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const server = JSON.parse(readFileSync(resolve(directory, 'server.json'), 'utf8'));
const lock = JSON.parse(readFileSync(resolve(directory, 'package-lock.json'), 'utf8'));
assert.equal(lock.version, pkg.version);
assert.equal(lock.packages[''].version, pkg.version);
assert.deepEqual(lock.packages[''].dependencies, pkg.dependencies);
assert.equal(server.name, pkg.mcpName);
assert.equal(server.version, pkg.version);
assert.equal(server.packages[0].identifier, pkg.name);
assert.equal(server.packages[0].version, pkg.version);
assert.equal(server.packages[0].transport.type, 'stdio');
assert.equal(pkg.publishConfig.access, 'public');
assert.ok(!pkg.private);
assert.equal(pkg.bin?.['wai-mcp'], 'bin/wai-mcp.mjs');
assert.match(pkg.scripts.start, /^node /);

// Invoke npm through Node directly: never use shell:true with unescaped arguments.
// npm_execpath is set by npm run on both Windows and Unix.
const npmCli = process.env.npm_execpath;
if (!npmCli || !existsSync(npmCli)) {
  throw new Error('Run this test with npm run test:package so npm_execpath is set');
}
const proc = spawnSync(process.execPath, [npmCli, 'pack', '--dry-run', '--json', '--ignore-scripts'], {
  cwd: directory, encoding: 'utf8', shell: false, maxBuffer: 4 * 1024 * 1024,
  env: { ...process.env, npm_config_update_notifier: 'false' },
});
if (proc.error) throw proc.error;
if (proc.status !== 0) throw new Error('npm pack dry run failed: ' + (proc.stderr || '').slice(0, 500));
const listing = JSON.parse(proc.stdout)[0]?.files?.map(f => f.path) || [];
const expected = [
  "LICENSE",
  "README.md",
  "bin/wai-mcp.mjs",
  "dist/server.mjs",
  "examples/mcp-host.json",
  "package.json",
  "server.json",
  "src/core.mjs",
  "src/discovery.mjs",
  "src/report-files.mjs",
  "src/runner.mjs"
];
assert.deepEqual(listing.sort(), expected);
if (existsSync(resolve(directory, '.git'))) {
  const tracked = spawnSync('git', [
    'ls-files', '--', 'RUN-PHASE*.ps1', 'test/live-paid-*.mjs',
    ':(glob)**/reports/**', ':(glob)**/wai-*-????????????????????????????????.json',
  ], {
    cwd: directory, encoding: 'utf8', shell: false,
  });
  if (tracked.error) throw tracked.error;
  assert.equal(tracked.status, 0, tracked.stderr);
  assert.equal(tracked.stdout.trim(), '', 'Private payment utilities or saved reports remain in the Git index');
}
console.log(`PASS: npm packs exactly the ${expected.length} reviewed files.`);
