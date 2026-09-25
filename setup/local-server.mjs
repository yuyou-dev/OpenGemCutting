import net from 'node:net';
import { fileURLToPath } from 'node:url';

export const LOCAL_HOST = '127.0.0.1';

export function localServerMode(args) {
  if (!args.length) return 'dev';
  if (args.length === 1 && args[0] === 'preview') return 'preview';
  throw new Error('Use npm run dev or npm run preview without network overrides. Local servers always use 127.0.0.1 and an OS-assigned ephemeral port.');
}

function ephemeralPort() {
  return new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.once('error', reject);
    socket.listen({ host: LOCAL_HOST, port: 0 }, () => {
      const { port } = socket.address();
      socket.close(error => error ? reject(error) : resolve(port));
    });
  });
}

export async function runLocalServer(args) {
  const mode = localServerMode(args);
  // Vite 6 dev treats port 0 as its default port. Reserve an OS-selected port
  // first; strictPort fails safely if another process takes it before launch.
  const port = await ephemeralPort();
  const root = fileURLToPath(new URL('../', import.meta.url));
  const { createServer, preview } = await import('vite');
  const network = { host: LOCAL_HOST, port, strictPort: true };
  const server = mode === 'preview'
    ? await preview({ root, preview: network })
    : await createServer({ root, server: network });
  if (mode === 'dev') await server.listen();
  server.printUrls();
}
