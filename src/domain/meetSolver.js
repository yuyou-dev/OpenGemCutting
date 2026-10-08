/*
 * Exact multi-face meets on whole teeth, shared by grid cuts and composite
 * tools.
 *
 * A tool is a set of planes z = c - m (cos φ x + sin φ y) whose lower envelope
 * is the cutting surface (material stays below every plane). Rounding each
 * azimuth φ to a whole tooth moves the planes slightly, so four or more faces
 * that met in one point split into short edges (three planes always meet).
 *
 * `envelopeMeets` finds the points of the ideal tool where four or more planes
 * meet; `solveMeets` keeps the rounded azimuths and solves the tilt m and
 * height c of every plane group (a symmetry orbit shares one pair) together
 * with the position of every meet point until each plane passes through its
 * points again. The meet equations z - c + m·u = 0 are homogeneous in
 * (m, c, z): a tool solved at unit slope serves every slope by scaling.
 *
 * Pure geometry, no imports.
 */

const invert3 = (a) => {
  const c00 = a[4] * a[8] - a[5] * a[7], c01 = a[5] * a[6] - a[3] * a[8], c02 = a[3] * a[7] - a[4] * a[6];
  const det = a[0] * c00 + a[1] * c01 + a[2] * c02;
  return Float64Array.of(
    c00 / det, (a[2] * a[7] - a[1] * a[8]) / det, (a[1] * a[5] - a[2] * a[4]) / det,
    c01 / det, (a[0] * a[8] - a[2] * a[6]) / det, (a[2] * a[3] - a[0] * a[5]) / det,
    c02 / det, (a[1] * a[6] - a[0] * a[7]) / det, (a[0] * a[4] - a[1] * a[3]) / det);
};
const times3 = (m, v) => Float64Array.of(m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]);
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Dense solve of the n×n row-major system A x = b (partial pivoting); A and b are overwritten. */
function solveFlat(A, b, n) {
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r * n + c]) > Math.abs(A[p * n + c])) p = r;
    if (p !== c) {
      for (let k = 0; k < n; k++) { const t = A[c * n + k]; A[c * n + k] = A[p * n + k]; A[p * n + k] = t; }
      const t = b[c]; b[c] = b[p]; b[p] = t;
    }
    const pivot = A[c * n + c];
    if (Math.abs(pivot) < 1e-300) continue;
    // Row c is zero beyond `end`: a banded (well ordered) system eliminates in O(n · band²).
    let end = n - 1;
    while (end > c && A[c * n + end] === 0) end--;
    for (let r = c + 1; r < n; r++) {
      const f = A[r * n + c] / pivot;
      if (!f) continue;
      for (let k = c; k <= end; k++) A[r * n + k] -= f * A[c * n + k];
      b[r] -= f * b[c];
    }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let sum = b[r];
    for (let k = r + 1; k < n; k++) sum -= A[r * n + k] * x[k];
    x[r] = Math.abs(A[r * n + r]) < 1e-300 ? 0 : sum / A[r * n + r];
  }
  return x;
}

/**
 * Joint solve of plane groups and meet points.
 *
 * - `groups`: [{ m, c, fixedSlope }] start values; a group with `fixedSlope`
 *   (a flat table, m = 0, or a pinned main angle) solves only its height.
 * - `planes`: [{ group, cos, sin }] with the whole-tooth azimuth of each plane.
 * - `points`: [{ xyz: [x, y, z], planes: [plane ids] }] the meets, at their ideal place.
 * - `scale`: tool radius; iteration stops once every residual is below 1e-15 · scale.
 *
 * Levenberg-Marquardt from the start values (which keeps the result close to
 * them). Each meet point's (x, y, z) appears only in its own residuals, so it is
 * eliminated per point (a 3×3 Schur complement) and only the group parameters
 * form a dense system: O(points + params³) per step instead of
 * O((params + 3·points)³). Damping each step (not pulling towards the start)
 * keeps every 3×3 block well conditioned even where a point's planes share a
 * direction, and lets the steps, and with them the residuals, go to zero.
 *
 * Returns the solved groups, points, the worst residual (same units as z), the
 * largest horizontal move of a point and the iteration count.
 */
