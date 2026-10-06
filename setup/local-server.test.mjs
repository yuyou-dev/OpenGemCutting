import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { localServerMode } from './local-server.mjs';

test('local launcher refuses host and fixed-port overrides', () => {
  assert.equal(localServerMode([]), 'dev');
  assert.equal(localServerMode(['preview']), 'preview');
  for (const args of [['--host'], ['--host=example.invalid'], ['--host', '::'], ['--port', '5173'], ['preview', '--host', '203.0.113.2']])
    assert.throws(() => localServerMode(args), /without network overrides/);
});

function launch() {
  const child = spawn(process.execPath, ['--input-type=module', '-e',
    "import { runLocalServer } from './setup/local-server.mjs'; const server = await runLocalServer([]); process.send(server.httpServer.address());"],
    { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const ready = new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`Local server did not start: ${output}`)), 30000);
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.once('message', address => { clearTimeout(timer); resolve(address); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Local server exited ${code}: ${output}`)); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
  });
  return { child, ready };
}

test('simultaneous dev servers use distinct high ports and bind only to loopback', { timeout: 45000 }, async () => {
  const servers = [launch(), launch()];
  try {
    const addresses = await Promise.all(servers.map(server => server.ready));
    assert.notEqual(addresses[0].port, addresses[1].port);
    for (const address of addresses) {
      // Inspect the actual listening socket, not a TCP handshake that a VPN/TUN
      // proxy may accept even when no service is listening at that destination.
      assert.equal(address.address, '127.0.0.1');
      assert.equal(address.family, 'IPv4');
      assert.ok(address.port > 1023);
      const response = await fetch(`http://${address.address}:${address.port}/`);
      assert.equal(response.status, 200);
      assert.match(await response.text(), /SUVA/);
    }
  } finally {
    await Promise.all(servers.map(async ({ child }) => {
      if (child.exitCode !== null || child.signalCode) return;
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }));
  }
});
