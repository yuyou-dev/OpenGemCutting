import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeConcaveCuts, expandConcaveCuts } from './concaveCuts.js';
import { createMachiningStock, evaluateDocument } from './documentGeometry.js';
import { createStockSolid } from './stockGeometry.js';
import { normalizeMeshStock } from './meshStock.js';
import { clipPolyhedronByPlanes, polyhedronVolume } from './geometry.js';
import { validateMeshSolid } from './mesh/index.js';
import { hollowRough, starRough } from './mesh/fixtures.js';
import { normalizedOpticsMesh } from './opticsGeometry.js';
import { raycastMesh } from './meshRaycast.js';

const stock = Object.freeze({ kind: 'cube', size: 2, center: Object.freeze([0, 0, 0]) });
const document = (cuts = [], facets = []) => ({ stock, facets, concaveCuts: normalizeConcaveCuts(cuts) });
const cut = (options = {}) => ({ id: 'concave-1', ...options });
const close = (actual, expected, epsilon = 1e-8) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} ≠ ${expected}`);

test('concave parameters are immutable, validated and independent of 96 teeth', () => {
  const input = [cut({ repeat: 5, axis: [0, 0, 5], phaseDeg: -18 })];
  const normalized = normalizeConcaveCuts(input);
  assert.equal(normalized[0].repeat, 5);
  assert.deepEqual(normalized[0].axis, [0, 0, 1]);
  assert.equal(normalized[0].phaseDeg, 342);
  input[0].axis[2] = 9;
  assert.deepEqual(normalized[0].axis, [0, 0, 1]);
  assert.throws(() => normalized[0].position.push(2), TypeError);
  assert.equal(normalizeConcaveCuts(normalized), normalized);
  for (const invalid of [{ radius: 0 }, { length: -1 }, { axis: [0, 0, 0] }, { repeat: 1.5 }, { segments: 22 }, { position: [0, NaN, 0] }, { enabled: 'yes' }, { type: 'unknown' }]) {
    assert.throws(() => normalizeConcaveCuts([cut(invalid)]));
  }
  assert.throws(() => normalizeConcaveCuts([cut(), cut()]));
  assert.throws(() => normalizeConcaveCuts([cut({ repeat: 120, segments: 64 })]), /budget/);
  const extremeAxis = normalizeConcaveCuts([cut({ axis: [Number.MAX_VALUE, Number.MAX_VALUE, 0] })])[0].axis;
  close(Math.hypot(...extremeAxis), 1);
});

test('fivefold tool placements rotate about stock center with exact 72 degree increments', () => {
  const tools = expandConcaveCuts([cut({ type: 'cylinder', repeat: 5, phaseDeg: 18, position: [3, 2, 1], axis: [1, 0, 0] })], [2, 2, 0]);
  assert.equal(tools.length, 5);
  for (const [i, tool] of tools.entries()) {
    const angle = (18 + 72 * i) * Math.PI / 180;
    close(tool.position[0], 2 + Math.cos(angle)); close(tool.position[1], 2 + Math.sin(angle));
    close(tool.axis[0], Math.cos(angle)); close(tool.axis[1], Math.sin(angle));
    assert.equal(tool.position[2], 1);
  }
});

test('empty and disabled concave groups preserve the legacy planar evaluation', () => {
  const facets = [{ id: 'cut-top', patternId: 'top', region: 'crown', plane: { normal: { x: 0, y: 0, z: 1 }, offset: 0.6 } }];
  const expected = clipPolyhedronByPlanes(createStockSolid(stock), [{ ...facets[0].plane, operationId: 'top', faceId: 'cut-top', region: 'crown', operationType: undefined }]);
  for (const cuts of [[], [cut({ enabled: false })]]) {
    const doc = document(cuts, facets);
    assert.deepEqual(createMachiningStock(doc), createStockSolid(stock));
    assert.deepEqual(evaluateDocument(doc), expected);
  }
});

test('sphere makes a true watertight notch, preserves source provenance, and is cached across planar edits', () => {
  const doc = document([cut({ position: [1, 0, 0], radius: 0.5 })]);
  const before = JSON.stringify(doc);
  const solid = createMachiningStock(doc);
  const validation = validateMeshSolid(solid);
  assert.equal(validation.shells, 1); assert.equal(validation.euler, 2);
  // Half-sphere removal converges from its inscribed tessellation.
  close(polyhedronVolume(solid), 8 - 2 * Math.PI * 0.5 ** 3 / 3, 0.012);
  assert.ok(solid.faces.some(face => face.sourceOperationId === 'rough-cube'));
  assert.ok(solid.faces.some(face => face.sourceOperationId === 'concave-1' && face.region === 'concave' && face.surfaceType === 'sphere'));
  assert.ok(solid.faces.every(face => !face.facetId));
  assert.equal(createMachiningStock({ ...doc, facets: [{}] }), solid);
  assert.equal(JSON.stringify(doc), before);
  const hit = raycastMesh(solid, [2, 0, 0], [-1, 0, 0]);
  close(hit.point[0], 0.5, 0.01);
  assert.ok(normalizedOpticsMesh(solid).triangles.length > 0);
});

test('enclosed sphere cavity has inward boundary and correct shell material volume', () => {
  const solid = createMachiningStock(document([cut({ position: [0, 0, 0], radius: 0.4 })]));
  assert.equal(validateMeshSolid(solid).shells, 2);
  close(polyhedronVolume(solid), 8 - 4 * Math.PI * 0.4 ** 3 / 3, 0.01);
  const cavity = solid.faces.find(face => face.region === 'concave');
  const vertex = solid.vertices[cavity.vertexIndices[0]];
  assert.ok(cavity.normal.x * vertex.x + cavity.normal.y * vertex.y + cavity.normal.z * vertex.z < 0);
});

test('oriented cylindrical tool cuts a through channel and the planar cap remains watertight', () => {
  const doc = document([cut({ type: 'cylinder', position: [0, 0, 0], axis: [1, 1, 0], radius: 0.2, length: 4 })], [
    { id: 'table', patternId: 'table', region: 'crown', plane: { normal: { x: 0, y: 0, z: 1 }, offset: 0.05 } },
  ]);
  const solid = evaluateDocument(doc);
  assert.equal(validateMeshSolid(solid).shells, 1);
  assert.ok(polyhedronVolume(solid) < 4.2);
  assert.ok(solid.faces.some(face => face.facetId === 'table' && face.sourceOperationId === 'table'));
  assert.ok(solid.faces.some(face => face.region === 'concave'));
});

test('fivefold overlapping cutters produce an actual closed solid on existing nonconvex stock', () => {
  const rough = starRough(36);
  const meshStock = normalizeMeshStock({ kind: 'mesh', size: 2, center: [0, 0, 0], mesh: rough });
  const doc = { ...document([cut({ radius: 0.34, position: [0.65, 0, 0.7], repeat: 5, phaseDeg: 18, segments: 12 })]), stock: meshStock };
  const solid = createMachiningStock(doc);
  assert.equal(validateMeshSolid(solid).shells, 1);
  assert.ok(polyhedronVolume(solid) < polyhedronVolume(createStockSolid(meshStock)));
  const instances = new Set(solid.faces.filter(face => face.region === 'concave').map(face => face.toolInstanceId));
  assert.equal(instances.size, 5);
});

test('grazing or distant tools preserve the original solid, while removing all material fails explicitly', () => {
  for (const position of [[4, 0, 0], [1.5, 0, 0]]) {
    assert.deepEqual(createMachiningStock(document([cut({ position, radius: 0.5 })])), createStockSolid(stock));
  }
  assert.throws(() => createMachiningStock(document([cut({ position: [0, 0, 0], radius: 4 })])), { code: 'empty-concave-result' });
  const meshStock = normalizeMeshStock({ kind: 'mesh', size: 3, center: [1.5, 1.5, 1.5], mesh: hollowRough(true) });
  const cavityTool = { ...document([cut({ position: [1.5, 1.5, 1.5], radius: 0.2 })]), stock: meshStock };
  assert.equal(createMachiningStock(cavityTool), createStockSolid(meshStock));
});

test('overlapping fivefold tool volumes are subtracted once and keep a closed boundary', () => {
  const spec = cut({ radius: 0.6, position: [0.85, 0, 0.2], repeat: 5, segments: 12 });
  const together = createMachiningStock(document([spec]));
  assert.equal(validateMeshSolid(together).shells, 1);
  const independentRemoval = expandConcaveCuts([spec]).reduce((sum, tool) => sum + 8 - polyhedronVolume(createMachiningStock(document([
    { ...spec, repeat: 1, position: tool.position, phaseDeg: spec.phaseDeg ?? 0 },
  ]))), 0);
  assert.ok(8 - polyhedronVolume(together) < independentRemoval);
});

test('tool edits and planar edits commute in final fixed-coordinate geometry', () => {
  const facets = [{ id: 'table', patternId: 'table', region: 'crown', plane: { normal: { x: 0, y: 0, z: 1 }, offset: 0.45 } }];
  const base = document();
  const tools = normalizeConcaveCuts([cut({ radius: 0.4, position: [0.9, 0, 0.3], segments: 12 })]);
  const toolsThenPlanes = { ...base, concaveCuts: tools, facets };
  const planesThenTools = { ...base, facets, concaveCuts: tools };
  assert.deepEqual(evaluateDocument(toolsThenPlanes), evaluateDocument(planesThenTools));
  assert.equal(evaluateDocument(toolsThenPlanes), evaluateDocument(toolsThenPlanes));
  const withoutTools = evaluateDocument(toolsThenPlanes, { concaveCuts: [] });
  assert.deepEqual(withoutTools, evaluateDocument({ ...base, facets }));
  assert.ok(polyhedronVolume(evaluateDocument(toolsThenPlanes)) < polyhedronVolume(withoutTools));
  const withoutPlanes = evaluateDocument(toolsThenPlanes, { facets: [] });
  assert.ok(polyhedronVolume(withoutPlanes) > polyhedronVolume(evaluateDocument(toolsThenPlanes)));
});

test('small grooves remain real geometry and sub-resolution tools fail without losing data', () => {
  for (const radius of [0.001, 0.00001]) {
    const doc = document([cut({ radius, position: [1, 0, 0], segments: 12 })]);
    const solid = createMachiningStock(doc);
    assert.equal(solid.kind, 'mesh');
    assert.ok(solid.faces.some(face => face.region === 'concave'));
    close(raycastMesh(solid, [2, 0, 0], [-1, 0, 0]).point[0], 1 - radius, radius * 0.1);
  }
  assert.throws(() => createMachiningStock(document([cut({ radius: 1e-8, position: [1, 0, 0] })])), { code: 'concave-resolution' });
});

test('90 degree V wheel removes a sharp V notch with a watertight boundary and rotates freely', () => {
  const tool = cut({ type: 'v-wheel', radius: .7, length: 1.4, position: [1.2, 0, 0], axis: [0, 1, 0], segments: 32 });
  const solid = createMachiningStock(document([tool]));
  assert.equal(validateMeshSolid(solid).shells, 1);
  // At the wheel mid-plane, the two straight flanks meet at x=.5.
  for (const y of [-.15, 0, .15]) close(raycastMesh(solid, [2, y, 0], [-1, 0, 0]).point[0], .5 + Math.abs(y), 1e-6);
  assert.ok(solid.faces.some(f => f.toolType === 'v-wheel' && f.region === 'concave'));
  assert.ok(normalizedOpticsMesh(solid).triangles.length > 0);
  const rotated = createMachiningStock(document([{ ...tool, phaseDeg: 90 }]));
  close(polyhedronVolume(rotated), polyhedronVolume(solid));
  close(raycastMesh(rotated, [0, 2, 0], [0, -1, 0]).point[1], .5, 1e-6);
});

test('disjoint compound cutters match separate removals without centroid patch inflation', () => {
  const spec = cut({ type: 'sphere', position: [1, 0, 0], radius: .2, repeat: 5, segments: 16, phaseDeg: 17.35 });
  const solid = createMachiningStock(document([spec]));
  const singles = expandConcaveCuts([spec]).map(tool => createMachiningStock(document([
    { ...spec, repeat: 1, phaseDeg: spec.phaseDeg + tool.repeatIndex * 72 },
  ])));
  close(polyhedronVolume(solid), 8 - singles.reduce((sum, one) => sum + 8 - polyhedronVolume(one), 0));
  assert.equal(validateMeshSolid(solid).shells, 1);
  assert.ok(solid.faces.some(face => face.vertexIndices.length > 3));
  assert.equal(new Set(solid.faces.filter(face => face.region === 'concave').map(face => face.toolInstanceId)).size, 5);
  for (const tool of expandConcaveCuts([spec])) {
    const a = tool.phaseDeg + tool.repeatIndex * 72;
    const direction = [Math.cos(a * Math.PI / 180), Math.sin(a * Math.PI / 180), 0];
    const origin = direction.map(v => v * 3);
    const hit = raycastMesh(solid, origin, direction.map(v => -v));
    const single = raycastMesh(singles[tool.repeatIndex], origin, direction.map(v => -v));
    close(hit.distance, single.distance);
  }
});

test('triangular prisms have straight flanks, adjustable included angle and finite axial ends', () => {
  for (const tipAngle of [45, 90, 120]) {
    const [tool] = normalizeConcaveCuts([cut({ type: 'triangular-prism', width: .6, length: 1.2, tipAngle, position: [1, 0, 0] })]);
    const solid = createMachiningStock(document([tool]));
    assert.equal(validateMeshSolid(solid).shells, 1);
    for (const y of [-.04, 0, .04]) {
      const expected = 1 - tool.radius + Math.abs(y) / Math.tan(tipAngle * Math.PI / 360);
      close(raycastMesh(solid, [2, y, 0], [-1, 0, 0]).point[0], expected, 1e-8);
    }
    close(raycastMesh(solid, [2, 0, .7], [-1, 0, 0]).point[0], 1);
    assert.ok(solid.faces.some(face => face.toolType === 'triangular-prism'));
    assert.deepEqual(summarizeToolPlanes(solid), ['plane']);
  }
  for (const patch of [{ width: 0 }, { length: 0 }, { tipAngle: 0 }, { tipAngle: 180 }, { tipAngle: NaN }]) {
    assert.throws(() => normalizeConcaveCuts([cut({ type: 'triangular-prism', ...patch })]));
  }
});

function summarizeToolPlanes(solid) {
  return [...new Set(solid.faces.filter(face => face.region === 'concave').map(face => face.surfaceType))];
}
