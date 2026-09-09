/**
 * Pure geometry benchmark; excludes setup, validation, UI, impact checks and GPU.
 * node --expose-gc scripts/benchmark-indexed-cutting.mjs [--warmup 10] [--samples 40]
 * Optional: --peer /path/to/experimental/index.ts (exports cutPolyhedron).
 * Edge pairing checks closure, not global self-intersection or shape equivalence.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { cpus, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';
import { clipPolyhedronByPlanes, clipPolyhedronPreview, polyhedronVolume } from '../src/domain/geometry.js';

const { values } = parseArgs({ options: {
  peer: { type: 'string' }, warmup: { type: 'string', default: '10' },
  samples: { type: 'string', default: '40' }, help: { type: 'boolean' },
} });
if (values.help) {
  console.log('Usage: node --expose-gc scripts/benchmark-indexed-cutting.mjs [--peer module.ts] [--warmup 10] [--samples 40]');
  process.exit(0);
}
const warmup = Number(values.warmup), samples = Number(values.samples), tolerance = 1e-8;
if (!Number.isInteger(warmup) || warmup < 0 || !Number.isInteger(samples) || samples < 1) {
  throw new Error('warmup must be a nonnegative integer; samples must be a positive integer');
}
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const subtract = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const normalize = v => { const length = Math.hypot(v.x, v.y, v.z); return { x: v.x / length, y: v.y / length, z: v.z / length }; };

function bipyramid(faceCount) {
  const n = faceCount / 2;
  const vertices = Array.from({ length: n }, (_, i) => ({ x: Math.cos(i * 2 * Math.PI / n), y: Math.sin(i * 2 * Math.PI / n), z: 0 }));
  vertices.push({ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 });
  const polygons = [];
  for (let i = 0; i < n; i++) polygons.push([i, (i + 1) % n, n], [(i + 1) % n, i, n + 1]);
  const faces = polygons.map((vertexIndices, i) => {
    const [a, b, c] = vertexIndices.map(id => vertices[id]);
    return { id: `source:${i}`, vertexIndices, normal: normalize(cross(subtract(b, a), subtract(c, a))) };
  });
  return { vertices, faces };
}
function cuttingPlanes(count) {
  return Array.from({ length: count }, (_, i) => {
    const ring = Math.floor(i / 16), angle = (i % 16) * Math.PI / 8;
    const raw = { x: Math.cos(angle), y: Math.sin(angle), z: ring === 0 ? 0.5 : ring === 1 ? -0.5 : 0 };
    return { normal: normalize(raw), offset: (ring < 2 ? 0.85 : 0.72) / Math.hypot(raw.x, raw.y, raw.z), faceId: `cut:${i}` };
  });
}
const toPeer = solid => ({ vertices: solid.vertices, faces: solid.faces.map(face => ({ vertices: face.vertexIndices, surfaceId: face.id })) });
const fromPeer = solid => ({ vertices: solid.vertices, faces: solid.faces.map(face => ({ vertexIndices: face.vertices, id: face.surfaceId })) });
function inspect(solid, constraints) {
  const edges = new Map(), used = new Set();
  let edgePairErrors = 0, maximumViolation = 0;
  for (const face of solid.faces) {
    for (let i = 0; i < face.vertexIndices.length; i++) {
      const a = face.vertexIndices[i], b = face.vertexIndices[(i + 1) % face.vertexIndices.length];
      used.add(a);
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const edge = edges.get(key) ?? { count: 0, orientation: 0 };
      edge.count++; edge.orientation += a < b ? 1 : -1; edges.set(key, edge);
    }
  }
  for (const edge of edges.values()) if (edge.count !== 2 || edge.orientation !== 0) edgePairErrors++;
  for (const vertex of solid.vertices) for (const plane of constraints) {
    maximumViolation = Math.max(maximumViolation, dot(plane.normal, vertex) - plane.offset);
  }
  const volume = polyhedronVolume(solid);
  const closed = edgePairErrors === 0 && used.size === solid.vertices.length && volume > 0;
  if (!closed || !Number.isFinite(maximumViolation) || maximumViolation > tolerance) throw new Error('Output failed closure / half-space validation');
  return { volume, vertices: solid.vertices.length, patches: solid.faces.length, edges: edges.size, closed,
    maximumViolation, survivingCutIds: [...new Set(solid.faces.map(face => face.id).filter(id => id.startsWith('cut:')))] };
}
function measure(run) {
  for (let i = 0; i < warmup; i++) run();
  global.gc?.();
  const times = [];
  for (let i = 0; i < samples; i++) { const start = performance.now(); run(); times.push(performance.now() - start); }
  times.sort((a, b) => a - b);
  const quantile = q => +times[Math.ceil(q * times.length) - 1].toFixed(6);
  return { medianMs: quantile(0.5), p95Ms: quantile(0.95), maxMs: quantile(1) };
}

let temporaryDirectory;
try {
  let peerCut;
  if (values.peer) {
    let modulePath = resolve(values.peer);
    if (/\.[cm]?tsx?$/.test(modulePath)) {
      const { build } = await import('esbuild'); // Already provided by Vite; optional benchmark only.
      temporaryDirectory = await mkdtemp(join(tmpdir(), 'facet-indexed-benchmark-'));
      const outfile = join(temporaryDirectory, 'peer.mjs');
      await build({ entryPoints: [modulePath], outfile, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
      modulePath = outfile;
    }
    peerCut = (await import(pathToFileURL(modulePath).href)).cutPolyhedron;
    if (typeof peerCut !== 'function') throw new Error('Peer module must export cutPolyhedron');
  }
  const rows = [];
  for (const sourceFaces of [100, 1000]) for (const planeCount of [1, 8, 48]) {
    const source = bipyramid(sourceFaces), planes = cuttingPlanes(planeCount);
    const sourcePlanes = source.faces.map(face => ({ normal: face.normal, offset: dot(face.normal, source.vertices[face.vertexIndices[0]]) }));
    const sourceMetrics = inspect(source, sourcePlanes);
    const runners = { canonical: () => clipPolyhedronByPlanes(source, planes), preview: () => clipPolyhedronPreview(source, planes) };
    if (peerCut) {
      const peerSource = toPeer(source);
      runners.peer = () => planes.reduce((solid, plane) => peerCut(solid, plane, { surfaceId: plane.faceId, trustedInput: true }).solid, peerSource);
    }
    const paths = {};
    for (const [name, run] of Object.entries(runners)) {
      const output = run(), solid = name === 'peer' ? fromPeer(output) : output;
      const metrics = inspect(solid, [...sourcePlanes, ...planes]);
      if (!(metrics.volume < sourceMetrics.volume - tolerance)) throw new Error('Fixture did not remove material');
      paths[name] = { ...measure(run), ...metrics };
    }
    const volumes = Object.values(paths).map(path => path.volume);
    const volumeDifference = Math.max(...volumes) - Math.min(...volumes);
    if (volumeDifference > tolerance) throw new Error('Kernel volume comparison failed');
    rows.push({ sourceFaces, planeCount, sourceVolume: sourceMetrics.volume, volumeDifference, paths });
  }
  console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, warmup, samples, gcBetweenPaths: !!global.gc, tolerance,
    scope: 'Pure geometry; convex bipyramids; validation outside timing; edge closure and volume comparison do not prove global self-intersection freedom or full geometric equivalence.', rows }, null, 2));
} finally {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
}