export function solveMeets({ groups, planes, points, scale = 1, damping = 1e-6, maxIterations = 80, reorder = false }) {
  const slot = new Array(groups.length);
  let P = 0;
  for (const o of reorder ? bandOrder(groups.length, points, planes) : groups.keys()) { slot[o] = P; P += groups[o].fixedSlope ? 1 : 2; }
  const param = new Float64Array(P);
  groups.forEach((group, o) => { if (group.fixedSlope) param[slot[o]] = group.c; else { param[slot[o]] = group.m; param[slot[o] + 1] = group.c; } });
  const points3 = points.map((pt) => Float64Array.of(pt.xyz[0], pt.xyz[1], pt.xyz[2]));
  const planeOf = (o) => (groups[o].fixedSlope ? [groups[o].m, param[slot[o]]] : [param[slot[o]], param[slot[o] + 1]]);
  const residual = (pi, ci) => {
    const plane = planes[ci], [m, c] = planeOf(plane.group), p = points3[pi];
    return p[2] - c + m * (plane.cos * p[0] + plane.sin * p[1]);
  };
  const worst = () => Math.max(0, ...points.flatMap((pt, pi) => pt.planes.map((ci) => Math.abs(residual(pi, ci)))));
  let iterations = 0;
  for (; iterations < maxIterations && points.length && worst() > 1e-15 * scale; iterations++) {
    const S = new Float64Array(P * P), rhs = new Float64Array(P);
    for (let q = 0; q < P; q++) S[q * P + q] += damping;
    const eliminated = points.map((pt, pi) => {
      const p = points3[pi], A = new Float64Array(9), gx = new Float64Array(3), B = new Map();
      for (let d = 0; d < 3; d++) A[d * 4] += damping;
      for (const ci of pt.planes) {
        const plane = planes[ci], o = plane.group, [m] = planeOf(o), u = plane.cos * p[0] + plane.sin * p[1], r = residual(pi, ci);
        const a = [m * plane.cos, m * plane.sin, 1];
        const b = groups[o].fixedSlope ? [[slot[o], -1]] : [[slot[o], u], [slot[o] + 1, -1]];
        for (let i = 0; i < 3; i++) { gx[i] += a[i] * r; for (let j = 0; j < 3; j++) A[i * 3 + j] += a[i] * a[j]; }
        for (const [col, v] of b) {
          rhs[col] += v * r;
          for (const [other, w] of b) S[col * P + other] += v * w;
          if (!B.has(col)) B.set(col, new Float64Array(3));
          const row = B.get(col);
          for (let i = 0; i < 3; i++) row[i] += v * a[i];
        }
      }
      const Ainv = invert3(A), Ag = times3(Ainv, gx), cols = [...B.keys()];
      const BA = cols.map((col) => times3(Ainv, B.get(col)));
      cols.forEach((c1, i) => {
        rhs[c1] -= dot3(B.get(c1), Ag);
        for (const c2 of cols) S[c1 * P + c2] -= dot3(BA[i], B.get(c2));
      });
      return { Ainv, B, gx };
    });
    for (let q = 0; q < P; q++) rhs[q] = -rhs[q];
    const dp = solveFlat(S, rhs, P);
    for (let q = 0; q < P; q++) param[q] += dp[q];
    eliminated.forEach(({ Ainv, B, gx }, pi) => {
      const t = Float64Array.from(gx);
      for (const [col, row] of B) for (let i = 0; i < 3; i++) t[i] += row[i] * dp[col];
      const dx = times3(Ainv, t);
      for (let i = 0; i < 3; i++) points3[pi][i] -= dx[i];
    });
  }
  return {
    groups: groups.map((_, o) => { const [m, c] = planeOf(o); return { m, c }; }),
    points: points3,
    residual: worst(),
    maxShift: Math.max(0, ...points.map((pt, pi) => Math.hypot(points3[pi][0] - pt.xyz[0], points3[pi][1] - pt.xyz[1]))),
    iterations,
  };
}

/**
 * Reverse Cuthill-McKee order of the groups (neighbours share a meet point), so
 * the dense solve stays banded: neighbouring facets get neighbouring columns.
 */
