import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compatibleNode, supportsSetup, verifyRegistration, configureCodex, guardUpgrade, run } from './lifecycle.mjs';

test('missing or old Codex without marketplace support requires the local CLI', () => {
  assert.equal(supportsSetup(null), false);
  const cli = { command: 'codex', prefix: [] };
  assert.equal(supportsSetup(cli, (_, args) => ({ status: args[0] === 'plugin' ? 2 : 0 })), false);
  assert.equal(supportsSetup(cli, () => ({ status: 0 })), true);
});

test('Node support follows app engines including 21 exclusion', () => {
  for (const v of ['20.19.0', '22.12.0', '24.0.0']) assert.ok(compatibleNode(v));
  for (const v of ['18.20.0', '20.18.0', '21.7.0', '22.11.0']) assert.equal(compatibleNode(v), false);
});
test('never replace another workspace using the same MCP name', () => {
  assert.throws(() => verifyRegistration({ transport: { type: 'stdio', args: ['/other/server.mjs'] } }, { entry: path.resolve('mcp/server.mjs'), name: 'design' }), /another installation/);
});
test('repeat setup reuses registration and market while refreshing plugin', () => {
  const root = path.resolve('fixture workspace');
  const product = { service: 'design', marketplace: 'gems', plugin: 'gem-design' };
  const registered = { name: 'design', enabled: true, transport: { type: 'stdio', command: process.execPath, args: [path.join(root, 'mcp/server.mjs')] } };
  const calls = [];
  const invoke = (_, args) => {
    calls.push(args);
    if (args[0] === 'mcp' && args[1] === 'list') return { stdout: JSON.stringify([registered]), status: 0 };
    if (args[0] === 'mcp' && args[1] === 'get') return { stdout: JSON.stringify(registered), status: 0 };
    if (args[1] === 'marketplace') return { stdout: JSON.stringify({ marketplaces: [{ name: 'gems', root }] }), status: 0 };
    return { stdout: '{}', status: 0 };
  };
  assert.equal(configureCodex(root, { command: 'codex', prefix: [] }, product, invoke).browserConnection, 'not-yet-verified');
  assert.equal(calls.filter(args => args[0] === 'mcp' && args[1] === 'add').length, 0);
  assert.ok(calls.some(args => args[0] === 'plugin' && args[1] === 'add'));
});
test('marketplace conflict prevents registration mutation', () => {
  const calls = [];
  const invoke = (_, args) => { calls.push(args); return { status: 0, stdout: JSON.stringify(args[0] === 'mcp' ? [] : { marketplaces: [{ name: 'gems', root: path.resolve('other') }] }) }; };
  assert.throws(() => configureCodex(path.resolve('wanted'), { command: 'codex', prefix: [] }, { service: 'd', marketplace: 'gems' }, invoke), /another installation/);
  assert.ok(!calls.some(args => args.includes('add')));
});
test('real dirty Git checkout is left untouched by upgrade guard', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'gem-upgrade-'));
  try {
    run('git', ['init', '-q', dir]);
    writeFileSync(path.join(dir, 'my-design.json'), '{"personal":true}');
    assert.throws(() => guardUpgrade(dir), /Local changes/);
    assert.match(run('git', ['status', '--porcelain'], { cwd: dir, capture: true }).stdout, /my-design.json/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('subprocess arguments keep spaces and shell punctuation literal', () => {
  const input = 'design folder & draft $(keep)';
  const result = run(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', input], { capture: true });
  assert.equal(result.stdout, input);
});
