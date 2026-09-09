import { evaluateDraftImpact, classifyJumpCandidate, resolveDraftCommitPolicy } from "./meetJump.js";
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMeshSolid, parseMeshOBJ, validateMeshSolid } from './mesh/index.js';
import { createCenteredCube, clipPolyhedron, clipPolyhedronByPlanes, clipPolyhedronPreview, polyhedronVolume } from './geometry.js';
import { hollowRough, starRough, torusRough, uRough, voxelRough } from './mesh/fixtures.js';

const near = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
const cut = (solid, normal = [0, 0, 1], offset = 0.5, faceId = 'test') => clipPolyhedron(solid, { normal, offset, faceId, sourceOperationId: 'C1', region: 'crown', operationType: 'symmetric' });
const obj = solid => [...solid.vertices.map(p => `v ${p.x} ${p.y} ${p.z}`), ...solid.faces.map(f => `f ${f.vertexIndices.map(id => id + 1).join(' ')}`)].join('\n');
const combine = (...solids) => solids.reduce((result, solid) => ({
  vertices: [...result.vertices, ...solid.vertices],
  faces: [...result.faces, ...solid.faces.map(face => ({ ...face, id: `part:${result.vertices.length}:${face.id}`, vertexIndices: face.vertexIndices.map(id => id + result.vertices.length) }))],
}), { vertices: [], faces: [] });

test('mesh cutting retains concavity, all disconnected material, holes and cavity shells', () => {
  const u = cut(createMeshSolid(uRough()), [0, -1, 0], -1.25);
  assert.equal(validateMeshSolid(u).shells, 2); near(polyhedronVolume(u), 3.5);
  const ring = cut(createMeshSolid(hollowRough()));
  assert.equal(validateMeshSolid(ring).euler, 0); near(polyhedronVolume(ring), 4);
  const cavity = createMeshSolid(hollowRough(true));
  assert.equal(validateMeshSolid(cavity).shells, 2); near(polyhedronVolume(cavity), 26);
  const opened = cut(cavity, [0, 0, 1], 1.5);
  assert.equal(validateMeshSolid(opened).shells, 1); near(polyhedronVolume(opened), 13);
  near(polyhedronVolume(cut(cavity, [0, 0, 1], 2.5)), 21.5);
});

test('mesh cap patches share logical facet identity without replacing untouched patch identity', () => {
  const solid = createMeshSolid(uRough()), snapshot = JSON.stringify(solid);
  const result = cut(solid), caps = result.faces.filter(face => face.facetId === 'test');
  assert.ok(caps.length > 1);
  assert.equal(new Set(result.faces.map(face => face.id)).size, result.faces.length);
  for (const face of caps) {
    assert.equal(face.sourceOperationId, 'C1'); assert.equal(face.region, 'crown');
    assert.equal(face.operationType, 'symmetric'); assert.deepEqual(face.normal, { x: 0, y: 0, z: 1 });
  }
  assert.ok(result.faces.filter(face => !face.facetId).every(face => solid.faces.some(original => original.id === face.id)));
  assert.equal(JSON.stringify(solid), snapshot);
  assert.deepEqual(cut(solid), result);
  assert.deepEqual(cut(result), result);
});

test('mesh tangent, on-vertex cuts, complete removal and whole-component removal stay closed', () => {
  const solid = createMeshSolid(uRough());
  assert.deepEqual(cut(solid, [0, 0, 1], 1), solid);
  assert.equal(cut(solid, [0, 0, 1], 0).faces.length, 0);
  for (const [normal, offset] of [[[1, 0, 0], 1], [[1, 1, 1], 2], [[1, 1, 0], 2]]) validateMeshSolid(cut(solid, normal, offset));
  const disconnected = createMeshSolid(voxelRough([[0, 0, 0], [3, 0, 0]]));
  near(polyhedronVolume(cut(disconnected, [1, 0, 0], 2)), 1);
});

