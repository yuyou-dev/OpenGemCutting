/*
 * Grid cuts ("row / face" cuts): one tool covers the crown with a lattice of
 * facets. Every facet sits on a whole tooth of the wheel and every lattice
 * point inside the tool is a true meet of all the facets around it.
 *
 * Construction
 * 1. The tool is a convex dome z = apex - k (x² + y²); `edgeAngle` is the facet
 *    angle where the dome reaches `extent` (a fraction of the cutting reference's
 *    radius). A tangent plane of this dome at a point p is lowest exactly on the
 *    Voronoi cell of p among the chosen points, so choosing the tangent points
 *    chooses the cell pattern:
 *    - square: points on a rectangular grid give rectangular cells, four faces at
 *      each corner (symmetry 1, 2, 4);
 *    - hex: points on a triangular lattice give a honeycomb, three faces at each
 *      corner (symmetry 3, 6);
 *    - tri: triangle centroids give triangular cells, six faces at each corner
 *      (symmetry 3, 6).
 * 2. Wheel: each symmetry orbit's azimuth is rounded to a whole tooth once and
 *    mapped exactly to the other members (mirror axes lie on whole teeth).
 * 3. Meets: rounding moves the planes slightly, so four or six faces no longer
 *    meet in one point. The tilt and height of every orbit and the position of
 *    every interior lattice point are solved together (`solveMeets` in
 *    meetSolver.js, shared with composite tools: damped Levenberg-Marquardt
 *    from the ideal tool) until every face passes through its points.
 *    Three faces always meet, so a honeycomb needs no solve.
 *
 * The whole tool moves rigidly: rotation by whole teeth and depth along the
 * axis keep every meet, and the meet equations are homogeneous in the slope,
 * so the shape is solved once at unit slope and cached without edge angle,
 * depth or rotation.
 *
 * Pure geometry: no faceting import (faceting validates grid metadata).
 */

import { solveMeets } from "./meetSolver.js";

export const GRID_CUT_VERSION = 1;
export const GRID_SYMMETRIES = Object.freeze([1, 2, 3, 4, 6]);
export const GRID_LATTICES = Object.freeze({ square: [1, 2, 4], hex: [3, 6], tri: [3, 6] });
export const GRID_CUT_LIMITS = Object.freeze({
  columns: Object.freeze([1, 12]),
  rows: Object.freeze([1, 12]),
  rings: Object.freeze([1, 6]),
  extent: Object.freeze([0.2, 1.2]),
  edgeAngle: Object.freeze([1, 70]),
});
/** Tool shape. Edge angle, depth and rotation travel with the CUT draft (angle, depth, index). */
export const DEFAULT_GRID_CUT = Object.freeze({
  symmetry: 4, mirror: true, lattice: "square", columns: 6, rows: 6, rings: 3,
  scope: "face", row: 0, rowCopies: true, extent: 0.8,
});
export const DEFAULT_GRID_EDGE_ANGLE = 36;
export const DEFAULT_GRID_DEPTH = 0.5;

const rad = (deg) => (deg * Math.PI) / 180;
const deg = (value) => (value * 180) / Math.PI;
const mod = (value, teeth) => {
  const result = ((value % teeth) + teeth) % teeth;
  return Math.abs(result - teeth) < 1e-9 ? 0 : result;
};
const within = (value, [min, max]) => Number.isFinite(value) && value >= min && value <= max;
const rotate = ([x, y], angle) => [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle)];

/** Wheels that can hold a symmetry (and its mirror axes) on whole teeth. */
export function gridSymmetryAvailable(symmetry, indexTeeth = 96, mirror = true) {
  return indexTeeth % symmetry === 0 && (!mirror || indexTeeth % (2 * symmetry) === 0);
}

