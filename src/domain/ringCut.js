// Local index helpers keep this module free of a cycle with faceting.js,
// which validates ring metadata.
const normalizeIndex = (index, teeth) => {
  const value = ((index % teeth) + teeth) % teeth;
  return Math.abs(value - teeth) < 1e-9 ? 0 : Number(value.toFixed(9));
};
const displayIndex = (index, teeth) => normalizeIndex(index, teeth) || teeth;

/*
 * Ring cuts: generators that turn an L-sided outline into one group of
 * facets, snapped to whole teeth of the current wheel with symmetry first
 * (one set of tooth offsets shared by every side, mirror-symmetric inside a
 * side; only side centres round individually when the wheel has no L equal
 * steps). Every kind is registered in RING_CUT_KINDS:
 *
 * - fan: each side cut by a fan of facets `spacingDeg` apart, one depth.
 * - arc: each side bulged into an arc through its two corners (bulge 0 =
 *   straight side, 1 = circumscribed circle) and split into equal chords.
 *   Chord distances are solved jointly so neighbouring facets meet on the
 *   arc's division points; the group keeps these distance ratios and the
 *   primary facet (the farthest level) carries the group depth.
 *
 * A ring group is stored as an ordinary arbitrary-index layer plus
 * `metadata.ring`; readers that do not know ring cuts still see valid
 * explicit facets. The parameters stay editable only while the stored
 * indices still match them exactly. Saved rings without `kind` are fans.
 */

export const RING_CUT_VERSION = 1;
export const RING_CUT_LIMITS = Object.freeze({
  symmetry: Object.freeze([2, 24]),
  subdivisions: Object.freeze([1, 9]),
  spacingDeg: Object.freeze([0.1, 90]),
  bulge: Object.freeze([0, 1]),
});
/** L2 has no straight outline: its arcs need a bulge and two chords. */
export const ARC_TWO_SIDED_MIN_BULGE = 0.05;
export const DEFAULT_RING_CUT = Object.freeze({ kind: "fan", symmetry: 3, subdivisions: 3, spacingDeg: 15, rotation: 0 });
export const DEFAULT_ARC_CUT = Object.freeze({ kind: "arc", symmetry: 3, subdivisions: 3, bulge: 0.5, rotation: 0 });

/** Registered kinds, in the order the editor lists them. */
export const RING_CUT_KINDS = Object.freeze([
  Object.freeze({ id: "fan", label: "扇形 · 同深", tag: "环切", defaults: DEFAULT_RING_CUT }),
  Object.freeze({ id: "arc", label: "弧形 · 联动深度", tag: "弧切", defaults: DEFAULT_ARC_CUT }),
]);
export const ringCutKind = (ring) => RING_CUT_KINDS.find((kind) => kind.id === (ring?.kind ?? "fan")) ?? null;

const within = (value, [min, max]) => Number.isFinite(value) && value >= min && value <= max;

export function isRingCutParameters(ring) {
  if (!ring || typeof ring !== "object" || !ringCutKind(ring)) return false;
  const common = Number.isInteger(ring.symmetry) && within(ring.symmetry, RING_CUT_LIMITS.symmetry)
    && Number.isInteger(ring.subdivisions) && within(ring.subdivisions, RING_CUT_LIMITS.subdivisions)
    && Number.isInteger(ring.rotation) && ring.rotation >= 0;
  if (!common) return false;
  if ((ring.kind ?? "fan") === "fan") return within(ring.spacingDeg, RING_CUT_LIMITS.spacingDeg);
  return within(ring.bulge, RING_CUT_LIMITS.bulge)
    && (ring.symmetry > 2 || (ring.bulge >= ARC_TWO_SIDED_MIN_BULGE && ring.subdivisions >= 2));
}

