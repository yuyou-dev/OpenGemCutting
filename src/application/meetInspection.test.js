import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { importFacetingJSON, exportFacetingJSON, createFacetingDocument } from '../domain/faceting.js';
import { inspectMeetpoints } from './meetInspection.js';
import { inspectDesign } from './designOperations.js';

const read = () => JSON.parse(fs.readFileSync(new URL('../../public/presets/documents/94504-pc-01-338-eight-main-highlight.json', import.meta.url)));
const document = raw => importFacetingJSON(JSON.stringify(raw));

test('shared inspection is read-only, advisory and fresh after a parameter change', () => {
  const raw = read(), doc = document(raw), before = exportFacetingJSON(doc);
  assert.equal(inspectMeetpoints(doc).splitMeets, 0);
  const table = raw.facets.find(f => f.plane.normal.z > 1 - 1e-9);
  table.plane.offset -= 0.01; table.depth += 0.01;
  const changed = document(raw), result = inspectMeetpoints(changed);
  assert.equal(result.status, 'measured');
  assert.equal(result.advisory, true);
  assert.equal(result.splitMeets, 8);
  assert.deepEqual(inspectDesign(changed).meetAudit, result);
  assert.equal(exportFacetingJSON(doc), before);
});

test('active curved tools return unsupported without fabricated planar measurements', () => {
  const base = document(read());
  const cut = { id: 'notch', type: 'sphere', radius: 0.1, position: [0.8, 0, 0] };
  const active = inspectMeetpoints(createFacetingDocument({ ...base, concaveCuts: [cut] }));
  assert.equal(active.status, 'unsupported');
  assert.equal(active.reason, 'active-concave-cuts');
  assert.equal(active.nearMisses, undefined);
  assert.equal(inspectMeetpoints(createFacetingDocument({ ...base, concaveCuts: [{ ...cut, enabled: false }] })).status, 'measured');
});

test('a blank with no effective cuts is not reported as clean', () => {
  const doc = createFacetingDocument({ facets: [] });
  assert.equal(inspectMeetpoints(doc).reason, 'no-effective-cuts');
});

test('mesh tessellation does not inflate logical CUT or table corner counts', async () => {
  const { createStockSolid, createMeshDocument } = await import('../domain/stockGeometry.js');
  const base = document(read());
  const cube = createStockSolid(base.stock);
  const mesh = { vertices: cube.vertices, faces: cube.faces.flatMap(f => {
    const [a, ...rest] = f.vertexIndices;
    return rest.slice(0, -1).map((b, i) => ({ vertexIndices: [a, b, rest[i + 1]] }));
  }) };
  const stock = createMeshDocument({ mesh }).stock;
  const result = inspectMeetpoints(createFacetingDocument({ ...base, stock, cuttingReference: base.stock }));
  const expected = inspectMeetpoints(base);
  assert.equal(result.status, 'measured');
  assert.equal(result.facets, expected.facets);
  assert.equal(result.tableCorners, expected.tableCorners);
  assert.equal(result.nearMisses, expected.nearMisses);
  assert.equal(result.splitMeets, expected.splitMeets);
});


test('absent faceted girdle is unmeasured, never zero spread or level', () => {
  const raw = read(); raw.facets = raw.facets.filter(f => Math.abs(f.plane.normal.z) > 1e-6);
  const result = inspectMeetpoints(document(raw));
  assert.equal(result.status, 'measured');
  assert.deepEqual(result.girdleSpread, { crown: null, pavilion: null });
  assert.equal(result.girdleLevel, null);
  assert.ok(result.rawGirdlePieces > 0);
});
