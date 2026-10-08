/*
 * Tier tools: concentric tiers of facets around the axis (brilliant, step,
 * staggered rings, radial mains, scissor rhythm, keel line, rose dome).
 *
 * Ported from the OpenGemCutting Preset Studio (MIT; module 0.5.0-rc.9,
 * source commit 3db1e1f, src/domain/generators.js). The lab built crown and
 * pavilion components separately; the construction itself only differed by
 * the sign of Z. Here every tool is built once, in the tool frame:
 *
 *   axis +Z points away from the girdle, the rim (girdle interface) is the
 *   circle r = 1 at z = 0, and a plane keeps n · x <= d.
 *
 * The host places the tool on the crown or the pavilion. What used to be
 * crown-only or pavilion-only is a construction choice (`style`, `inner`),
 * not a region: a "lower halves" brilliant can cut a crown and a star crown
 * can cut a pavilion with a culet table. The lab's checker family is not
 * ported; the host grid cut (square lattice with exact meets) replaces it.
 */

const rad = (value) => (value * Math.PI) / 180;
const deg = (value) => (value * 180) / Math.PI;

/** A facet at inclination `angle` (deg) through radius `r`, height `z`, in direction `theta` (deg). */
function ringPlane(angle, theta, r, z, meta) {
  const a = rad(angle), t = rad(theta);
  return {
    n: [Math.sin(a) * Math.cos(t), Math.sin(a) * Math.sin(t), Math.cos(a)],
    d: Math.sin(a) * r + Math.cos(a) * z,
    anchor: [r * Math.cos(t), r * Math.sin(t), z],
    ...meta,
  };
}

function terminalPlane(z, meta) {
  return { n: [0, 0, 1], d: z, anchor: [0, 0, z], ...meta };
}

/** Tier width rhythm: even, wide outer tiers or wide inner tiers. */
export function rhythmWidths(layers, rhythm) {
  return Array.from({ length: layers }, (_, i) => (rhythm === "outer"
    ? 1.8 - (i / Math.max(1, layers - 1)) * 1.2
    : rhythm === "inner" ? 0.6 + (i / Math.max(1, layers - 1)) * 1.2 : 1));
}

function brilliantPlanes(p) {
  const N = p.symmetry, step = 360 / N, tan = Math.tan(rad(p.angle));
  const half = Math.cos(Math.PI / N), quarter = Math.cos(Math.PI / (2 * N));
  const planes = [];
  for (let i = 0; i < N; i++) planes.push(ringPlane(p.angle, i * step, 1, 0, { cell: `main-${i}`, tier: "main" }));
  if (p.style === "lower") {
    // Lower halves (the lab's pavilion construction): 2N facets from the rim to r = 1 - lower.
    const r = 1 - p.lower, z = tan * (1 - r * half), a = deg(Math.atan2(z, quarter * (1 - r)));
    for (let i = 0; i < 2 * N; i++) planes.push(ringPlane(a, ((i + 0.5) * step) / 2, quarter, 0, { cell: `lower-${i}`, tier: "lower" }));
    if (p.inner > 0) planes.push(terminalPlane(tan * (1 - p.inner), { cell: "terminal", tier: "terminal" }));
    return planes;
  }
  // Star and upper halves (the lab's crown construction), meeting analytically.
  const table = Math.max(p.inner, 0.06);
  const h = (1 - table) * tan, rs = table / half + (1 - table / half) * p.star, zs = tan * (1 - rs * half);
  if (rs >= 1 || zs <= 0) throw new RangeError("台面过大，星面交点无法形成；请减小台面开合。");
  const star = deg(Math.atan2(h - zs, rs - table * half)), upper = deg(Math.atan2(zs, quarter * (1 - rs)));
  if (star <= 0 || upper >= 89.5) throw new RangeError("星面或上腰面退化，请调整星面舒展或主面角。");
  for (let i = 0; i < N; i++) {
    planes.push(ringPlane(star, (i + 0.5) * step, rs, zs, { cell: `star-${i}`, tier: "star" }));
    for (const q of [0.25, 0.75]) planes.push(ringPlane(upper, (i + q) * step, quarter, 0, { cell: `upper-${i * 2 + (q === 0.75 ? 1 : 0)}`, tier: "upper" }));
  }
  planes.push(terminalPlane(h, { cell: "terminal", tier: "terminal" }));
  return planes;
}