export function isGridCutParameters(value) {
  if (!value || typeof value !== "object") return false;
  const { symmetry, mirror, lattice, columns, rows, rings, scope, row, rowCopies, extent } = value;
  return GRID_SYMMETRIES.includes(symmetry) && typeof mirror === "boolean"
    && (GRID_LATTICES[lattice] ?? []).includes(symmetry)
    && Number.isInteger(columns) && within(columns, GRID_CUT_LIMITS.columns)
    && Number.isInteger(rows) && within(rows, GRID_CUT_LIMITS.rows)
    && Number.isInteger(rings) && within(rings, GRID_CUT_LIMITS.rings)
    && ["face", "row"].includes(scope) && Number.isInteger(row) && row >= 0 && typeof rowCopies === "boolean"
    && within(extent, GRID_CUT_LIMITS.extent);
}

/** Complete, valid tool parameters, or a RangeError the designer can act on. */
export function normalizeGridCut(grid = {}, indexTeeth = 96) {
  const g = { ...DEFAULT_GRID_CUT, ...grid };
  if (!(GRID_LATTICES[g.lattice] ?? []).includes(g.symmetry)) g.lattice = g.symmetry === 3 || g.symmetry === 6 ? "hex" : "square";
  if (g.symmetry === 4) g.rows = g.columns;
  const normalized = {
    symmetry: g.symmetry, mirror: Boolean(g.mirror), lattice: g.lattice, columns: g.columns, rows: g.rows, rings: g.rings,
    scope: g.scope, row: g.row, rowCopies: Boolean(g.rowCopies), extent: g.extent,
  };
  if (!isGridCutParameters(normalized)) throw new RangeError("网格切参数超出范围。");
  if (!gridSymmetryAvailable(normalized.symmetry, indexTeeth, normalized.mirror)) {
    throw new RangeError(normalized.mirror
      ? `${indexTeeth} 齿分度盘不能把 ${normalized.symmetry} 次对称的镜像轴放在整齿上；请关闭镜像或换分度盘。`
      : `${indexTeeth} 齿分度盘不能整齿等分 ${normalized.symmetry} 次对称。`);
  }
  return normalized;
}

/** Tangent points and ideal cell outlines of a lattice, in the tool frame (radius W). */
function latticeCells(g, W) {
  const cells = [];
  if (g.lattice === "square") {
    const C = g.columns, R = g.rows, sx = (2 * W) / C, sy = (2 * W) / R;
    for (let j = 0; j < R; j++) for (let i = 0; i < C; i++) {
      const x0 = -W + i * sx, y0 = -W + j * sy;
      cells.push({ key: `${i}:${j}`, row: j, centre: [x0 + sx / 2, y0 + sy / 2],
        corners: [[x0, y0], [x0 + sx, y0], [x0 + sx, y0 + sy], [x0, y0 + sy]] });
    }
    return cells;
  }
  const m = g.rings, r3 = Math.sqrt(3);
  if (g.lattice === "hex") {
    // 6-fold: a tangent point on the axis (flat table cell); 3-fold: three around it.
    const offset = g.symmetry === 3 ? 1 / r3 : 0;
    const a = W / (m - 1 + offset + 1 / r3), reach = (m - 1 + offset) * a * (1 + 1e-9);
    const shift = offset ? [a / 2, a / (2 * r3)] : [0, 0];
    for (let j = -m - 1; j <= m + 1; j++) for (let i = -m - 2; i <= m + 2; i++) {
      const p = [i * a + (j * a) / 2 - shift[0], (j * a * r3) / 2 - shift[1]];
      if (Math.hypot(...p) > reach) continue;
      cells.push({ key: `${i}:${j}`, row: j, centre: p,
        corners: Array.from({ length: 6 }, (_, q) => [p[0] + (a / r3) * Math.cos(Math.PI / 6 + (q * Math.PI) / 3), p[1] + (a / r3) * Math.sin(Math.PI / 6 + (q * Math.PI) / 3)]) });
    }
  } else {
    // Triangles: 6-fold puts a lattice point on the axis, 3-fold a triangle centre.
    const a = W / m, shift = g.symmetry === 3 ? [a / 2, a / (2 * r3)] : [0, 0];
    const vertex = (i, j) => [i * a + (j * a) / 2 - shift[0], (j * a * r3) / 2 - shift[1]];
    for (let j = -m - 1; j <= m + 1; j++) for (let i = -2 * m - 2; i <= 2 * m + 2; i++) {
      for (const [up, corners] of [[true, [vertex(i, j), vertex(i + 1, j), vertex(i, j + 1)]], [false, [vertex(i + 1, j), vertex(i + 1, j + 1), vertex(i, j + 1)]]]) {
        if (corners.some((c) => Math.hypot(...c) > W * (1 + 1e-9))) continue;
        cells.push({ key: `${i}:${j}:${up ? "u" : "d"}`, row: j, corners,
          centre: [(corners[0][0] + corners[1][0] + corners[2][0]) / 3, (corners[0][1] + corners[1][1] + corners[2][1]) / 3] });
      }
    }
  }
  // Rows count from the lowest one, as for the square grid.
  const lowest = Math.min(...cells.map((cell) => cell.row));
  for (const cell of cells) cell.row -= lowest;
  // A 3-fold lattice is centred on a triangle, whose mirror axes are 30° off the
  // 6-fold ones; a quarter turn puts them on the axes symmetryOps uses.
  if (g.symmetry === 3) for (const cell of cells) {
    cell.centre = rotate(cell.centre, Math.PI / 2);
    cell.corners = cell.corners.map((p) => rotate(p, Math.PI / 2));
  }
  return cells;
}

