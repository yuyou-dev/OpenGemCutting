import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('the test entry runs nested files in paths with spaces and propagates failures', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'gem tests '));
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  const run = () => spawnSync(process.execPath, ['scripts/run-tests.mjs', root], { encoding: 'utf8', env });
  try {
    assert.notEqual(run().status, 0, 'empty discovery must not pass');
    await mkdir(path.join(root, 'nested'));
    const file = path.join(root, 'nested', 'probe.test.mjs');
    await writeFile(file, "import test from 'node:test'; test('nested probe', () => {});");
    const passed = run();
    assert.equal(passed.status, 0, passed.stderr);
    assert.match(passed.stdout, /nested probe/);
    await writeFile(file, "import test from 'node:test'; test('nested probe', () => { throw Error('intentional failure'); });");
    assert.notEqual(run().status, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