function tieredPlanes(p, family) {
  const N = p.symmetry, step = 360 / N;
  const layers = family === "fan" ? 1 : p.layers;
  const widths = p.tierWidths ?? rhythmWidths(layers, p.rhythm);
  const total = widths.reduce((sum, width) => sum + width, 0);
  const planes = [];
  let r = 1, z = 0, accumulated = 0;
  for (let l = 0; l < layers; l++) {
    const angle = p.angle + (layers === 1 ? 0 : p.spread * (0.5 - l / (layers - 1)));
    if (angle < 2 || angle > 87) throw new RangeError("逐层角度超出 2°–87°，请减小层间角差。");
    accumulated += widths[l];
    const next = 1 - ((1 - p.inner) * accumulated) / total;
    const phase = (family === "stagger" ? (l % 2) * p.twist * step : 0) + (p.tierPhases?.[l] ?? 0);
    const shifts = family === "scissor" ? [-p.twist * 0.18 * step, p.twist * 0.18 * step] : [phase];
    for (let i = 0; i < N; i++) for (let q = 0; q < shifts.length; q++) {
      const theta = i * step + shifts[q];
      const outline = p.outline === "emerald" ? (Math.abs(Math.sin(rad(2 * theta))) > 0.7 ? (2 - p.bevel) / Math.SQRT2 : 1) : 1;
      const tierAngle = family === "keel" ? deg(Math.atan(Math.tan(rad(angle)) / outline)) : angle;
      const radius = (family === "keel" ? p.keel * Math.abs(Math.cos(rad(theta))) : 0) + r * outline;
      planes.push(ringPlane(tierAngle, theta, radius, z, { cell: `t${l + 1}-${i * shifts.length + q}`, tier: `tier-${l + 1}` }));
    }
    z += (r - next) * Math.tan(rad(angle));
    r = next;
  }
  if (p.inner > 0) planes.push(terminalPlane(z, { cell: "terminal", tier: "terminal" }));
  return planes;
}

/** Upward support planes of the upper hull over staggered rings of points on z = h (1 - r²). */
function rosePlanes(p) {
  if (p.symmetry * p.layers > 96) throw new RangeError("玫瑰冠限制：对称数 × 层数 ≤ 96。");
  // The edge slope of the parabolic dome at the rim is 2h, i.e. tan(edge angle).
  const h = Math.tan(rad(p.angle)) / 2;
  const points = [[0, 0, h]];
  for (let l = 0; l < p.layers; l++) {
    const r = 1 - l / p.layers, z = h * (1 - r * r);
    for (let i = 0; i < p.symmetry; i++) {
      const a = (2 * Math.PI * (i + (l % 2) * 0.5)) / p.symmetry;
      points.push([r * Math.cos(a), r * Math.sin(a), z]);
    }
  }
  const planes = [], keys = new Set();
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) for (let k = j + 1; k < points.length; k++) {
    const [a, b, c] = [points[i], points[j], points[k]];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const length = Math.hypot(...n);
    if (length < 1e-9 || Math.abs(n[2]) < 1e-9) continue;
    n = n.map((value) => (value * (n[2] < 0 ? -1 : 1)) / length);
    const d = n[0] * a[0] + n[1] * a[1] + n[2] * a[2];
    if (points.some((q) => n[0] * q[0] + n[1] * q[1] + n[2] * q[2] > d + 1e-8)) continue;
    const key = [...n, d].map((value) => Math.round(value * 1e7)).join(",");
    if (keys.has(key)) continue;
    keys.add(key);
    const centroid = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    planes.push({ n, d, anchor: centroid, cell: `rose-${planes.length}`, tier: "rose" });
  }
  // Rim at z = 0 like every other tier tool.
  return planes;
}

export const TIER_FAMILIES = Object.freeze(["brilliant", "step", "stagger", "fan", "scissor", "keel", "rose"]);

/**
 * Tool-frame planes of a tier family. `p` is already normalised by the
 * registry: symmetry, layers, angle (main tier, degrees), spread, inner
 * (terminal radius: table or culet, 0 = none), star, lower, twist, keel,
 * bevel, outline, rhythm, style.
 */
export function tierToolPlanes(family, p) {
  if (family === "brilliant") return brilliantPlanes(p);
  if (family === "rose") return rosePlanes(p);
  if (["step", "stagger", "fan", "scissor", "keel"].includes(family)) return tieredPlanes(p, family);
  throw new RangeError(`未知圈层刀具：${family}`);
}
