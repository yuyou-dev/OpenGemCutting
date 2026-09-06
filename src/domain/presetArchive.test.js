import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readPresetArchive, sha256, validatePresetProvenance } from '../../scripts/lib/presetArchive.mjs';

test('portable archive resolves canonical files, verifies hashes and requires an indexed Open declaration', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'facet-preset-'));
  const bytes = Buffer.from('GemCad 5.0\n');
  const row = {post_id: 7, title: 'Example', url: 'https://facetdiagrams.org/diagram/example/', attachment_url: 'https://facetdiagrams.org/a.asc',
    canonical_relpath: 'files/Round/example.asc', local_relpath: 'files/alias.asc', sha256: sha256(bytes), spans: ['Named author', 'Original collection'], shape: 'Round'};
  try {
    await writeFile(path.join(root, 'manifest.json'), JSON.stringify([row]));
    await writeFile(path.join(root, 'open_index.json'), JSON.stringify([{post_id: 7, url: row.url}]));
    await writeFile(path.join(root, 'README.txt'), 'Only attachments on Open-design detail pages were included.');
    const [normalized] = await readPresetArchive(root);
    assert.equal(normalized.file, path.join(root, row.canonical_relpath));
    assert.equal(normalized.designer, 'Named author');
    assert.deepEqual(validatePresetProvenance(normalized, bytes), []);
    assert.deepEqual(validatePresetProvenance(normalized, Buffer.from('tampered')), ['HASH_MISMATCH']);
    await writeFile(path.join(root, 'open_index.json'), '[]');
    const [unindexed] = await readPresetArchive(root);
    assert.deepEqual(validatePresetProvenance(unindexed, bytes), ['MISSING_PROVENANCE']);
    await writeFile(path.join(root, 'manifest.json'), JSON.stringify([{...row, canonical_relpath: '../outside.asc'}]));
    await assert.rejects(readPresetArchive(root), /路径越界/);
  } finally { await rm(root, {recursive: true, force: true}); }
});