test('mesh source and preview routes produce identical ordered 96-plane material and metadata', () => {
  const solid = createMeshSolid(starRough(1000));
  const planes = Array.from({ length: 96 }, (_, index) => {
    const angle = index * Math.PI * 2 / 96;
    return { plane: { normal: [Math.cos(angle), Math.sin(angle), 0.2], d: 0.6 }, faceId: `C2:${index}`, sourceOperationId: 'C2', options: { region: 'crown' } };
  });
  const output = clipPolyhedronByPlanes(solid, planes);
  assert.deepEqual(clipPolyhedronPreview(solid, planes), output);
  validateMeshSolid(output);
  assert.ok(polyhedronVolume(output) < polyhedronVolume(solid));
  const reversed = clipPolyhedronByPlanes(solid, [...planes].reverse());
  near(polyhedronVolume(reversed), polyhedronVolume(output));
});

test('100 and 1000 triangle concave stocks retain half-volume and torus openings', () => {
  for (const count of [100, 1000]) {
    const solid = createMeshSolid(starRough(count));
    assert.equal(solid.faces.length, count);
    const result = cut(solid, [0, 0, 1], 0);
    near(polyhedronVolume(result), polyhedronVolume(solid) / 2);
    assert.equal(validateMeshSolid(result).euler, 2);
    for (const offset of [0, 0.07, 0.2]) {
      const torus = cut(createMeshSolid(torusRough(count)), [0, 0, 1], offset);
      assert.equal(validateMeshSolid(torus).euler, 0);
    }
  }
});

test('seeded oblique cuts match an independent analytic sum-of-cubes volume oracle', () => {
  const cells = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [0, 1, 0], [2, 1, 0], [0, 2, 0], [2, 2, 0]];
  const solid = createMeshSolid(voxelRough(cells));
  for (let i = 1; i <= 40; i++) {
    const n = [0.2 + Math.abs(Math.sin(i)), 0.3 + Math.abs(Math.cos(i * 1.7)), 0.4 + Math.abs(Math.sin(i * 0.7))];
    const offset = 0.1 + (i % 37) / 7;
    let expected = 0;
    for (const cell of cells) {
      const t = offset - cell.reduce((sum, value, axis) => sum + value * n[axis], 0);
      for (let mask = 0; mask < 8; mask++) {
        let shift = 0, bits = 0;
        for (let axis = 0; axis < 3; axis++) if (mask & (1 << axis)) { shift += n[axis]; bits++; }
        expected += (bits % 2 ? -1 : 1) * Math.max(0, t - shift) ** 3 / (6 * n[0] * n[1] * n[2]);
      }
    }
    const result = cut(solid, n, offset);
    near(polyhedronVolume(result), expected);
    validateMeshSolid(result);
    near(polyhedronVolume(result) + polyhedronVolume(cut(solid, n.map(value => -value), -offset)), 7);
  }
});

test('OBJ parsing roundtrips indexed concave stock and rejects open, malformed or inverted boundaries', () => {
  const solid = createMeshSolid(uRough());
  const parsed = parseMeshOBJ(obj(solid));
  assert.equal(parsed.validation.embeddingChecked, true);
  near(polyhedronVolume(createMeshSolid(parsed)), 7);
  const cube = createCenteredCube();
  const negativeIndices = obj(cube).replace(/^f (.*)$/gm, (_, ids) => `f ${ids.split(' ').map(id => Number(id) - 1 - cube.vertices.length).join(' ')}`);
  near(polyhedronVolume(createMeshSolid(parseMeshOBJ(negativeIndices))), 8);
  assert.throws(() => parseMeshOBJ('v NaN 0 0\nf 1 2 3'), /坐标/);
  assert.throws(() => parseMeshOBJ(obj({ ...cube, faces: cube.faces.slice(1) })), /open boundary/);
  assert.throws(() => parseMeshOBJ(obj({ ...cube, faces: cube.faces.map(f => ({ ...f, vertexIndices: [...f.vertexIndices].reverse() })) })), /volume/);
  assert.throws(() => parseMeshOBJ('v 0 0 0\nf 1 2 0'), /索引/);
});

