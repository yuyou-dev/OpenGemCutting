import { triangulateSection } from './mesh/section.js';
import { createMeshDocument } from './stockGeometry.js';

const area = ring => ring.reduce((sum, p, i) => {
  const q = ring[(i + 1) % ring.length];
  return sum + p[0] * q[1] - q[0] * p[1];
}, 0) / 2;
const orient = (ring, positive) => (area(ring) > 0) === positive ? ring : [...ring].reverse();

/** Extrude a cross-section along Z, preserving holes and outward winding. */
export function extrudeStock(outer, holes, height) {
  const rings = [orient(outer, true), ...holes.map(ring => orient(ring, false))];
  const points = rings.flat();
  const vertices = [-height / 2, height / 2].flatMap(z => points.map(([x, y]) => ({ x, y, z })));
  let cursor = 0;
  const loops = rings.map(ring => ring.map(() => cursor++));
  const n = points.length;
  const top = triangulateSection(vertices, loops.map(loop => loop.map(i => i + n)), { x: 0, y: 0, z: 1 }, 1e-9);
  const faces = [...top, ...top.map(face => [...face].reverse().map(i => i - n))];
  for (const loop of loops) for (let j = 0; j < loop.length; j++) {
    const a = loop[j], b = loop[(j + 1) % loop.length];
    faces.push([a, b, b + n, a + n]);
  }
  return { vertices, faces };
}

// Two cubic arcs form a full lobe and a convex, rounded lower half.
const cubic = (a, b, c, d, t) => a.map((v, i) => (1-t)**3*v + 3*(1-t)**2*t*b[i] + 3*(1-t)*t*t*c[i] + t**3*d[i]);
const heartHalf = [
  ...Array.from({ length: 24 }, (_, i) => cubic([0, .55], [.25, 1.15], [1.1, 1.05], [1, .25], i/24)),
  ...Array.from({ length: 25 }, (_, i) => cubic([1, .25], [.94, -.23], [.32, -.9], [0, -.9], i/24)),
];
const heart = [...heartHalf, ...heartHalf.slice(1, -1).reverse().map(([x,y]) => [-x,y])];
const arm = [[0.3, 0.3], ...Array.from({ length: 17 }, (_, i) => [0.3 * Math.cos(i * Math.PI / 16), 0.7 + 0.3 * Math.sin(i * Math.PI / 16)])];
const cross = Array.from({ length: 4 }, (_, k) => arm.map(([x, y]) => {
  for (let i = 0; i < k; i++) [x, y] = [-y, x];
  return [x, y];
})).flat();

const definitions = [
  { id: 'heart', name: '心形', symmetry: '左右镜像', outer: heart },
  { id: 'rounded-cross', name: '圆端十字形', symmetry: '四次旋转 · 镜像', outer: cross },
  { id: 'bow-tie', name: '蝴蝶结形', symmetry: '左右、上下镜像', outer: [[-1, -0.6], [0, -0.24], [1, -0.6], [1, 0.6], [0, 0.24], [-1, 0.6]] },
  { id: 'letter-a', name: 'A 形', symmetry: '左右镜像 · 贯穿孔', outer: [[-0.85, -1], [-0.3, 1], [0.3, 1], [0.85, -1], [0.48, -1], [0.27, -0.28], [-0.27, -0.28], [-0.48, -1]], holes: [[[-0.2, 0.05], [0.2, 0.05], [0.07, 0.65], [-0.07, 0.65]]] },
];

// Normalize all outlines to a maximum transverse extent of 2; height is 100%.
export const STOCK_PRESETS = definitions.map(definition => {
  const { outer } = definition;
  const min = [0, 1].map(a => Math.min(...outer.map(p => p[a])));
  const max = [0, 1].map(a => Math.max(...outer.map(p => p[a])));
  const scale = 2 / Math.max(max[0] - min[0], max[1] - min[1]);
  const convert = ring => ring.map(p => p.map((v, a) => (v - (min[a] + max[a]) / 2) * scale));
  const profile = convert(outer), holes = (definition.holes ?? []).map(convert);
  return { id: definition.id, name: definition.name, symmetry: definition.symmetry, profile, holes, height: 2 };
});

export function createPresetStockDocument(preset) {
  return createMeshDocument({ name: `${preset.name}底胚`, mesh: extrudeStock(preset.profile, preset.holes, preset.height) });
}

export function presetStockOBJ(preset) {
  const mesh = extrudeStock(preset.profile, preset.holes, preset.height);
  return [`# ${preset.name} / Facet 96 stock preset`, '# Unit unspecified; maximum cross-section extent 2, height 2; +Z up',
    ...mesh.vertices.map(p => `v ${[p.x, p.y, p.z].map(v => Number(v.toFixed(10))).join(' ')}`),
    ...mesh.faces.map(face => `f ${face.map(i => i + 1).join(' ')}`), ''].join('\n');
}