function bandOrder(count, points, planes) {
  const neighbours = Array.from({ length: count }, () => new Set());
  for (const point of points) {
    const ids = [...new Set(point.planes.map((ci) => planes[ci].group))];
    for (const a of ids) for (const b of ids) if (a !== b) neighbours[a].add(b);
  }
  const degree = neighbours.map((set) => set.size), order = [], seen = new Uint8Array(count);
  const starts = Array.from({ length: count }, (_, o) => o).sort((a, b) => degree[a] - degree[b]);
  for (const start of starts) {
    if (seen[start]) continue;
    seen[start] = 1;
    for (let head = order.push(start) - 1; head < order.length; head++) {
      for (const next of [...neighbours[order[head]]].sort((a, b) => degree[a] - degree[b])) {
        if (!seen[next]) { seen[next] = 1; order.push(next); }
      }
    }
  }
  return order.reverse();
}

/** Clip a convex polygon (flat [x0, y0, x1, y1, …]) to a·p <= b. */
function clip(poly, ax, ay, b) {
  const out = [], n = poly.length / 2;
  for (let i = 0; i < n; i++) {
    const x0 = poly[2 * i], y0 = poly[2 * i + 1], j = (i + 1) % n, x1 = poly[2 * j], y1 = poly[2 * j + 1];
    const s0 = ax * x0 + ay * y0 - b, s1 = ax * x1 + ay * y1 - b;
    if (s0 <= 0) out.push(x0, y0);
    if ((s0 < 0 && s1 > 0) || (s0 > 0 && s1 < 0)) {
      const t = s0 / (s0 - s1);
      out.push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
    }
  }
  return out;
}

/**
 * The cell of every plane on the lower envelope inside the square |x|, |y| <= bound:
 * where plane i is lowest, c_i - g_i·p <= c_j - g_j·p, i.e. (g_j - g_i)·p <= c_j - c_i.
 * `planes`: [{ g: [gx, gy], c }]. Returns flat polygons (empty when the plane never shows).
 */
export function envelopeCells(planes, { bound = 1 } = {}) {
  const n = planes.length, gx = new Float64Array(n), gy = new Float64Array(n), c = new Float64Array(n);
  planes.forEach((plane, i) => { gx[i] = plane.g[0]; gy[i] = plane.g[1]; c[i] = plane.c; });
  // Planes with close gradients have neighbouring cells (for dome tools the gradient
  // follows the position). Visiting the others outwards along a Morton (Z-order) curve
  // of the gradients clips each cell by its neighbours first; a bounding circle then
  // skips every far plane in O(1).
  let minX = Infinity, minY = Infinity, span = 0;
  for (let i = 0; i < n; i++) { minX = Math.min(minX, gx[i]); minY = Math.min(minY, gy[i]); }
  for (let i = 0; i < n; i++) span = Math.max(span, gx[i] - minX, gy[i] - minY);
  const spread = (v) => {
    let x = Math.min(65535, Math.max(0, Math.round(v)));
    x = (x | (x << 8)) & 0x00ff00ff; x = (x | (x << 4)) & 0x0f0f0f0f; x = (x | (x << 2)) & 0x33333333; x = (x | (x << 1)) & 0x55555555;
    return x >>> 0;
  };
  const morton = new Float64Array(n);
  for (let i = 0; i < n; i++) morton[i] = spread(((gx[i] - minX) / (span || 1)) * 65535) * 2 + spread(((gy[i] - minY) / (span || 1)) * 65535);
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => morton[a] - morton[b]);
  const rank = new Int32Array(n);
  order.forEach((plane, k) => { rank[plane] = k; });
  return planes.map((_, i) => {
    let poly = [-bound, -bound, bound, -bound, bound, bound, -bound, bound];
    let cx = 0, cy = 0, radius = bound * Math.SQRT2;
    const visit = (j) => {
      const ax = gx[j] - gx[i], ay = gy[j] - gy[i], b = c[j] - c[i], length = Math.hypot(ax, ay);
      // The same plane twice (to rounding): both keep the cell.
      if (length < 1e-12) { if (b < -1e-12) poly = []; return; }
      if (ax * cx + ay * cy + length * radius <= b) return;
      let outside = false;
      for (let v = 0; v < poly.length && !outside; v += 2) outside = ax * poly[v] + ay * poly[v + 1] > b;
      if (!outside) return;
      poly = clip(poly, ax, ay, b);
      const k = poly.length / 2;
      if (!k) return;
      cx = 0; cy = 0;
      for (let v = 0; v < k; v++) { cx += poly[2 * v] / k; cy += poly[2 * v + 1] / k; }
      radius = 0;
      for (let v = 0; v < k; v++) radius = Math.max(radius, Math.hypot(poly[2 * v] - cx, poly[2 * v + 1] - cy));
    };
    for (let step = 1; step < n && poly.length; step++) {
      const lo = rank[i] - step, hi = rank[i] + step;
      if (lo < 0 && hi >= n) break;
      if (lo >= 0) visit(order[lo]);
      if (hi < n && poly.length) visit(order[hi]);
    }
    return poly;
  });
}