test('embedding validation rejects overlapping shells and incorrect cavity orientation', () => {
  const cube = createCenteredCube();
  const shifted = { ...cube, vertices: cube.vertices.map(p => ({ x: p.x + 0.7, y: p.y + 0.6, z: p.z + 0.5 })) };
  assert.throws(() => createMeshSolid(combine(cube, shifted)), /self-intersection|overlapping/);
  const smaller = { ...cube, vertices: cube.vertices.map(p => ({ x: p.x * 0.5, y: p.y * 0.5, z: p.z * 0.5 })) };
  assert.throws(() => createMeshSolid(combine(cube, smaller)), /orientation/);
  const cavity = { ...smaller, faces: smaller.faces.map(f => ({ ...f, vertexIndices: [...f.vertexIndices].reverse() })) };
  near(polyhedronVolume(createMeshSolid(combine(cube, cavity))), 7);
  const island = { ...cube, vertices: cube.vertices.map(p => ({ x: p.x * 0.25, y: p.y * 0.25, z: p.z * 0.25 })) };
  const nested = createMeshSolid(combine(cube, cavity, island));
  near(polyhedronVolume(nested), 7.125);
  const opened = cut(nested, [0, 0, 1], 0);
  near(polyhedronVolume(opened), 7.125 / 2);
  assert.equal(validateMeshSolid(opened).shells, 2);
});

test('mesh plane aliases, per-plane tolerance and input validation follow the geometry facade', () => {
  const solid = createMeshSolid(createCenteredCube());
  near(polyhedronVolume(clipPolyhedron(solid, { n: [0, 0, 2], constant: 0 })), 4);
  assert.throws(() => clipPolyhedron(solid, { normal: [0, 0, 0], d: 0 }), /non-zero/);
  assert.throws(() => clipPolyhedron(solid, { normal: [0, 0, 1], d: 0 }, { tolerance: -1 }), /positive/);
  const planes = [{ normal: [1, 0, 0], d: 1 - 1e-6, options: { tolerance: 1e-5 } }];
  assert.deepEqual(clipPolyhedronPreview(solid, planes), solid);
});


test('a branching mesh section blocks CUT and Jump without losing the editable source', () => {
  const source = createMeshSolid(uRough());
  const plane = { normal: [1, -1, 1], d: 1, faceId: 'branch' };
  const impact = evaluateDraftImpact({ baseSolid: source, planes: [plane], preview: true });
  assert.equal(impact.status, 'unreachable');
  assert.equal(impact.reason, 'singular-section');
  assert.equal(resolveDraftCommitPolicy(impact), 'block');
  assert.equal(impact.resultSolid, source);
  const candidate = classifyJumpCandidate({ candidate: { depth: 1 }, baseSolid: source,
    normal: plane.normal, planesForDepth: () => [plane], preview: true });
  assert.equal(candidate.status, 'unreachable');
  assert.ok(candidate.message);
  for (const d of [0.99, 1.01]) {
    const recovered = evaluateDraftImpact({ baseSolid: source, planes: [{ ...plane, d }], preview: true });
    assert.equal(recovered.error, undefined);
    assert.ok(recovered.resultSolid.vertices.length > 0);
    validateMeshSolid(recovered.resultSolid);
  }
});


test('mesh impact shares preview and commit scale-aware precision, including shallow cuts', () => {
  const source = createMeshSolid(uRough());
  for (const planes of [
    [{ normal: [1, 0, 0], d: 3 - 5e-9, faceId: 'shallow' }],
    [{ normal: [0, 0, 1], d: .7, faceId: 'top' }, { normal: [1, 0, 0], d: 2.1, faceId: 'side' }],
  ]) {
    const impact = evaluateDraftImpact({ baseSolid: source, planes, preview: true });
    assert.equal(impact.error, undefined);
    assert.deepEqual(impact.resultSolid, clipPolyhedronPreview(source, planes));
    assert.deepEqual(impact.resultSolid, clipPolyhedronByPlanes(source, planes));
  }
});
