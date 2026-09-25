import test from 'node:test';
import assert from 'node:assert/strict';
import { createCenteredCube } from './geometry.js';
import { opticsSurfaceMaterials, normalizedSurfaceOptics, MAX_SURFACE_PLANES } from './opticsSurface.js';
import { normalizedOpticsPlanes } from './opticsGeometry.js';

const frosted = { version: 1, model: 'ggx-dielectric', state: 'frosted', alpha: .32, scatter: .1 };

test('optical finishes follow facet identity through patch splits, plane sorting and BVH reordering, not operation membership', () => {
  const solid = createCenteredCube();
  solid.faces = solid.faces.map((face, i) => ({ ...face, id: 'patch-' + i, facetId: i < 2 ? 'A' : 'B', sourceOperationId: 'same-tier' }));
  delete solid.faces[5].facetId; // newly cut/stock surface: no matching design finish
  const facets = [{ id: 'A', metadata: { surfaceFinish: frosted } }, { id: 'B' }];
  const original = structuredClone({ solid, facets });
  const finish = opticsSurfaceMaterials(solid, facets);
  assert.equal(finish.frostedCount, 2);
  const expected = index => index < 2 ? [.32, .1, index + 1, 0] : [0, 0, index + 1, 0];
  // Convex: traced by sorted half-spaces, each carrying its own face material.
  const convex = normalizedSurfaceOptics(solid, finish.materials);
  assert.equal(convex.framing, 'convex');
  assert.equal(convex.mesh, undefined);
  const { planes, faceIndices } = normalizedOpticsPlanes(solid);
  assert.deepEqual(convex.planes, planes);
  assert.deepEqual(convex.materials, faceIndices.map(expected));
  // Mesh: BVH triangles resolve materials after the reorder.
  const mesh = normalizedSurfaceOptics({ ...solid, kind: 'mesh' }, finish.materials);
  assert.equal(mesh.framing, 'mesh');
  assert.equal(mesh.materials.length, 12);
  mesh.mesh.triangles.forEach((tri, i) => assert.deepEqual(mesh.materials[i], expected(tri.faceIndex)));
  assert.deepEqual({ solid, facets }, original);
  assert.deepEqual(normalizedOpticsPlanes(solid), normalizedOpticsPlanes(original.solid));
});

test('convex solids beyond one uniform block fall back to BVH triangles with convex shortcuts', () => {
  const solid = createCenteredCube();
  const faces = Array.from({ length: MAX_SURFACE_PLANES + 1 }, () => solid.faces[0]);
  const render = normalizedSurfaceOptics({ ...solid, faces }, faces.map((_, index) => [0, 0, index + 1, 0]));
  assert.equal(render.framing, 'convex');
  assert.ok(render.mesh);
});

test('old documents and explicit polished faces produce zero roughness; finish-only updates cannot reuse old materials', () => {
  const solid = createCenteredCube();
  solid.faces[0].id = 'A';
  const old = opticsSurfaceMaterials(solid, []);
  const polished = opticsSurfaceMaterials(solid, [{ id: 'A', metadata: { surfaceFinish: { ...frosted, state: 'polished', alpha: 0 } } }]);
  assert.deepEqual(old, polished);
  assert.equal(old.frostedCount, 0);
  const marked = opticsSurfaceMaterials(solid, [{ id: 'A', metadata: { surfaceFinish: frosted } }]);
  assert.equal(marked.frostedCount, 1);
  assert.notDeepEqual(normalizedSurfaceOptics(solid, marked.materials).materials, normalizedSurfaceOptics(solid, old.materials).materials);
});

test('unsupported active frosted parameters are rejected instead of silently rendered polished', () => {
  const solid = createCenteredCube();
  solid.faces[0].id = 'A';
  for (const patch of [{ alpha: 0 }, { alpha: NaN }, { alpha: 2 }, { scatter: -1 }, { model: 'unknown' }, { version: 2 }]) {
    assert.throws(() => opticsSurfaceMaterials(solid, [{ id: 'A', metadata: { surfaceFinish: { ...frosted, ...patch } } }]), /不支持/);
  }
});

test('real concave subtraction retains frosted planar patches and leaves new tool boundaries unmarked', async () => {
  const { evaluateDocument } = await import('./documentGeometry.js');
  const { normalizeConcaveCuts } = await import('./concaveCuts.js');
  const facets = [{ id: 'top', patternId: 'top', region: 'crown',
    plane: { normal: { x: 0, y: 0, z: 1 }, offset: .6 }, metadata: { surfaceFinish: frosted } }];
  const doc = { stock: { kind: 'cube', size: 2, center: [0, 0, 0] }, facets,
    concaveCuts: normalizeConcaveCuts([{ id: 'notch', position: [1, 0, .6], radius: .5 }]) };
  const solid = evaluateDocument(doc);
  const finish = opticsSurfaceMaterials(solid, facets);
  assert.ok(finish.frostedCount > 0);
  assert.ok(solid.faces.some(face => face.region === 'concave'));
  const render = normalizedSurfaceOptics(solid, finish.materials);
  assert.equal(render.framing, 'mesh');
  render.mesh.triangles.forEach((triangle, index) => {
    const face = solid.faces[triangle.faceIndex];
    assert.equal(render.materials[index][0], (face.facetId ?? face.id) === 'top' ? .32 : 0);
  });
  const plain = evaluateDocument({ ...doc, facets: facets.map(({ metadata, ...facet }) => facet) });
  assert.deepEqual(solid, plain);
});
