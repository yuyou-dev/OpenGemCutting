import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { readJSON, verifyModule, runtimeFiles } from './labs-module-files.mjs';

export function labsModulePlugin() {
  let root, base, lock, files;
  const load = async () => {
    lock = await readJSON(path.join(root, 'src/application/labsModuleLock.json'));
    files = null;
    if (!lock.enabled) return;
    const directory = path.join(root, lock.directory), manifest = await verifyModule(directory, lock);
    files = new Map(await Promise.all(runtimeFiles(manifest).map(async file => [lock.publicPath + file, await readFile(path.join(directory, file))])));
  };
  return { name: 'fixed-laboratory-module',
    configResolved(config) { root = config.root; base = config.base; },
    async configureServer(server) {
      await load();
      server.middlewares.use((req, res, next) => {
        const pathname = decodeURI((req.url ?? '').split('?')[0]);
        const file = pathname.startsWith(base) ? pathname.slice(base.length) : pathname.replace(/^\//, '');
        if (!files?.has(file)) return next();
        const type = { '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.webp': 'image/webp' }[path.extname(file)] ?? 'text/plain';
        res.setHeader('Content-Type', type); res.end(files.get(file));
      });
    },
    async buildStart() { await load(); },
    generateBundle() { for (const [fileName, source] of files ?? []) this.emitFile({ type: 'asset', fileName, source }); },
  };
}
