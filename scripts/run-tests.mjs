import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

// Pass explicit files to Node: directory/glob discovery differs between supported runtimes and shells.
const files = [];
async function collect(input) {
  if ((await stat(input)).isDirectory()) {
    for (const entry of await readdir(input, { withFileTypes: true })) {
      if (['node_modules', '.git'].includes(entry.name)) continue;
      await collect(path.join(input, entry.name));
    }
  } else if (/\.test\.[cm]?js$/.test(input)) files.push(path.resolve(input));
}
for (const input of process.argv.slice(2)) await collect(input);
if (!files.length) throw new Error('No test files found in the supplied paths.');
const child = spawn(process.execPath, ['--test', ...files.sort()], { stdio: 'inherit' });
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
