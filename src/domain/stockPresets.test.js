import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STOCK_PRESETS, createPresetStockDocument, presetStockOBJ } from './stockPresets.js';
import { createStockSolid, inspectCrystalOBJ } from './stockGeometry.js';
import { clipPolyhedronByPlanes, polyhedronVolume } from './geometry.js';
import { validateMeshSolid } from './mesh/index.js';

for (const preset of STOCK_PRESETS) test(`${preset.id}: symmetric closed stock, full-height, importable OBJ and real cut`, () => {
  const doc = createPresetStockDocument(preset);
  assert.equal(doc.facets.length, 0);
  const solid = createStockSolid(doc.stock);
  validateMeshSolid(solid);
  const size = ['x', 'y', 'z'].map(axis => Math.max(...solid.vertices.map(p => p[axis])) - Math.min(...solid.vertices.map(p => p[axis])));
  assert.ok(Math.abs(size[2] / Math.max(size[0], size[1]) - 1) < 1e-10);
  for (const [x,y] of preset.profile) {
    assert.ok(preset.profile.some(p => Math.hypot(p[0]+x,p[1]-y)<1e-10));
    if (preset.id === 'rounded-cross') assert.ok(preset.profile.some(p => Math.hypot(p[0]+y,p[1]-x)<1e-10));
    if (preset.id === 'bow-tie') assert.ok(preset.profile.some(p => Math.hypot(p[0]-x,p[1]+y)<1e-10));
  }
  const obj = presetStockOBJ(preset);
  assert.equal(readFileSync(new URL(`../../public/stock-presets/${preset.id}.obj`, import.meta.url), 'utf8'), obj);
  const inspection = inspectCrystalOBJ(obj);
  validateMeshSolid(inspection.solid);
  assert.ok(solid.faces.length < 1000);
  const cut = clipPolyhedronByPlanes(solid, [{ normal: {x:0,y:0,z:1}, offset:0, facetId:'test-cut' }]);
  validateMeshSolid(cut);
  assert.ok(Math.abs(polyhedronVolume(cut) / polyhedronVolume(solid) - 0.5) < 1e-8);
  if (preset.id === 'letter-a') {
    // A horizontal cut must retain the hole: volume equals outer area minus hole area times height.
    const area = ring => Math.abs(ring.reduce((s,p,i) => { const q=ring[(i+1)%ring.length]; return s+p[0]*q[1]-q[0]*p[1]; },0))/2;
    const expected = area(preset.profile) - area(preset.holes[0]);
    assert.ok(Math.abs(polyhedronVolume(solid)-expected*2)<1e-8);
    assert.ok(Math.abs(polyhedronVolume(cut)-expected)<1e-8);
  }
});

test('heart lower outline has no inward bend near its rounded tip', () => {
  const ring = STOCK_PRESETS.find(p => p.id === 'heart').profile;
  const turns = ring.map((p,i) => {
    const a=ring[(i+ring.length-1)%ring.length], b=ring[(i+1)%ring.length];
    return p[1]<-0.1 ? (p[0]-a[0])*(b[1]-p[1])-(p[1]-a[1])*(b[0]-p[0]) : null;
  }).filter(v=>v!==null);
  assert.ok(turns.every(v=>v<0));
});
