import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DESIGN_API_VERSION } from '../src/application/designContract.js';
export async function designSourceHash(root) {
  const hash = createHash('sha256');
  async function visit(relative) {
    const entries = await readdir(path.join(root, relative), {
      withFileTypes: true,
    });
    for (const item of entries.sort((a, b) =>
      a.name.localeCompare(b.name, 'en'),
    )) {
      const name = path.posix.join(relative, item.name);
      if (item.isDirectory()) await visit(name);
      else if (!/\.test\./.test(item.name)) {
        hash.update(name);
        hash.update(await readFile(path.join(root, name)));
      }
    }
  }
  await visit('src');
  // Changes to the adapter or build entry must invalidate an already running host too.
  for (const name of ['package.json', 'package-lock.json', 'index.html', 'vite.config.mjs', 'mcp/server.mjs', 'mcp/host.mjs', 'mcp/package-lock.json']) {
    hash.update(name);
    hash.update(await readFile(path.join(root, name)));
  }
  return hash.digest('hex');
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  await writeFile(
    path.join(root, 'dist/client/design-build.json'),
    JSON.stringify({
      apiVersion: DESIGN_API_VERSION,
      sourceHash: await designSourceHash(root),
    }),
  );
}
