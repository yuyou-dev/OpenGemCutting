import assert from 'node:assert/strict';
import test from 'node:test';
import { clipPolyhedronByPlanes, clipPolyhedronIndexedPreview, clipPolyhedronPreview, createCenteredCube, faceArea, polyhedronVolume } from './geometry.js';
import { createWorkbenchDocument } from './document.js';
import { resolveFacetPattern } from './faceting.js';
import { planeEntry } from './cutConstruction.js';

const document = createWorkbenchDocument();
const cube = createCenteredCube();
const pattern = (region, depth) => resolveFacetPattern({
  patternId: region, region, depth, baseIndex: 5, repeat: 96, mirror: 0,
  industryAngleDeg: region === 'girdle' ? 90 : 42,
}, { stock: document.stock }).map(planeEntry);

function compare(actual, expected) {
  assert.ok(Math.abs(polyhedronVolume(actual) - polyhedronVolume(expected)) < 2e-8);
  assert.deepEqual(actual.faces.map(face => face.id).sort(), expected.faces.map(face => face.id).sort());
  for (const face of actual.faces) {
    const other = expected.faces.find(candidate => candidate.id === face.id);
    assert.ok(Math.abs(faceArea(actual, face) - faceArea(expected, other)) < 2e-8);
    assert.equal(face.sourceOperationId, other.sourceOperationId);
    assert.equal(face.region, other.region);
  }
}

test('indexed convex preview preserves 96 + 96 effective face identities, area and volume', () => {
  const girdle = pattern('girdle', 0.55), pavilion = pattern('pavilion', 0.45);
  const source = clipPolyhedronByPlanes(cube, girdle), before = JSON.stringify(source);
  compare(clipPolyhedronIndexedPreview(source, pavilion), clipPolyhedronByPlanes(source, pavilion));
  compare(clipPolyhedronIndexedPreview(cube, [...girdle, ...pavilion]), clipPolyhedronByPlanes(cube, [...girdle, ...pavilion]));
  assert.equal(JSON.stringify(source), before);
});

test('indexed preview falls back for legacy open adjacency, repeated IDs and per-plane tolerance', () => {
  const bad = { ...cube, faces: cube.faces.slice(1) };
  const planes = pattern('girdle', 0.55);
  assert.deepEqual(clipPolyhedronIndexedPreview(bad, planes), clipPolyhedronPreview(bad, planes));
  const repeated = [
    { normal: [1, 0, 0], d: 0.8, faceId: 'same' },
    { normal: [0, 1, 0], d: 0.6, faceId: 'same' },
  ];
  assert.deepEqual(clipPolyhedronIndexedPreview(cube, repeated), clipPolyhedronPreview(cube, repeated));
  const tolerance = planes.map(plane => ({ ...plane, options: { tolerance: 1e-8 } }));
  assert.deepEqual(clipPolyhedronIndexedPreview(cube, tolerance), clipPolyhedronPreview(cube, tolerance));
});

test('indexed preview leaves the canonical geometry and serialized Meet source unchanged', () => {
  const planes = [...pattern('girdle', 0.55), ...pattern('pavilion', 0.7)];
  const before = clipPolyhedronByPlanes(cube, planes);
  clipPolyhedronIndexedPreview(cube, planes);
  assert.deepEqual(clipPolyhedronByPlanes(cube, planes), before);
});