/** Symmetry operations in tooth units: rotation by `turn` teeth, or a mirror about `axis` teeth. */
function symmetryOps(g, teeth) {
  const ops = [];
  for (let k = 0; k < g.symmetry; k++) ops.push({ turn: (k * teeth) / g.symmetry });
  if (g.mirror) for (let k = 0; k < g.symmetry; k++) ops.push({ axis: (k * teeth) / (2 * g.symmetry) });
  return ops;
}
const applyToPoint = (op, [x, y], step) => {
  if (op.turn !== undefined) return rotate([x, y], rad(op.turn * step));
  const a = rad(2 * op.axis * step);
  return [x * Math.cos(a) + y * Math.sin(a), x * Math.sin(a) - y * Math.cos(a)];
};
const applyToIndex = (op, index, teeth) => mod(op.turn !== undefined ? index + op.turn : 2 * op.axis - index, teeth);

/**
 * The solved tool with apex 0, rotation 0 and unit edge slope: cells, orbit
 * planes (z = c - m (cos φ x + sin φ y)) and the solver report.
 *
 * The meet constraints z - c + m·u = 0 are homogeneous in (m, c, z) and the
 * whole-tooth azimuths do not depend on the slope, so the tool for edge slope s
 * is this one with m, c and z scaled by s, meets still exact. One solve per
 * lattice shape serves every edge angle, depth and rotation; dragging any of
 * them never solves again.
 */
