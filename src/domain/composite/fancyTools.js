/*
 * Fancy tools: lifted plane arrangements on a convex reference dome.
 *
 * Ported from the Advanced Fancy Cut Lab 0.2.0 research package (source
 * commit f615a92, dist/generators.js, dist/pentagrid.js, dist/arc-weave.js),
 * commissioned for this editor. Most families are tangent planes of the dome
 * z = -C r² at chosen seed points, so each facet is the (power) Voronoi cell
 * of its seed; asanoha, the oblique net, the pentagrid and the arc weave
 * lift a planar tiling whose cells stay planar.
 *
 * Built in the tool frame (axis +Z away from the girdle, rim radius 1) at
 * unit edge slope: C = 1/2, so the dome's slope at r = 1 is 1. Everything is
 * linear in the slope, so the registry scales the result by tan(edge angle)
 * and never regenerates a shape for an angle or depth change. Placement on
 * the crown or the pavilion, the whole-tooth rotation and the depth belong to
 * the host; the research lab's own region, phase and sink are not ported.
 */

const C = 0.5;
const TAU = 2 * Math.PI;
const DEG = Math.PI / 180;

const gcd = (a, b) => {
  let x = Math.round(Math.abs(a)), y = Math.round(Math.abs(b));
  while (y) [x, y] = [y, x % y];
  return x || 1;
};

/** Tangent plane of the dome z = -C r² at (x, y): z = C|p|² - 2C p · X. */
function tangentPlane(x, y, meta) {
  const gx = 2 * C * x, gy = 2 * C * y, m = Math.hypot(gx, gy, 1);
  return { n: [gx / m, gy / m, 1 / m], d: (C * (x * x + y * y)) / m, anchor: [x, y, -C * (x * x + y * y)], ...meta };
}

/** Plane through three points, normal pointing up. */
function planeThrough(a, b, c, meta) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const length = Math.hypot(...n) || 1;
  n = n.map((value) => (value * (n[2] < 0 ? -1 : 1)) / length);
  const anchor = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
  return { n, d: n[0] * a[0] + n[1] * a[1] + n[2] * a[2], anchor, ...meta };
}

function circleTouchesPolygon(points, radius) {
  let positive = false, negative = false;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length], dx = b[0] - a[0], dy = b[1] - a[1];
    if (Math.hypot(a[0], a[1]) <= radius) return true;
    const t = Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / (dx * dx + dy * dy)));
    if (Math.hypot(a[0] + dx * t, a[1] + dy * t) <= radius) return true;
    const side = dx * -a[1] - dy * -a[0];
    positive ||= side > 0; negative ||= side < 0;
  }
  return !(positive && negative);
}

function radialPlanes(family, p) {
  const n = p.symmetry, planes = [tangentPlane(0, 0, { cell: "center", tier: "center" })];
  for (let j = 0; j < p.rings; j++) {
    const u = p.rings > 1 ? j / (p.rings - 1) : 1;
    const r = p.inner + (0.94 - p.inner) * Math.pow(u, p.spacing);
    let phase = 0;
    if (family === "rosette" || family === "split") phase = (j % 2) * Math.PI / n;
    if (family === "pinwheel") phase = j * p.twist * DEG;
    if (family === "twist") phase = p.twist * DEG * Math.log(r / p.inner) * 2;
    const offsets = family === "split" ? [-p.split * TAU / n, p.split * TAU / n] : [0];
    for (let k = 0; k < n; k++) for (let z = 0; z < offsets.length; z++) {
      const a = (TAU * k) / n + phase + offsets[z];
      planes.push(tangentPlane(r * Math.cos(a), r * Math.sin(a), { cell: `r${j}-s${k}-m${z}`, tier: `ring-${j + 1}` }));
      if (p.mirror && (family === "pinwheel" || family === "twist") && Math.abs(phase) > 1e-12) {
        const b = (TAU * k) / n - phase;
        planes.push(tangentPlane(r * Math.cos(b), r * Math.sin(b), { cell: `r${j}-s${k}-mirror`, tier: `ring-${j + 1}` }));
      }
    }
  }
  return planes;
}

