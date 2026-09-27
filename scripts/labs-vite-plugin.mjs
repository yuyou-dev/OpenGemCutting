import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { readJSON, verifyModule, runtimeFiles } from './labs-module-files.mjs';

export function labsModulePlugin() {
  let root, base, lock, files;
  const load = async () => {
    const next = new Map();
    for (const lockFile of ['labsModuleLock.json', 'presetModuleLock.json']) {
      lock = await readJSON(path.join(root, 'src/application', lockFile));
      if (!lock.enabled) continue;
      const directory = path.join(root, lock.directory), manifest = await verifyModule(directory, lock);
      for (const file of runtimeFiles(manifest)) next.set(lock.publicPath + file, await readFile(path.join(directory, file)));
    }
    files = next;
  };
  return { name: 'fixed-laboratory-module',
    configResolved(config) { root = config.root; base = config.base; },
    async configureServer(server) {
      await load();
      const locks = ['labsModuleLock.json', 'presetModuleLock.json'].map(f => path.join(root, 'src/application', f));
      server.watcher.add(locks);
      server.watcher.on('change', async file => {
        if (!locks.includes(file)) return;
        try { await load(); server.ws.send({type:'full-reload'}); }
        catch (error) { server.config.logger.error(error.message); }
      });
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
