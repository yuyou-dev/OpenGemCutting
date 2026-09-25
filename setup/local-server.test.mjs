import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { networkInterfaces } from 'node:os';
import net from 'node:net';
import { localServerMode } from './local-server.mjs';

test('local launcher refuses host and fixed-port overrides', () => {
  assert.equal(localServerMode([]), 'dev');
  assert.equal(localServerMode(['preview']), 'preview');
  for (const args of [['--host'], ['--host=example.invalid'], ['--host', '::'], ['--port', '5173'], ['preview', '--host', '203.0.113.2']])
    assert.throws(() => localServerMode(args), /without network overrides/);
});

function launch() {
  const child = spawn(process.execPath, ['scripts/run-vite-local.mjs'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const ready = new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`Local server did not start: ${output}`)), 30000);
    const read = chunk => {
      output += chunk.toString().replace(/\x1b\[[0-9;]*m/g, '');
      const url = output.match(/http:\/\/127\.0\.0\.1:(\d+)\//)?.[0];
      if (url) { clearTimeout(timer); resolve(url); }
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Local server exited ${code}: ${output}`)); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
  });
  return { child, ready };
}

test('simultaneous dev servers use distinct high ports and reject LAN connections', { timeout: 45000 }, async () => {
  const servers = [launch(), launch()];
  try {
    const urls = await Promise.all(servers.map(server => server.ready));
    assert.notEqual(urls[0], urls[1]);
    for (const url of urls) {
      const port = Number(new URL(url).port);
      assert.ok(port > 1023);
      const response = await fetch(url);
      assert.equal(response.status, 200);
      assert.match(await response.text(), /SUVA/);
      for (const address of Object.values(networkInterfaces()).flat().filter(item => item.family === 'IPv4' && !item.internal)) {
        await new Promise((resolve, reject) => {
          const socket = net.connect({ host: address.address, port });
          socket.once('connect', () => { socket.destroy(); reject(new Error(`LAN exposure at ${address.address}:${port}`)); });
          socket.once('error', resolve);
          socket.setTimeout(1000, () => { socket.destroy(); resolve(); });
        });
      }
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