/** Clamp editor input to valid parameters of its kind; rotation wraps on the wheel. */
export function normalizeRingCut(ring, indexTeeth) {
  const clamp = (value, [min, max], fallback) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : fallback));
  const kind = ringCutKind(ring)?.id ?? "fan";
  const defaults = kind === "arc" ? DEFAULT_ARC_CUT : DEFAULT_RING_CUT;
  const symmetry = Math.round(clamp(Number(ring?.symmetry), RING_CUT_LIMITS.symmetry, defaults.symmetry));
  let subdivisions = Math.round(clamp(Number(ring?.subdivisions), RING_CUT_LIMITS.subdivisions, defaults.subdivisions));
  const rotation = ((Math.round(Number(ring?.rotation) || 0) % indexTeeth) + indexTeeth) % indexTeeth;
  if (kind === "fan") {
    return { kind, symmetry, subdivisions, spacingDeg: Number(clamp(Number(ring?.spacingDeg), RING_CUT_LIMITS.spacingDeg, defaults.spacingDeg).toFixed(4)), rotation };
  }
  let bulge = Number(clamp(Number(ring?.bulge), RING_CUT_LIMITS.bulge, defaults.bulge).toFixed(4));
  if (symmetry === 2) {
    bulge = Math.max(ARC_TWO_SIDED_MIN_BULGE, bulge);
    subdivisions = Math.max(2, subdivisions);
  }
  return { kind, symmetry, subdivisions, bulge, rotation };
}

/** Whole-tooth offsets of one side's fan, from the side normal. */
function fanOffsets(subdivisions, spacingDeg, indexTeeth) {
  const tooth = 360 / indexTeeth;
  const half = [];
  const odd = subdivisions % 2 === 1;
  const count = Math.floor(subdivisions / 2);
  for (let step = 1; step <= count; step += 1) {
    const ideal = (odd ? step : step - 0.5) * spacingDeg / tooth;
    half.push(Math.max((half.at(-1) ?? 0) + 1, Math.round(ideal)));
  }
  return odd ? [0, ...half.flatMap((offset) => [-offset, offset])] : half.flatMap((offset) => [-offset, offset]);
}

const sideCentre = (ring, side, teeth) => Math.round(ring.rotation + side * teeth / ring.symmetry);
const signedOffset = (index, centre, teeth) => {
  const value = normalizeIndex(index - centre, teeth);
  return value > teeth / 2 ? value - teeth : value;
};

function summarize(ring, teeth, facets, extra) {
  const indices = facets.map((facet) => facet.index);
  const ratios = Object.fromEntries(facets.map((facet) => [String(facet.index), facet.ratio]));
  const levels = [];
  for (const facet of facets) {
    const key = Math.abs(facet.offset);
    let level = levels.find((item) => item.offset === key);
    if (!level) { level = { offset: key, ratio: facet.ratio, indices: [] }; levels.push(level); }
    level.indices.push(facet.index);
  }
  levels.sort((left, right) => right.ratio - left.ratio || left.offset - right.offset);
  return {
    ring,
    indices: [...indices].sort((left, right) => displayIndex(left, teeth) - displayIndex(right, teeth)),
    ratios,
    levels,
    exactSymmetry: teeth % ring.symmetry === 0,
    ...extra,
  };
}

function fanLayout(ring, teeth) {
  const offsets = fanOffsets(ring.subdivisions, ring.spacingDeg, teeth);
  const seen = new Set();
  const facets = [];
  let merged = 0;
  for (let side = 0; side < ring.symmetry; side += 1) {
    const centre = sideCentre(ring, side, teeth);
    for (const offset of offsets) {
      const index = normalizeIndex(centre + offset, teeth);
      if (seen.has(index)) { merged += 1; continue; }
      seen.add(index);
      facets.push({ index, offset, ratio: 1 });
    }
  }
  const primaryOffset = ring.subdivisions % 2 === 1 ? 0 : offsets[1];
  return summarize(ring, teeth, facets, {
    primaryIndex: normalizeIndex(ring.rotation + primaryOffset, teeth),
    offsets: [...new Set(offsets)].sort((left, right) => left - right),
    actualSpacingDeg: ring.subdivisions > 1 ? (ring.subdivisions % 2 ? offsets[2] : offsets[1] * 2) * 360 / teeth : 0,
    // A fan wider than one side reaches past the neighbouring side's centre.
    crossesNeighbours: 2 * Math.max(0, ...offsets) >= teeth / ring.symmetry,
    merged,
    residual: 0,
  });
}