const cache = new Map();
function solvedTool(g, teeth, W) {
  const key = JSON.stringify([g, teeth, W]);
  if (cache.has(key)) return cache.get(key);
  const step = 360 / teeth, k = 1 / (2 * W), tolerance = 1e-9 * W;
  const all = latticeCells(g, W).map((cell) => ({
    ...cell, slope: [2 * k * cell.centre[0], 2 * k * cell.centre[1]], height: -k * (cell.centre[0] ** 2 + cell.centre[1] ** 2),
  }));
  // A single row without its copies keeps only the operations that map that row onto itself.
  const candidates = all.filter((cell) => g.scope === "face" || cell.row === g.row);
  if (!candidates.length) throw new RangeError("所选的行没有网格单元。");
  const findIn = (list, p) => list.findIndex((cell) => Math.hypot(cell.centre[0] - p[0], cell.centre[1] - p[1]) < tolerance);
  let ops = symmetryOps(g, teeth), cells;
  if (all.some((cell) => ops.some((op) => findIn(all, applyToPoint(op, cell.centre, step)) < 0))) {
    throw new Error(`Grid lattice ${g.lattice} does not carry its ${g.symmetry}-fold${g.mirror ? " mirror" : ""} symmetry.`);
  }
  if (g.scope === "row" && !g.rowCopies) {
    ops = ops.filter((op) => candidates.every((cell) => findIn(candidates, applyToPoint(op, cell.centre, step)) >= 0));
    cells = candidates;
  } else {
    // A row with its copies: every cell its symmetry operations reach.
    const keep = new Set();
    for (const cell of candidates) for (const op of ops) {
      const j = findIn(all, applyToPoint(op, cell.centre, step));
      if (j >= 0) keep.add(j);
    }
    cells = all.filter((_, i) => keep.has(i));
  }
  const orbitOf = new Array(cells.length).fill(-1), opOf = new Array(cells.length).fill(null), orbits = [];
  cells.forEach((cell, i) => {
    if (orbitOf[i] >= 0) return;
    const orbit = orbits.length;
    orbits.push({ representative: i });
    for (const op of ops) {
      const j = findIn(cells, applyToPoint(op, cell.centre, step));
      if (j >= 0 && orbitOf[j] < 0) { orbitOf[j] = orbit; opOf[j] = op; }
    }
  });
  // Whole teeth: round each representative once; symmetry gives the rest exactly.
  for (const orbit of orbits) {
    const rep = cells[orbit.representative], m = Math.hypot(...rep.slope);
    orbit.flat = m < 1e-12;
    const ideal = orbit.flat ? 0 : deg(Math.atan2(rep.slope[1], rep.slope[0])) / step;
    orbit.index = orbit.flat ? 0 : Math.round(ideal);
    orbit.snapDeg = Math.abs(ideal - orbit.index) * step;
    orbit.m = m;
    orbit.c = rep.height + rep.slope[0] * rep.centre[0] + rep.slope[1] * rep.centre[1];
  }
  cells.forEach((cell, i) => {
    cell.orbit = orbitOf[i];
    cell.index = orbits[cell.orbit].flat ? 0 : applyToIndex(opOf[i], orbits[cell.orbit].index, teeth);
  });
  // Interior lattice points: corners whose cells turn a full circle round them.
  const points = [];
  cells.forEach((cell, ci) => cell.corners.forEach((p, q) => {
    const prev = cell.corners[(q + cell.corners.length - 1) % cell.corners.length], next = cell.corners[(q + 1) % cell.corners.length];
    let angle = Math.abs(Math.atan2(prev[1] - p[1], prev[0] - p[0]) - Math.atan2(next[1] - p[1], next[0] - p[0]));
    if (angle > Math.PI) angle = 2 * Math.PI - angle;
    let point = points.find((pt) => Math.hypot(pt.xy[0] - p[0], pt.xy[1] - p[1]) < tolerance);
    if (!point) points.push((point = { xy: p, cells: [], angle: 0 }));
    point.cells.push(ci);
    point.angle += angle;
  }));
  const meets = points.filter((pt) => Math.abs(pt.angle - 2 * Math.PI) < 1e-6 && pt.cells.length >= 4);

  // Joint solve from the ideal tool (shared with composite tools): orbit planes
  // share (m, c), every interior lattice point is a meet of its cells.
  const solved = solveMeets({
    groups: orbits.map((orbit) => ({ m: orbit.flat ? 0 : orbit.m, c: orbit.c, fixedSlope: orbit.flat })),
    planes: cells.map((cell) => ({ group: cell.orbit, cos: Math.cos(rad(cell.index * step)), sin: Math.sin(rad(cell.index * step)) })),
    points: meets.map((pt) => ({ xyz: [pt.xy[0], pt.xy[1], -k * (pt.xy[0] ** 2 + pt.xy[1] ** 2)], planes: pt.cells })),
    scale: W,
  });
  const planes = orbits.map((orbit, o) => ({ flat: orbit.flat, m: solved.groups[o].m, c: solved.groups[o].c, snapDeg: orbit.snapDeg }));
  const result = {
    cells: cells.map((cell) => ({ key: cell.key, row: cell.row, orbit: cell.orbit, index: cell.index, centre: cell.centre, corners: cell.corners })),
    planes,
    report: {
      meets: meets.length,
      // At unit edge slope; scales with the slope.
      meetResidual: solved.residual,
      maxSnapDeg: Math.max(0, ...planes.map((p) => p.snapDeg)),
      maxShift: solved.maxShift,
      upright: planes.every((p) => p.m >= 0),
    },
  };
  if (cache.size > 64) cache.delete(cache.keys().next().value);
  cache.set(key, result);
  return result;
}

