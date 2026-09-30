import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createFacetingDocument, importFacetingJSON, exportFacetingJSON } from '../../../../src/domain/faceting.js';

const cli = fileURLToPath(new URL('./meet-audit.mjs', import.meta.url));
test('CLI reports candidates without failing and distinguishes unsupported documents', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'facet-meet-cli-'));
  try {
    const raw = JSON.parse(await fs.readFile(new URL('../../../../public/presets/documents/94504-pc-01-338-eight-main-highlight.json', import.meta.url), 'utf8'));
    const table = raw.facets.find(f => f.plane.normal.z > 1 - 1e-9);
    table.plane.offset -= 0.01; table.depth += 0.01;
    const doc = importFacetingJSON(JSON.stringify(raw));
    const file = path.join(dir, 'design.json');
    await fs.writeFile(file, exportFacetingJSON(doc));
    const candidates = spawnSync(process.execPath, [cli, file, '--brilliant', '--json'], { encoding: 'utf8' });
    assert.equal(candidates.status, 0, candidates.stderr);
    assert.equal(JSON.parse(candidates.stdout).splitMeets, 8);
    await fs.writeFile(file, exportFacetingJSON(createFacetingDocument({ ...doc, concaveCuts: [{ id: 'notch', type: 'sphere' }] })));
    const unsupported = spawnSync(process.execPath, [cli, file, '--json'], { encoding: 'utf8' });
    assert.equal(unsupported.status, 2, unsupported.stderr);
    assert.equal(JSON.parse(unsupported.stdout).reason, 'active-concave-cuts');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
