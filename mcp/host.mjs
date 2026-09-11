import http from 'node:http';
import { readFile, stat, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { designSourceHash } from '../scripts/design-build-stamp.mjs';
import {
  DESIGN_API_VERSION,
  validateTool,
} from '../src/application/designContract.js';

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
};
export async function startHost({ root, timeoutMs = 20000 } = {}) {
  const clientRoot = path.join(root, 'dist/client');
  await stat(path.join(clientRoot, 'index.html')).catch(() => {
    throw new Error('Build the standalone application first: npm run build');
  });
  const stamp = JSON.parse(
    await readFile(path.join(clientRoot, 'design-build.json'), 'utf8').catch(
      () => {
        throw new Error('Missing design build stamp. Run npm run build.');
      },
    ),
  );
  if (
    stamp.apiVersion !== DESIGN_API_VERSION ||
    stamp.sourceHash !== (await designSourceHash(root))
  )
    throw new Error(
      'The built workbench differs from source. Run npm run build before starting MCP.',
    );
  const artifacts = new Map();
  const artifactDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'facet96-exports-'),
  );
  const token = randomBytes(32).toString('hex');
  const sessions = new Map();
  const pending = new Map();
  let origin;
  const server = http.createServer(async (req, res) => {
    if (
      req.headers.host !== new URL(origin).host ||
      (req.headers.origin && req.headers.origin !== origin)
    ) {
      res.writeHead(403);
      res.end();
      return;
    }
    const url = new URL(req.url, origin);
    if (req.method === 'POST' && url.pathname === '/__design_artifact') {
      if (
        url.searchParams.get('token') !== token ||
        req.headers.origin !== origin ||
        req.headers['content-type'] !== 'application/pdf'
      ) {
        res.writeHead(403);
        res.end();
        return;
      }
      try {
        const chunks = [];
        let bytes = 0;
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 64 * 1024 * 1024) throw new Error('PDF exceeds 64 MiB');
          chunks.push(chunk);
        }
        const id = `${randomUUID()}.pdf`;
        await writeFile(
          path.join(artifactDirectory, id),
          Buffer.concat(chunks),
        );
        artifacts.set(id, bytes);
        if (artifacts.size > 8) {
          const oldest = artifacts.keys().next().value;
          artifacts.delete(oldest);
          await rm(path.join(artifactDirectory, oldest));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            url: `${origin}/__exports/${id}`,
            mimeType: 'application/pdf',
            sizeBytes: bytes,
          }),
        );
      } catch {
        res.writeHead(413);
        res.end('Unable to store PDF');
      }
      return;
    }
    if (
      ['GET', 'HEAD'].includes(req.method) &&
      url.pathname.startsWith('/__exports/')
    ) {
      const id = url.pathname.slice('/__exports/'.length);
      if (!artifacts.has(id)) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="facet-design.pdf"',
        'Cache-Control': 'no-store',
      });
      res.end(
        req.method === 'HEAD'
          ? undefined
          : await readFile(path.join(artifactDirectory, id)),
      );
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405);
      res.end();
      return;
    }
    try {
      const pathname = decodeURIComponent(new URL(req.url, origin).pathname);
      const filename = path.resolve(
        clientRoot,
        `.${pathname === '/' ? '/index.html' : pathname}`,
      );
      if (!filename.startsWith(`${clientRoot}${path.sep}`)) {
        res.writeHead(403);
        res.end();
        return;
      }
      const data = await readFile(filename);
      res.writeHead(200, {
        'Content-Type':
          types[path.extname(filename)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  });
  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: 24 * 1024 * 1024,
  });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, origin);
    if (
      req.headers.host !== new URL(origin).host ||
      req.headers.origin !== origin ||
      url.pathname !== '/__design_bridge' ||
      url.searchParams.get('token') !== token
    ) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    sockets.handleUpgrade(req, socket, head, (ws) =>
      sockets.emit('connection', ws),
    );
  });
  sockets.on('connection', (socket) => {
    const sessionId = randomUUID();
    let ready = false;
    socket.on('message', (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        socket.close(1008, 'Invalid JSON');
        return;
      }
      if (!ready) {
        if (
          message.type !== 'hello' ||
          message.apiVersion !== DESIGN_API_VERSION ||
          message.sourceHash !== stamp.sourceHash
        ) {
          socket.close(1008, 'Incompatible design API; rebuild and reload');
          return;
        }
        ready = true;
        sessions.set(sessionId, {
          socket,
          connectedAt: new Date().toISOString(),
        });
        socket.send(
          JSON.stringify({
            type: 'welcome',
            sessionId,
            apiVersion: DESIGN_API_VERSION,
          }),
        );
        return;
      }
      const request = pending.get(message.id);
      if (!request || request.sessionId !== sessionId) return;
      clearTimeout(request.timer);
      pending.delete(message.id);
      if (message.error)
        request.reject(
          Object.assign(new Error(message.error.message), message.error),
        );
      else request.resolve(message.result);
    });
    socket.on('close', () => {
      sessions.delete(sessionId);
      for (const [id, request] of pending)
        if (request.sessionId === sessionId) {
          clearTimeout(request.timer);
          pending.delete(id);
          request.reject(
            Object.assign(
              new Error(
                'Workbench disconnected. Read the reconnected session before retrying; a write may already have committed.',
              ),
              { code: 'DISCONNECTED' },
            ),
          );
        }
    });
    socket.on('error', () => socket.close());
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    url: `${origin}/#facet-mcp=${token}`,
    async assertCurrentBuild() {
      const current = JSON.parse(await readFile(path.join(clientRoot, 'design-build.json'), 'utf8'));
      if (current.sourceHash !== stamp.sourceHash || current.sourceHash !== await designSourceHash(root))
        throw Object.assign(new Error('工作台版本已更新。请在 Codex 刷新工具或新开本项目任务，再打开工作台；当前设计请先导出留存。'), { code: 'RESTART_REQUIRED' });
    },
    list: () =>
      [...sessions].map(([sessionId, item]) => ({
        sessionId,
        connectedAt: item.connectedAt,
      })),
    async call(name, args, { signal } = {}) {
      validateTool(name, args);
      if (signal?.aborted)
        throw Object.assign(new Error('Request cancelled.'), {
          code: 'REQUEST_CANCELLED',
        });
      const session = sessions.get(args.sessionId);
      if (!session || session.socket.readyState !== WebSocket.OPEN)
        throw Object.assign(
          new Error(
            'No connected workbench for this session. Open workbench_open URL and call workbench_sessions.',
          ),
          { code: 'NO_SESSION' },
        );
      // One outstanding request per page avoids interleaving async project switches with commits.
      if ([...pending.values()].some((p) => p.sessionId === args.sessionId))
        throw Object.assign(
          new Error('This workbench is processing a request.'),
          { code: 'SESSION_BUSY' },
        );
      const cancel = () => session.socket.close(1000, 'MCP request cancelled');
      signal?.addEventListener('abort', cancel, { once: true });
      return new Promise((resolve, reject) => {
        const id = randomUUID();
        const deadline = Date.now() + timeoutMs;
        const timer = setTimeout(() => {
          pending.delete(id);
          session.socket.close(1011, 'Request deadline expired');
          reject(
            Object.assign(
              new Error(
                'Request timed out; reconnect and read state before retrying a write.',
              ),
              { code: 'TIMEOUT' },
            ),
          );
        }, timeoutMs);
        pending.set(id, { sessionId: args.sessionId, timer, resolve, reject });
        session.socket.send(JSON.stringify({ id, name, args, deadline }));
      }).finally(() => signal?.removeEventListener('abort', cancel));
    },
    async close() {
      for (const socket of sockets.clients) socket.terminate();
      await new Promise((resolve) => sockets.close(resolve));
      await new Promise((resolve) => server.close(resolve));
      await rm(artifactDirectory, { recursive: true, force: true });
    },
  };
}