/** Ideal arc of one side in its own frame (side normal along +x, circumradius 1). */
function arcGeometry(symmetry, subdivisions, bulge) {
  const apothem = Math.cos(Math.PI / symmetry);
  const halfChord = Math.sin(Math.PI / symmetry);
  const sagitta = bulge * (1 - apothem);
  if (sagitta < 1e-9) {
    const points = Array.from({ length: subdivisions + 1 }, (_, m) => [apothem, -halfChord + 2 * halfChord * m / subdivisions]);
    return { points, normals: Array(subdivisions).fill(0) };
  }
  const radius = (halfChord * halfChord + sagitta * sagitta) / (2 * sagitta);
  const centre = apothem + sagitta - radius;
  const span = Math.asin(Math.min(1, halfChord / radius));
  const points = Array.from({ length: subdivisions + 1 }, (_, m) => {
    const angle = -span + 2 * span * m / subdivisions;
    return [centre + radius * Math.cos(angle), radius * Math.sin(angle)];
  });
  const normals = Array.from({ length: subdivisions }, (_, j) => -span + 2 * span * (j + 0.5) / subdivisions);
  return { points, normals };
}

const rotate = ([x, y], angle) => [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle)];

function solveLinear(matrix, vector) {
  const size = vector.length;
  const rows = matrix.map((row, i) => [...row, vector[i]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const value = rows[column][column];
    if (Math.abs(value) < 1e-15) continue;
    for (let k = column; k <= size; k += 1) rows[column][k] /= value;
    for (let row = 0; row < size; row += 1) {
      if (row === column || !rows[row][column]) continue;
      const factor = rows[row][column];
      for (let k = column; k <= size; k += 1) rows[row][k] -= factor * rows[column][k];
    }
  }
  return rows.map((row) => row[size]);
}

function arcLayout(ring, teeth) {
  const tooth = 2 * Math.PI / teeth;
  const { points, normals } = arcGeometry(ring.symmetry, ring.subdivisions, ring.bulge);
  const k = ring.subdivisions;
  const half = normals.slice(Math.ceil(k / 2)).map((angle) => Math.round(angle / tooth));
  const offsets = [...half].reverse().map((offset) => -offset);
  if (k % 2) offsets.push(0);
  offsets.push(...half);
  // Segments in azimuth order, each with the arc point that ends it.
  const centres = Array.from({ length: ring.symmetry }, (_, side) => sideCentre(ring, side, teeth));
  const segments = [];
  centres.forEach((centre, side) => {
    const angle = centre * tooth;
    const nextAngle = centres[(side + 1) % ring.symmetry] * tooth;
    for (let j = 0; j < k; j += 1) {
      const end = j < k - 1 ? rotate(points[j + 1], angle)
        : rotate(points[k], angle).map((value, axis) => (value + rotate(points[0], nextAngle)[axis]) / 2);
      segments.push({ side, offset: offsets[j], index: normalizeIndex(centre + offsets[j], teeth), end });
    }
  });
  // Neighbouring segments rounded to one direction become one facet.
  const facets = [];
  for (const segment of segments) {
    const last = facets.at(-1);
    if (last && last.index === segment.index) last.end = segment.end;
    else facets.push({ ...segment });
  }
  if (facets.length > 1 && facets[0].index === facets.at(-1).index) facets.pop();
  const merged = segments.length - facets.length;
  const count = facets.length;
  const normal = (facet) => [Math.cos(facet.index * tooth), Math.sin(facet.index * tooth)];
  // Least squares on plane distances: vertex q (facet q ∩ facet q+1) is linear
  // in their distances; a tiny pull toward each ideal distance keeps
  // degenerate (parallel) neighbours determined.
  const ata = Array.from({ length: count }, () => Array(count).fill(0));
  const atb = Array(count).fill(0);
  const vertexMaps = [];
  facets.forEach((facet, q) => {
    const [ax, ay] = normal(facet);
    const next = facets[(q + 1) % count];
    const [bx, by] = normal(next);
    const det = ax * by - ay * bx;
    if (count < 3 || Math.abs(det) < 1e-9) { vertexMaps.push(null); return; }
    const a = [by / det, -bx / det];
    const b = [-ay / det, ax / det];
    vertexMaps.push([a, b]);
    const qn = (q + 1) % count;
    for (let axis = 0; axis < 2; axis += 1) {
      const coefficients = [[q, a[axis]], [qn, b[axis]]];
      for (const [u, cu] of coefficients) {
        atb[u] += cu * facet.end[axis];
        for (const [v, cv] of coefficients) ata[u][v] += cu * cv;
      }
    }
  });
  const lambda = 1e-6;
  facets.forEach((facet, q) => {
    // Pull toward the segment's midpoint so mirrored segments stay mirrored.
    const start = facets[(q - 1 + count) % count].end;
    const [nx, ny] = normal(facet);
    ata[q][q] += lambda;
    atb[q] += lambda * (nx * (start[0] + facet.end[0]) + ny * (start[1] + facet.end[1])) / 2;
  });
  const distances = solveLinear(ata, atb);
  let residual = 0;
  vertexMaps.forEach((map, q) => {
    if (!map) return;
    const qn = (q + 1) % count;
    const vertex = [map[0][0] * distances[q] + map[1][0] * distances[qn], map[0][1] * distances[q] + map[1][1] * distances[qn]];
    residual = Math.max(residual, Math.hypot(vertex[0] - facets[q].end[0], vertex[1] - facets[q].end[1]));
  });
  const farthest = Math.max(...distances);
  const layoutFacets = facets.map((facet, q) => ({
    index: facet.index,
    offset: signedOffset(facet.index, centres[facet.side], teeth),
    ratio: Number((distances[q] / farthest).toFixed(12)),
  }));
  // The farthest level of side 0 carries the group depth; every other facet cuts deeper.
  const primary = layoutFacets
    .map((facet, q) => ({ ...facet, side: facets[q].side }))
    .filter((facet) => facet.side === 0)
    .sort((left, right) => (Math.abs(right.ratio - left.ratio) > 1e-9 ? right.ratio - left.ratio : 0) || Math.abs(left.offset) - Math.abs(right.offset) || right.offset - left.offset)[0]
    ?? layoutFacets[0];
  return summarize(ring, teeth, layoutFacets, {
    primaryIndex: primary.index,
    offsets: [...new Set(offsets)].sort((left, right) => left - right),
    actualSpacingDeg: 0,
    crossesNeighbours: false,
    merged,
    residual,
    degenerate: count < 3,
    distanceScale: farthest,
  });
}

/**
 * Indices, primary facet, per-index distance ratios (1 = the primary's plane
 * distance, all ≤ 1) and depth levels of a ring cut on an `indexTeeth` wheel,
 * plus what rounding did (`exactSymmetry`, `merged`, `residual`).
 */
export function ringCutLayout(ring, indexTeeth) {
  const normalized = normalizeRingCut(ring, indexTeeth);
  return normalized.kind === "arc" ? arcLayout(normalized, indexTeeth) : fanLayout(normalized, indexTeeth);
}

/**
 * Top-view sketch of a ring cut in the top view's frame (circumradius 1, a
 * facet's normal at its index azimuth): the ideal outline (L-gon corners,
 * arcs and their division points) and the outline the snapped facets cut,
 * one edge per facet with its depth level. `edges` is empty when the facets
 * do not enclose an outline.
 */
export function ringCutSketch(ring, indexTeeth) {
  const layout = ringCutLayout(ring, indexTeeth);
  const { symmetry, subdivisions, kind } = layout.ring;
  const tooth = 2 * Math.PI / indexTeeth;
  const sideAngles = Array.from({ length: symmetry }, (_, side) => sideCentre(layout.ring, side, indexTeeth) * tooth);
  const corners = sideAngles.map((angle, side) => {
    const next = sideAngles[(side + 1) % symmetry] + (side === symmetry - 1 ? 2 * Math.PI : 0);
    return rotate([1, 0], (angle + next) / 2);
  });
  const arc = kind === "arc";
  const arcs = arc ? sideAngles.map((angle) => arcGeometry(symmetry, 24, layout.ring.bulge).points.map((point) => rotate(point, angle))) : [];
  const divisions = arc ? sideAngles.flatMap((angle) => arcGeometry(symmetry, subdivisions, layout.ring.bulge).points.slice(1, -1).map((point) => rotate(point, angle))) : [];
  const scale = layout.distanceScale ?? Math.cos(Math.PI / symmetry);
  const facets = layout.indices
    .map((index) => ({ index, angle: normalizeIndex(index, indexTeeth) * tooth, distance: (layout.ratios[String(index)] ?? 1) * scale }))
    .sort((left, right) => left.angle - right.angle);
  const gap = (q) => ((facets[(q + 1) % facets.length].angle - facets[q].angle) + 2 * Math.PI) % (2 * Math.PI);
  const closed = facets.length >= 3 && facets.every((_, q) => gap(q) > 1e-9 && gap(q) < Math.PI - 1e-9);
  const meet = (a, b) => {
    const det = Math.sin(b.angle - a.angle);
    return [(a.distance * Math.sin(b.angle) - b.distance * Math.sin(a.angle)) / det, (b.distance * Math.cos(a.angle) - a.distance * Math.cos(b.angle)) / det];
  };
  // A fan cuts every facet at one depth; only arc levels differ.
  const levelOf = (index) => (arc ? Math.max(0, layout.levels.findIndex((level) => level.indices.includes(index))) : 0);
  const edges = closed ? facets.map((facet, q) => ({
    index: facet.index,
    level: levelOf(facet.index),
    primary: facet.index === layout.primaryIndex,
    from: meet(facets[(q - 1 + facets.length) % facets.length], facet),
    to: meet(facet, facets[(q + 1) % facets.length]),
  })) : [];
  return { corners, arcs, divisions, edges };
}

/** Plane-distance ratio of one generated index (1 when the index is unknown). */
export function ringRatioForIndex(layout, index, indexTeeth) {
  return layout?.ratios?.[String(normalizeIndex(index, indexTeeth))] ?? 1;
}

/**
 * Keep a draft's generated indices in step with its ring parameters. A plain
 * index change (index tape, gizmo rings) rotates the whole ring by the same
 * whole number of teeth; choosing symmetric or custom indices leaves the ring
 * (the stored indices stay, as an ordinary layer).
 */
export function ringDraftPatch(draft, patch) {
  if (patch.ring === null || (("patternMode" in patch) && !("ring" in patch))) return { ...patch, ring: null };
  const ring = "ring" in patch ? patch.ring : draft.ring;
  if (!ring) return patch;
  const teeth = patch.indexTeeth ?? draft.indexTeeth ?? 96;
  let next = normalizeRingCut(ring, teeth);
  if (!("ring" in patch) && "baseIndex" in patch && Number.isFinite(patch.baseIndex)) {
    const delta = Math.round(patch.baseIndex - draft.baseIndex);
    next = normalizeRingCut({ ...next, rotation: next.rotation + delta }, teeth);
  }
  const layout = ringCutLayout(next, teeth);
  return {
    ...patch,
    ring: layout.ring,
    patternMode: "arbitrary",
    customIndices: layout.indices.map((index) => displayIndex(index, teeth)).join(" "),
    baseIndex: layout.primaryIndex,
  };
}

export function ringCutMetadata(ring) {
  return { version: RING_CUT_VERSION, ...ring };
}

/** The saved ring parameters of a layer, or null once they no longer describe its facets. */
export function ringCutFromFacets(facets) {
  const saved = facets[0]?.metadata?.ring;
  if (!saved || saved.version !== RING_CUT_VERSION || !isRingCutParameters(saved)) return null;
  const teeth = facets[0].indexTeeth ?? 96;
  const { version: _version, ...ring } = saved;
  const layout = ringCutLayout(ring, teeth);
  const stored = [...new Set(facets.map((facet) => normalizeIndex(facet.index, teeth)))].sort((a, b) => a - b);
  const expected = [...layout.indices].sort((a, b) => a - b);
  const same = stored.length === expected.length && stored.every((index, i) => Math.abs(index - expected[i]) < 1e-9);
  return same ? layout.ring : null;
}

export function ringCutLabel(ring) {
  return `${ringCutKind(ring)?.tag ?? "环切"} L${ring.symmetry}×${ring.subdivisions}`;
}

/** Facet index groups a dissolved ring becomes: one per depth level (fans keep one layer). */
export function ringDissolveLevels(ring, indexTeeth) {
  const layout = ringCutLayout(ring, indexTeeth);
  if ((ring.kind ?? "fan") === "fan") return [layout.indices];
  return layout.levels.map((level) => level.indices);
}

export function validateRingCutMetadata(value, path, addError) {
  if (value === undefined) return;
  if (!value || typeof value !== "object" || value.version !== RING_CUT_VERSION || !isRingCutParameters(value)) {
    addError(path, `must be a version ${RING_CUT_VERSION} ring cut: fan (symmetry, subdivisions, spacingDeg, rotation) or arc (symmetry, subdivisions, bulge, rotation)`);
  }
}
