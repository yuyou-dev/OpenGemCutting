import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const readJSON = async file => JSON.parse(await readFile(file, 'utf8'));
export const safeModulePath = file => typeof file === 'string' && !file.includes('\\') && !file.startsWith('/') && file.split('/').every(p => p && p !== '.' && p !== '..');
export async function walkFiles(root, prefix = '') {
  const files = [];
  for (const item of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    const file = path.posix.join(prefix, item.name);
    if (item.isDirectory()) files.push(...await walkFiles(root, file));
    else { assert.ok(item.isFile(), `Unsupported entry: ${file}`); files.push(file); }
  }
  return files.sort();
}

/** Verify data before importing any candidate code. No writes or external paths. */
export async function verifyModule(root, expected = {}) {
  const manifest = await readJSON(path.join(root, 'MANIFEST.json'));
  assert.equal(manifest.packageName, '@facet96/pattern-lab');
  assert.equal(manifest.contractVersion, '1.0.0');
  assert.ok([1, 2].includes(manifest.entryApiVersion), "Unsupported module API");
  assert.match(manifest.moduleVersion, /^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?$/);
  assert.equal(manifest.publicContractArchiveSha256, 'b1c99bb91600bfc47d9f8fc8eda2f4fdf89372df98e40ee823e41399a2ac3f8c');
  if (expected.moduleVersion) assert.equal(manifest.moduleVersion, expected.moduleVersion);
  if (expected.manifestSha256) assert.equal(sha256(await readFile(path.join(root, 'MANIFEST.json'))), expected.manifestSha256);
  const checksums = {};
  for (const line of (await readFile(path.join(root, 'SHA256SUMS'), 'utf8')).trim().split('\n')) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    assert.ok(match && safeModulePath(match[2]), 'Unsafe checksum path');
    assert.ok(!checksums[match[2]], 'Duplicate checksum path');
    checksums[match[2]] = match[1];
  }
  assert.deepEqual(await walkFiles(root), [...Object.keys(checksums), 'SHA256SUMS'].sort());
  for (const [file, hash] of Object.entries(checksums)) assert.equal(sha256(await readFile(path.join(root, file))), hash, file);
  for (const [file, hash] of Object.entries(manifest.fileHashes)) assert.equal(checksums[file], hash, file);
  for (const [file, hash] of Object.entries(manifest.runtimeFiles)) assert.equal(checksums[file], hash, file);
  assert.equal(sha256(JSON.stringify(manifest.runtimeFiles)), manifest.runtimeContentSha256);
  for (const dependency of manifest.bundledDependencies) assert.ok(dependency.license, 'Missing bundled license');
  return manifest;
}

export function runtimeFiles(manifest) {
  // The complete source/license snapshot stays in vendor for redistribution and
  // rebuilds. Only runtime assets and notices are deployed, never QA host pages.
  return [...Object.keys(manifest.runtimeFiles), 'THIRD_PARTY_NOTICES.md',
    ...Object.keys(manifest.fileHashes).filter(p => p.startsWith('licenses/'))];
}