function honeycombPlanes(p) {
  const a = 2 / p.density, planes = [];
  for (let j = -p.density * 2; j <= p.density * 2; j++) for (let i = -p.density * 2; i <= p.density * 2; i++) {
    const x = a * (i + j / 2) * p.stretch, y = (a * j * Math.sqrt(3)) / 2 / p.stretch;
    if (Math.hypot(x, y) > 1.2) continue;
    planes.push(tangentPlane(x, y, { cell: `cell-${i}-${j}`, tier: `ring-${Math.max(Math.abs(i), Math.abs(j), Math.abs(i + j)) + 1}` }));
  }
  return planes;
}

/** Sum of two convex piecewise linear functions: parallelogram cells at any crossing angle. */
function obliquePlanes(p) {
  const a = 2 / p.density, half = (p.crossAngle * DEG) / 2;
  const u = [Math.cos(half), Math.sin(half)], v = [Math.cos(half), -Math.sin(half)];
  const det = u[0] * v[1] - u[1] * v[0], planes = [];
  for (let i = -p.density; i <= p.density; i++) for (let j = -p.density; j <= p.density; j++) {
    const si = i * a, sj = j * a;
    const g = [2 * C * (si * u[0] + sj * v[0]), 2 * C * (si * u[1] + sj * v[1])];
    const norm = Math.hypot(g[0], g[1], 1), c = C * (si * si + sj * sj);
    const x = (si * v[1] - u[1] * sj) / det, y = (u[0] * sj - si * v[0]) / det;
    planes.push({ n: [g[0] / norm, g[1] / norm, 1 / norm], d: c / norm, anchor: [x, y, c - g[0] * x - g[1] * y], cell: `net-${i}-${j}`, tier: `ring-${Math.max(Math.abs(i), Math.abs(j)) + 1}` });
  }
  return planes;
}

/** Asanoha: lattice vertices, edge midpoints and a lifted centre give true triangular leaves. */
function asanohaPlanes(p) {
  const a = 2 / p.density, extent = Math.ceil(2 / a) + 2;
  const epsilon = p.lattice === "square" ? p.lift / 4 : p.lift / 12;
  const vertex = (x, y, lift = 0) => [x, y, -C * (x * x + y * y) + lift * C * a * a];
  const planes = [];
  const emit = (v, cell, ring) => {
    if (!circleTouchesPolygon(v, 1.03)) return;
    planes.push(planeThrough(v[0], v[1], v[2], { cell, tier: `ring-${ring}` }));
  };
  const leaves = (corners, centre, key, ring) => {
    for (let k = 0; k < corners.length; k++) {
      const va = corners[k], vb = corners[(k + 1) % corners.length];
      const m = vertex((va[0] + vb[0]) / 2, (va[1] + vb[1]) / 2);
      emit([va, m, centre], `${key}:${k}:a`, ring);
      emit([m, vb, centre], `${key}:${k}:b`, ring);
    }
  };
  if (p.lattice === "square") {
    for (let j = -extent; j <= extent; j++) for (let i = -extent; i <= extent; i++) {
      const corners = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]].map(([x, y]) => vertex(x * a, y * a));
      leaves(corners, vertex((i + 0.5) * a, (j + 0.5) * a, epsilon), `${i}:${j}`, Math.max(Math.abs(i + 0.5), Math.abs(j + 0.5)) + 0.5);
    }
  } else {
    const grid = (i, j) => [a * (i + j / 2), (a * Math.sqrt(3) * j) / 2];
    for (let j = -extent; j <= extent; j++) for (let i = -extent; i <= extent; i++) for (let flip = 0; flip < 2; flip++) {
      const raw = flip ? [grid(i + 1, j + 1), grid(i, j + 1), grid(i + 1, j)] : [grid(i, j), grid(i + 1, j), grid(i, j + 1)];
      const corners = raw.map(([x, y]) => vertex(x, y));
      const centre = vertex(raw.reduce((s, q) => s + q[0], 0) / 3, raw.reduce((s, q) => s + q[1], 0) / 3, epsilon);
      leaves(corners, centre, `${i}:${j}:${flip}`, Math.round(Math.hypot(centre[0], centre[1]) / a) + 1);
    }
  }
  return planes;
}