/**
 * A grid cut on `reference` (cube stock or cutting reference): `edgeAngle`,
 * `depth` (apex below the reference top) and `rotation` (whole teeth) place the
 * solved tool. Each orbit becomes one level: one industry angle, one depth and
 * the indices of its cells.
 */
export function gridCutLayout(grid, { indexTeeth = 96, reference = { size: 2, center: [0, 0, 0] }, edgeAngle = DEFAULT_GRID_EDGE_ANGLE, depth = DEFAULT_GRID_DEPTH, rotation = 0 } = {}) {
  const g = normalizeGridCut(grid, indexTeeth), teeth = indexTeeth;
  if (!within(edgeAngle, GRID_CUT_LIMITS.edgeAngle)) throw new RangeError(`网格切的边缘角需在 ${GRID_CUT_LIMITS.edgeAngle.join("–")}° 之间。`);
  if (!Number.isInteger(rotation)) throw new RangeError("网格切只能按整齿旋转。");
  // Cube reference: half size; mesh reference: its rotational envelope.
  const r = reference.envelope?.radius ?? reference.size / 2, h = reference.envelope?.halfHeight ?? reference.size / 2;
  const cz = reference.center?.[2] ?? 0, top = cz + h, W = g.extent * r;
  const tool = solvedTool(g, teeth, W), slope = Math.tan(rad(edgeAngle));
  const turn = rad((rotation * 360) / teeth);
  const levels = tool.planes.map((plane, orbit) => {
    // The unit-slope tool scaled to the edge slope; z = (top - depth) + c - m (cos φ x + sin φ y),
    // depth measured from the rotational envelope.
    const m = plane.m * slope, norm = Math.hypot(m, 1), c = top - depth + plane.c * slope;
    return {
      orbit, flat: plane.flat,
      industryAngleDeg: deg(Math.atan(m)),
      depth: (h + cz + r * m - c) / norm,
      indices: [...new Set(tool.cells.filter((cell) => cell.orbit === orbit).map((cell) => mod(cell.index + rotation, teeth)))],
    };
  });
  const place = (p) => rotate(p, turn);
  // Cells of one orbit that rounding put on the same tooth are one plane: the
  // lattice collapses there even though every meet still solves exactly.
  const planesSeen = new Set();
  let mergedCells = 0;
  for (const cell of tool.cells) {
    const key = `${cell.orbit}|${cell.index}`;
    if (planesSeen.has(key)) mergedCells += 1; else planesSeen.add(key);
  }
  return {
    grid: g, edgeAngle, depth, rotation: mod(rotation, teeth),
    levels,
    cells: tool.cells.map((cell) => ({ ...cell, index: mod(cell.index + rotation, teeth), centre: place(cell.centre), corners: cell.corners.map(place) })),
    radius: W,
    report: { ...tool.report, meetResidual: tool.report.meetResidual * slope, cells: tool.cells.length, levels: levels.length, mergedCells },
  };
}

/** One facet per cell, in cell order; `cell` keeps each facet's identity through edits. */
export function gridCutFacets(grid, options = {}) {
  const layout = gridCutLayout(grid, options);
  return layout.cells.map((cell) => {
    const level = layout.levels[cell.orbit];
    return { index: cell.index, industryAngleDeg: level.industryAngleDeg, depth: level.depth, cell: cell.key, orbit: cell.orbit, flat: level.flat };
  });
}

export function gridCutMetadata({ grid, edgeAngle, depth, rotation }) {
  return { version: GRID_CUT_VERSION, ...grid, edgeAngle, depth, rotation };
}

/**
 * The saved tool of a layer, or null once its facets no longer match the
 * regenerated tool (a hand edit, a rescale or a fractional rotation).
 */
