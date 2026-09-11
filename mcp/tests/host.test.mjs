import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { designSourceHash } from '../../scripts/design-build-stamp.mjs';
import { once } from 'node:events';
import WebSocket from 'ws';
import { startHost } from '../host.mjs';
import { DESIGN_API_VERSION } from '../../src/application/designContract.js';
const root = fileURLToPath(new URL('../../', import.meta.url));
test('a running host detects an upgraded build before offering its link', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gem-build-'));
  let host;
  try {
    await mkdir(path.join(directory, 'src'));
    await mkdir(path.join(directory, 'dist/client'), { recursive: true });
    await writeFile(path.join(directory, 'src/app.js'), 'old');
    await writeFile(path.join(directory, 'package.json'), '{}');
    await writeFile(path.join(directory, 'dist/client/index.html'), '<html></html>');
    const stampFile = path.join(directory, 'dist/client/design-build.json');
    await writeFile(stampFile, JSON.stringify({ apiVersion: DESIGN_API_VERSION, sourceHash: await designSourceHash(directory) }));
    host = await startHost({ root: directory });
    await host.assertCurrentBuild();
    await writeFile(path.join(directory, 'src/app.js'), 'new');
    await writeFile(stampFile, JSON.stringify({ apiVersion: DESIGN_API_VERSION, sourceHash: await designSourceHash(directory) }));
    await assert.rejects(host.assertCurrentBuild(), { code: 'RESTART_REQUIRED' });
  } finally { await host?.close(); await rm(directory, { recursive: true, force: true }); }
});
async function page(host) {
  const token = new URLSearchParams(new URL(host.url).hash.slice(1)).get(
    'facet-mcp',
  );
  const ws = new WebSocket(
    `${host.origin.replace('http', 'ws')}/__design_bridge?token=${token}`,
    { origin: host.origin },
  );
  await once(ws, 'open');
  const stamp = JSON.parse(
    await readFile(
      new URL('../../dist/client/design-build.json', import.meta.url),
      'utf8',
    ),
  );
  ws.send(
    JSON.stringify({
      type: 'hello',
      apiVersion: DESIGN_API_VERSION,
      sourceHash: stamp.sourceHash,
    }),
  );
  const [raw] = await once(ws, 'message');
  return { ws, sessionId: JSON.parse(raw).sessionId };
}
test('host binds loopback, isolates page sessions and rejects unknown sessions', async () => {
  const host = await startHost({ root });
  try {
    assert.match(host.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal((await fetch(host.origin)).status, 200);
    assert.equal(
      (await fetch(`${host.origin}/../../package.json`)).status,
      404,
    );
    assert.equal(
      (
        await fetch(host.origin, {
          headers: { Origin: 'https://untrusted.example' },
        })
      ).status,
      403,
    );
    const a = await page(host),
      b = await page(host);
    assert.notEqual(a.sessionId, b.sessionId);
    const request = host.call('design_read', { sessionId: a.sessionId });
    const [raw] = await once(a.ws, 'message');
    const message = JSON.parse(raw);
    b.ws.send(JSON.stringify({ id: message.id, result: { forged: true } }));
    a.ws.send(
      JSON.stringify({ id: message.id, result: { name: 'correct page' } }),
    );
    assert.deepEqual(await request, { name: 'correct page' });
    await assert.rejects(host.call('design_read', { sessionId: 'missing' }), {
      code: 'NO_SESSION',
    });
    a.ws.close();
    b.ws.close();
  } finally {
    await host.close();
  }
});
test('disconnect makes in-flight outcomes explicit; requests are not replayed', async () => {
  const host = await startHost({ root });
  try {
    const { ws, sessionId } = await page(host);
    const request = host.call('design_read', { sessionId });
    const failed = assert.rejects(request, { code: 'DISCONNECTED' });
    await once(ws, 'message');
    ws.close();
    await failed;
    assert.equal(host.list().length, 0);
  } finally {
    await host.close();
  }
});

test('MCP cancellation closes the pending page request without replay', async () => {
  const host = await startHost({ root });
  try {
    const { ws, sessionId } = await page(host);
    const controller = new AbortController();
    const request = host.call(
      'design_read',
      { sessionId },
      { signal: controller.signal },
    );
    const failure = assert.rejects(request, { code: 'DISCONNECTED' });
    await once(ws, 'message');
    controller.abort();
    await failure;
    assert.equal(host.list().length, 0);
    await assert.rejects(
      host.call('design_read', { sessionId }, { signal: controller.signal }),
      { code: 'REQUEST_CANCELLED' },
    );
  } finally {
    await host.close();
  }
});