/** Rational two-frequency closed curve (hypotrochoid family), sampled symmetrically. */
function spiroPlanes(p) {
  const g = gcd(p.lobes, p.turns), P = p.lobes / g, Q = p.turns / g;
  const count = P * p.samples, A = 1 - p.amplitude, B = p.amplitude, planes = [];
  for (let i = 0; i < count; i++) {
    const t = (TAU * i) / count;
    const x = 0.94 * (A * Math.cos(Q * t) + B * Math.cos((P - Q) * t));
    const y = 0.94 * (A * Math.sin(Q * t) - B * Math.sin((P - Q) * t));
    planes.push(tangentPlane(x, y, { cell: `sample-${i}`, tier: `sample-${i % p.samples}` }));
  }
  return planes;
}

/** Parallel bars: tangent planes along one diameter. Two tools at different rotations give opposed bars. */
function barPlanes(p) {
  const count = p.density * 2 + 1, planes = [];
  for (let k = 0; k < count; k++) {
    const r = -0.94 + (k * 1.88) / (count - 1);
    planes.push(tangentPlane(r, 0, { cell: `bar-${k}`, tier: `bar-${Math.abs(k - p.density) + 1}` }));
  }
  return planes;
}

/** Penrose / pentagrid rhombi by convex conjugacy (de Bruijn five-grid). */
function pentagridPlanes(p) {
  const edge = 0.5 / p.density, offset = p.offset, extent = Math.ceil(2 / edge) + 3;
  const u = Array.from({ length: 5 }, (_, i) => [Math.cos((TAU * i) / 5), Math.sin((TAU * i) / 5)]);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
  // alpha follows the research lab at a 45° reference angle (unit slope).
  const alpha = 5 * edge * edge * 0.5;
  const f0 = 5 * (extent * -offset - ((-extent + (-extent + extent - 1)) * extent) / 2);
  const planes = [];
  for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) {
    const det = u[i][0] * u[j][1] - u[i][1] * u[j][0];
    for (let k = -extent; k <= extent; k++) for (let l = -extent; l <= extent; l++) {
      const a = k + offset, b = l + offset;
      const x = [(a * u[j][1] - b * u[i][1]) / det, (u[i][0] * b - u[j][0] * a) / det];
      let f = 0, g = [0, 0], thirdGap = Infinity;
      for (let m = 0; m < 5; m++) {
        const s = dot(u[m], x) - offset;
        let count;
        if (m === i) count = k + extent;
        else if (m === j) count = l + extent;
        else {
          thirdGap = Math.min(thirdGap, Math.abs(s - Math.round(s)));
          count = Math.max(0, Math.min(2 * extent + 1, Math.ceil(s - 1e-10) + extent));
        }
        f += count * s - ((-extent + (-extent + count - 1)) * count) / 2;
        g = [g[0] + u[m][0] * count, g[1] + u[m][1] * count];
      }
      const dual = [g, [g[0] + u[i][0], g[1] + u[i][1]], [g[0] + u[i][0] + u[j][0], g[1] + u[i][1] + u[j][1]], [g[0] + u[j][0], g[1] + u[j][1]]];
      const xy = dual.map((v) => [v[0] * edge, v[1] * edge]);
      if (!circleTouchesPolygon(xy, 1.04)) continue;
      if (thirdGap < 1e-8) throw new RangeError("该内部相位产生三线交点，请改选另一个相位。");
      const q = f - f0, gradient = [(x[0] * alpha) / edge, (x[1] * alpha) / edge];
      const norm = Math.hypot(gradient[0], gradient[1], 1);
      const corners = dual.map((v) => [v[0] * edge, v[1] * edge, -alpha * (dot(x, v) - q)]);
      const anchor = corners.reduce((s, c) => [s[0] + c[0] / 4, s[1] + c[1] / 4, s[2] + c[2] / 4], [0, 0, 0]);
      const thin = Math.abs(dot(u[i], u[j])) > 0.5;
      planes.push({ n: [gradient[0] / norm, gradient[1] / norm, 1 / norm], d: (alpha * q) / norm, anchor, cell: `${i}-${j}:${k}-${l}`, tier: thin ? "thin" : "thick" });
    }
  }
  return planes;
}