export function gridCutFromFacets(facets, reference) {
  const saved = facets[0]?.metadata?.grid;
  if (!saved || saved.version !== GRID_CUT_VERSION) return null;
  const { version: _version, edgeAngle, depth, rotation, ...grid } = saved;
  if (!isGridCutParameters(grid)) return null;
  const teeth = facets[0].indexTeeth ?? 96;
  try {
    const expected = gridCutFacets(grid, { indexTeeth: teeth, reference, edgeAngle, depth, rotation });
    const byCell = new Map(facets.map((facet) => [facet.metadata?.gridCell, facet]));
    const same = expected.length === facets.length && expected.every((cell) => {
      const facet = byCell.get(cell.cell);
      return facet && Math.abs(mod(facet.index, teeth) - cell.index) < 1e-9
        && Math.abs(facet.industryAngleDeg - cell.industryAngleDeg) < 1e-7 && Math.abs(facet.depth - cell.depth) < 1e-7;
    });
    return same ? { grid, edgeAngle, depth, rotation } : null;
  } catch {
    return null;
  }
}

/** Facet groups a dissolved grid becomes: one per orbit (one angle and depth each). */
export function gridDissolveLevels(saved, { indexTeeth = 96, reference }) {
  const { grid, edgeAngle, depth, rotation } = saved;
  return gridCutLayout(grid, { indexTeeth, reference, edgeAngle, depth, rotation }).levels;
}

export function validateGridCutMetadata(value, path, addError) {
  if (value === undefined) return;
  const { version, edgeAngle, depth, rotation, ...grid } = value ?? {};
  if (version !== GRID_CUT_VERSION || !isGridCutParameters(grid) || !within(edgeAngle, GRID_CUT_LIMITS.edgeAngle)
    || !Number.isFinite(depth) || !Number.isInteger(rotation)) {
    addError(path, `must be a version ${GRID_CUT_VERSION} grid cut (symmetry, mirror, lattice, columns, rows, rings, scope, row, rowCopies, extent, edgeAngle, depth, rotation)`);
  }
}

/**
 * Grid parameters own a CUT draft in grid mode. The draft's index rotates the
 * whole tool by whole teeth, its angle is the edge angle and its depth the apex
 * depth. Choosing another mode (or a ring) leaves the grid; the facets stay.
 */
export function gridDraftPatch(draft, patch) {
  const leaving = patch.grid === null || patch.ring || ("patternMode" in patch && patch.patternMode !== "grid" && !("grid" in patch));
  if (leaving) return draft.grid || "grid" in patch ? { ...patch, grid: null } : patch;
  const grid = "grid" in patch ? patch.grid : draft.grid;
  if (!grid) return patch;
  const teeth = patch.indexTeeth ?? draft.indexTeeth ?? 96;
  let normalized;
  try { normalized = normalizeGridCut(grid, teeth); } catch { normalized = { ...DEFAULT_GRID_CUT, ...grid }; }
  const angle = "industryAngle" in patch ? patch.industryAngle : draft.industryAngle;
  const [low, high] = GRID_CUT_LIMITS.edgeAngle;
  return {
    ...patch,
    grid: normalized,
    patternMode: "grid",
    ring: null,
    baseIndex: mod(Math.round("baseIndex" in patch ? patch.baseIndex : draft.baseIndex), teeth),
    industryAngle: Math.min(high, Math.max(low, Number.isFinite(angle) ? angle : DEFAULT_GRID_EDGE_ANGLE)),
  };
}

/** The facet that stands for the tool (gizmo, primary index): the steepest, nearest the rotation tooth. */
export function gridPrimaryIndex(facets, rotation, indexTeeth = 96) {
  const distance = (index) => { const d = Math.abs(mod(index, indexTeeth) - mod(rotation, indexTeeth)); return Math.min(d, indexTeeth - d); };
  const steepest = Math.max(...facets.map((facet) => facet.industryAngleDeg));
  return facets.filter((facet) => facet.industryAngleDeg > steepest - 1e-9)
    .reduce((best, facet) => (distance(facet.index) < distance(best.index) ? facet : best)).index;
}