/**
 * Points of the lower envelope strictly inside `radius` where at least
 * `minPlanes` planes are active (height within `tolerance` of the lowest).
 * Returns [{ xy, z, planes }] with plane ids in ascending order. `cells` may
 * pass envelopeCells(planes, { bound: radius * 1.001 }) computed once.
 */
export function envelopeMeets(planes, { radius = 1, tolerance = 1e-9, minPlanes = 4, cells = envelopeCells(planes, { bound: radius * 1.001 }) } = {}) {
  const height = (i, x, y) => planes[i].c - planes[i].g[0] * x - planes[i].g[1] * y;
  const grid = 1e-6, buckets = new Map(), clusters = [];
  const keyOf = (x, y) => `${Math.round(x / grid)}:${Math.round(y / grid)}`;
  cells.forEach((poly, i) => {
    for (let q = 0; q < poly.length; q += 2) {
      const x = poly[q], y = poly[q + 1];
      if (Math.hypot(x, y) >= radius * (1 - 1e-9)) continue;
      const kx = Math.round(x / grid), ky = Math.round(y / grid);
      let cluster = null;
      for (let dx = -1; dx <= 1 && !cluster; dx++) for (let dy = -1; dy <= 1 && !cluster; dy++) {
        cluster = (buckets.get(`${kx + dx}:${ky + dy}`) ?? []).find((other) => Math.hypot(other.xy[0] - x, other.xy[1] - y) < grid) ?? null;
      }
      if (!cluster) {
        cluster = { xy: [x, y], candidates: new Set() };
        clusters.push(cluster);
        const key = keyOf(x, y);
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(cluster);
      }
      cluster.candidates.add(i);
    }
  });
  const meets = [];
  for (const cluster of clusters) {
    if (cluster.candidates.size < minPlanes) continue;
    const [x, y] = cluster.xy, ids = [...cluster.candidates];
    const z = Math.min(...ids.map((i) => height(i, x, y)));
    const active = ids.filter((i) => height(i, x, y) - z <= tolerance).sort((a, b) => a - b);
    if (active.length >= minPlanes) meets.push({ xy: [x, y], z, planes: active });
  }
  return meets;
}

/**
 * Top-view length of the shortest edge of the lower envelope with both ends
 * strictly inside `radius` (Infinity when there is none); in top view it does
 * not depend on the slope. Edges shorter than `floor` are the same vertex seen
 * from two cells and are skipped.
 */
export function envelopeShortestEdge(planes, { radius = 1, floor = 1e-9, cells = envelopeCells(planes, { bound: radius * 1.001 }) } = {}) {
  let shortest = Infinity;
  cells.forEach((poly) => {
    const n = poly.length / 2;
    for (let q = 0; q < n; q++) {
      const x0 = poly[2 * q], y0 = poly[2 * q + 1], x1 = poly[2 * ((q + 1) % n)], y1 = poly[2 * ((q + 1) % n) + 1];
      if (Math.hypot(x0, y0) >= radius * (1 - 1e-9) || Math.hypot(x1, y1) >= radius * (1 - 1e-9)) continue;
      const length = Math.hypot(x1 - x0, y1 - y0);
      if (length > floor) shortest = Math.min(shortest, length);
    }
  });
  return shortest;
}