/** Cocircular quads lifted onto the dome: two families of logarithmic-spiral edges, every quad planar. */
function arcWeavePlanes(p) {
  const n = p.symmetry, rows = p.rows;
  const alpha = Math.PI / n, delta = Math.max(-0.7, Math.min(0.7, p.shear)) * alpha;
  const qHalf = Math.cos(delta) / Math.cos(alpha), ratio = qHalf + Math.sqrt(qHalf * qHalf - 1);
  const r = (j) => 1.06 * Math.pow(ratio, j - rows);
  const point = (j, k) => {
    const rr = r(j), a = (TAU * k) / n + j * (alpha + delta);
    return [rr * Math.cos(a), rr * Math.sin(a), -C * rr * rr];
  };
  const planes = [];
  for (let m = 1; m <= rows; m++) for (let k = 0; k < n; k++) {
    const quad = [point(m - 1, k), point(m, k), point(m + 1, k - 1), point(m, k - 1)];
    const plane = planeThrough(quad[0], quad[1], quad[2], { cell: `diamond-${m}-${k}`, tier: `row-${m}` });
    plane.anchor = quad.reduce((s, c) => [s[0] + c[0] / 4, s[1] + c[1] / 4, s[2] + c[2] / 4], [0, 0, 0]);
    planes.push(plane);
  }
  for (let k = 0; k < n; k++) planes.push(planeThrough(point(0, k), point(1, k), point(0, k + 1), { cell: `inner-${k}`, tier: "row-0" }));
  planes.push({ n: [0, 0, 1], d: -C * r(0) * r(0), anchor: [0, 0, -C * r(0) * r(0)], cell: "center", tier: "center" });
  return planes;
}

/** Most arc-weave rows that keep the inner ring at least 0.03 of the rim radius. */
export function arcWeaveRowLimit(symmetry, shear = 0) {
  const b = Math.PI / symmetry, a = Math.cos(b * shear) / Math.cos(b), ratio = a + Math.sqrt(Math.max(0, a * a - 1));
  return Math.min(32, Math.floor(Math.log(1.06 / 0.03) / Math.log(ratio)));
}

export const FANCY_FAMILIES = Object.freeze([
  "rosette", "pinwheel", "split", "twist", "honeycomb", "oblique", "asanoha", "spiro", "bars", "pentagrid", "arcweave",
]);

/** Tool-frame planes of a fancy family at unit edge slope; `p` is normalised by the registry. */
export function fancyToolPlanes(family, p) {
  if (["rosette", "pinwheel", "split", "twist"].includes(family)) return radialPlanes(family, p);
  if (family === "honeycomb") return honeycombPlanes(p);
  if (family === "oblique") return obliquePlanes(p);
  if (family === "asanoha") return asanohaPlanes(p);
  if (family === "spiro") return spiroPlanes(p);
  if (family === "bars") return barPlanes(p);
  if (family === "pentagrid") return pentagridPlanes(p);
  if (family === "arcweave") return arcWeavePlanes(p);
  throw new RangeError(`未知花式刀具：${family}`);
}
