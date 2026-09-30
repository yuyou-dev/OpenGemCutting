import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { importFacetingJSON } from './faceting.js';
import { buildConstructionStages } from './constructionHistory.js';
import { auditSolid } from './meetAudit.js';

const preset = (id) => JSON.parse(fs.readFileSync(new URL(`../../public/presets/documents/${id}.json`, import.meta.url), 'utf8'));
const audit = (raw) => { const doc = importFacetingJSON(JSON.stringify(raw)); return auditSolid(doc, buildConstructionStages(doc).at(-1).afterSolid); };
const ROUND = '94260-pc-01-247-schenck-round-3';
const EIGHT_MAIN = '94504-pc-01-338-eight-main-highlight'; // every interior corner a 4–5 facet meet

test('a professional meetpoint design has no near misses and a meet at every table corner', () => {
  const r = audit(preset(ROUND));
  assert.equal(r.nearMisses, 0);
  assert.equal(r.tableCorners, 8);
  assert.equal(r.rawGirdlePieces, 0);
  assert.ok(r.exactMeets >= 8);
  assert.equal(r.splitMeets, 0, 'P2:6|P3:6 are two tiers of one column, not a meet that came apart');
});

test('nudging one pavilion main 0.3 % of the width opens its meets and must be reported', () => {
  const raw = preset(ROUND);
  const main = raw.facets.find((f) => f.patternId === 'asc-tier-5'); // P3 41°, part of the culet and ridge meets
  main.plane.offset -= 0.006;
  main.depth += 0.006;
  const r = audit(raw);
  assert.ok(r.nearMisses >= 4, `expected opened meets, got ${r.nearMisses}`);
  assert.ok(r.nearByRegion.pavilion >= 4);
});

test('moving a table whose corners are only three-facet points is not a near miss', () => {
  const raw = preset(ROUND);
  const table = raw.facets.find((f) => f.plane.normal.z > 1 - 1e-9);
  table.plane.offset -= 0.006;
  table.depth += 0.006;
  assert.equal(audit(raw).nearMisses, 0);
});

test('a table cut 0.5 % W too deep splits every four-facet table corner: no near miss, but split meets', () => {
  const raw = preset(EIGHT_MAIN);
  const before = audit(raw);
  assert.equal(before.splitMeets, 0);
  assert.equal(before.multiMeetShare, 1);
  const table = raw.facets.find((f) => f.plane.normal.z > 1 - 1e-9);
  table.plane.offset -= 0.01;
  table.depth += 0.01;
  const r = audit(raw);
  assert.equal(r.nearMisses, 0, 'the corners are 3 % W apart, beyond the near-miss band');
  assert.equal(r.splitMeets, 8);
  assert.ok(r.multiMeetShare < 0.6);
});

test('thin girdle endpoints are thickness, independent of labels and clustering threshold', () => {
  const raw = preset(ROUND);
  const doc = importFacetingJSON(JSON.stringify(raw));
  const solid = buildConstructionStages(doc).at(-1).afterSolid;
  const girdles = new Set(doc.facets.filter(f => Math.abs(f.plane.normal.z) < 1e-6).map(f => f.id));
  const z = solid.faces.filter(f => girdles.has(f.facetId ?? f.id)).flatMap(f => f.vertexIndices.map(i => solid.vertices[i].z));
  const W = Math.max(...solid.vertices.map(v => v.x)) - Math.min(...solid.vertices.map(v => v.x));
  for (const thickness of [0.005, 0.0005]) {
    const thin = structuredClone(raw);
    const shift = Math.min(...z) + thickness * W - Math.max(...z);
    for (const f of thin.facets) {
      f.label = 'renamed';
      if (f.plane.normal.z > 1e-6) { f.plane.offset += f.plane.normal.z * shift; f.depth -= f.plane.normal.z * shift; }
    }
    const r = audit(thin);
    assert.equal(r.nearByRegion.girdle, 0);
    assert.equal(r.girdleLevel, true);
    assert.equal(r.tableCorners, 8);
  }
});

test('covered historical table does not hide the effective table corners', () => {
  const raw = preset(ROUND);
  const table = raw.facets.find(f => f.plane.normal.z > 1 - 1e-9);
  raw.facets.unshift({ ...structuredClone(table), id: 'covered-table', patternId: 'covered-table',
    plane: { ...table.plane, offset: table.plane.offset + 0.1 }, depth: table.depth - 0.1 });
  assert.equal(audit(raw).tableCorners, 8);
});
