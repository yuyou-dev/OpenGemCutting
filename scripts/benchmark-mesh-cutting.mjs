/** Reproducible OBJ import and prepared concave cutting benchmark; no UI/GPU. */
import { cpus } from 'node:os';
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';
import { createMeshSolid, parseMeshOBJ, validateMeshSolid } from '../src/domain/mesh/index.js';
import { starRough } from '../src/domain/mesh/fixtures.js';
import { clipPolyhedronByPlanes, faceArea, polyhedronVolume } from '../src/domain/geometry.js';

const { values } = parseArgs({ options: {
  faces: { type: 'string', default: '100,1000,10000' },
  cuts: { type: 'string', default: '1,96' },
  warmup: { type: 'string', default: '3' },
  samples: { type: 'string', default: '10' },
  help: { type: 'boolean' },
} });
if (values.help) {
  console.log('node --expose-gc scripts/benchmark-mesh-cutting.mjs [--faces 100,1000,10000] [--cuts 1,96] [--warmup 3] [--samples 10]');
  process.exit(0);
}
const list = value => [...new Set(value.split(',').map(Number))];
const sourceCounts = list(values.faces), cutCounts = list(values.cuts);
const warmup = Number(values.warmup), samples = Number(values.samples), tolerance = 1e-8;
if (sourceCounts.some(value => ![100, 1000, 10000].includes(value))
  || cutCounts.some(value => !Number.isInteger(value) || value < 1)
  || !Number.isInteger(warmup) || warmup < 0 || !Number.isInteger(samples) || samples < 1) {
  throw new Error('faces must be 100/1000/10000; cuts and samples positive integers; warmup a nonnegative integer');
}

const toOBJ = solid => [
  ...solid.vertices.map(p => `v ${p.x} ${p.y} ${p.z}`),
  ...solid.faces.map(face => `f ${face.vertexIndices.map(id => id + 1).join(' ')}`),
].join('\n');
const cuttingPlanes = count => Array.from({ length: count }, (_, index) => ({
  normal: [Math.cos(index * 2 * Math.PI / count), Math.sin(index * 2 * Math.PI / count), 0.2],
  offset: 0.6, faceId: `cut:${index}`, sourceOperationId: `cut:${index}`,
}));

function measure(run) {
  for (let i = 0; i < warmup; i++) run();
  global.gc?.();
  const times = [];
  for (let i = 0; i < samples; i++) {
    const start = performance.now(); run(); times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const percentile = q => +times[Math.ceil(q * times.length) - 1].toFixed(6);
  return { medianMs: percentile(0.5), p95Ms: percentile(0.95), maxMs: percentile(1) };
}

function areaBySurface(solid) {
  const areas = new Map();
  for (const face of solid.faces) {
    const id = face.facetId ?? face.id;
    areas.set(id, (areas.get(id) ?? 0) + faceArea(solid, face));
  }
  return areas;
}

function verify(source, planes) {
  const sourceVolume = polyhedronVolume(source);
  let solid = source, previousVolume = sourceVolume, maximumStepVolumeIncrease = 0;
  // Verify every intermediate boundary outside timing; no vertex welding is
  // allowed to conceal an open edge. Full embedding was checked on import.
  for (const plane of planes) {
    solid = clipPolyhedronByPlanes(solid, [plane]);
    validateMeshSolid(solid, { embedding: false });
    const volume = polyhedronVolume(solid);
    maximumStepVolumeIncrease = Math.max(maximumStepVolumeIncrease, volume - previousVolume);
    previousVolume = volume;
  }
  let maximumHalfspaceViolation = 0;
  for (const p of solid.vertices) for (const { normal: n, offset } of planes) {
    maximumHalfspaceViolation = Math.max(maximumHalfspaceViolation, n[0] * p.x + n[1] * p.y + n[2] * p.z - offset);
  }
  const reverse = clipPolyhedronByPlanes(source, [...planes].reverse());
  validateMeshSolid(reverse, { embedding: false });
  const orderVolumeDifference = Math.abs(polyhedronVolume(solid) - polyhedronVolume(reverse));
  const forwardAreas = areaBySurface(solid), reverseAreas = areaBySurface(reverse);
  let maximumOrderSurfaceAreaDifference = 0;
  for (const id of new Set([...forwardAreas.keys(), ...reverseAreas.keys()])) {
    maximumOrderSurfaceAreaDifference = Math.max(maximumOrderSurfaceAreaDifference, Math.abs((forwardAreas.get(id) ?? 0) - (reverseAreas.get(id) ?? 0)));
  }
  if (maximumStepVolumeIncrease > tolerance || maximumHalfspaceViolation > tolerance
    || orderVolumeDifference > tolerance || maximumOrderSurfaceAreaDifference > tolerance
    || !(previousVolume > 0 && previousVolume < sourceVolume - tolerance)) {
    throw new Error('Output failed material-volume / half-space / reverse-order validation');
  }
  return { sourceVolume, volume: previousVolume, maximumStepVolumeIncrease, maximumHalfspaceViolation,
    orderVolumeDifference, maximumOrderSurfaceAreaDifference,
    topology: validateMeshSolid(solid, { embedding: false }),
    effectiveCutCount: new Set(solid.faces.filter(face => face.facetId).map(face => face.facetId)).size };
}

const rows = [];
for (const sourceFaces of sourceCounts) {
  const text = toOBJ(starRough(sourceFaces));
  const start = performance.now();
  const parsed = parseMeshOBJ(text), source = createMeshSolid(parsed);
  const importMs = performance.now() - start;
  for (const planeCount of cutCounts) {
    const planes = cuttingPlanes(planeCount);
    const verification = verify(source, planes);
    rows.push({ sourceFaces, sourceVertices: source.vertices.length, planeCount, importMs,
      importValidation: parsed.validation,
      prepared: measure(() => clipPolyhedronByPlanes(source, planes)), verification });
  }
}
console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, warmup, samples, tolerance,
  gcBeforeSampling: !!global.gc,
  scope: 'Cold OBJ parse + validated solid construction, once per source; fixture generation excluded. Prepared cutting excludes import, validation, React, impact policy, drawing and GPU. Every intermediate topology, material volume, final half-spaces and reverse-order logical surface areas are checked outside timing. Imported embedding validation is not a proof of all possible floating-point degeneracies.',
  rows }, null, 2));
