import { envelopeCells, envelopeMeets, envelopeShortestEdge, solveMeets } from "../meetSolver.js";

/*
 * Whole-tooth snapping of a composite tool that keeps its multi-face meets
 * (metadata version 2; the version 1 pivot rounding stays in compositeTools.js
 * so older layers regenerate unchanged).
 *
 * 1. Symmetry: the rotation order the registry claims (checked on the planes,
 *    else its largest divisor that holds) and a mirror axis, if the planes have
 *    one. The wheel carries the rotations by teeth / d with d = gcd(order,
 *    teeth), and the mirrors only when every axis of that group is a whole
 *    tooth (as for grid cuts); planes that are images of each other under the
 *    carried group form one orbit. Without a carried symmetry every plane is
 *    its own orbit.
 * 2. Each orbit's azimuth is rounded to a whole tooth once and mapped exactly
 *    to its members, so the result keeps the carried symmetry.
 * 3. Meets: points of the ideal tool surface inside the rim where four or more
 *    planes meet (three planes always meet). Rounding splits them; the slope and
 *    height of every orbit that touches a meet and every meet point are solved
 *    together (`solveMeets`), starting from each plane pivoted about its own
 *    anchor and the ideal points, so the tool stays close to the ideal and every
 *    meet is exact again. Other planes keep that pivot (each facet still passes
 *    through its own anchor). A tier tool keeps its first tier's angle (the
 *    main angle the designer set): those slopes are pinned, which the meet
 *    equations allow because they are homogeneous in slope.
 * 4. Two neighbouring facets with a meet at both ends of their edge that round
 *    to the same tooth must become one plane. A second rounding moves such
 *    orbits to the other side of their tooth; both are solved and the one that
 *    keeps more meets as corners of the tool (then: no new short edge, fewer
 *    merged facets, smaller point moves) wins.
 *
 * The report says what the designer sees: meets solved and their worst
 * residual, how far meet points moved, meets that a neighbouring facet now cuts
 * off (still exact but no longer a corner), merged facets, and the shortest
 * edge inside the rim against the ideal tool's.
 *
 * Input planes z = c - g·(x, y) in the tool frame (rim radius 1); output per
 * plane: tooth index in the tool frame, slope m and height c, plus a report.
 */

const TAU = 2 * Math.PI;
const mod = (value, teeth) => {
  const result = ((value % teeth) + teeth) % teeth;
  return Math.abs(result - teeth) < 1e-9 ? 0 : result;
};
const gcd = (a, b) => {
  let x = Math.abs(a), y = Math.abs(b);
  while (y) [x, y] = [y, x % y];
  return x || 1;
};

/** Plane lookup by (g, c) within 1e-7. */
function planeIndex(shape) {
  const scale = 1e6, buckets = new Map();
  const key = (gx, gy, c) => `${Math.round(gx * scale)},${Math.round(gy * scale)},${Math.round(c * scale)}`;
  shape.forEach((plane, i) => {
    const k = key(plane.g[0], plane.g[1], plane.c);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(i);
  });
  return (gx, gy, c) => {
    const bx = Math.round(gx * scale), by = Math.round(gy * scale), bc = Math.round(c * scale);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dc = -1; dc <= 1; dc++) {
      for (const i of buckets.get(`${bx + dx},${by + dy},${bc + dc}`) ?? []) {
        const p = shape[i];
        if (Math.abs(p.g[0] - gx) < 1e-7 && Math.abs(p.g[1] - gy) < 1e-7 && Math.abs(p.c - c) < 1e-7) return i;
      }
    }
    return -1;
  };
}

const rotateG = ([x, y], angle) => [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle)];
const mirrorG = ([x, y], axis) => [x * Math.cos(2 * axis) + y * Math.sin(2 * axis), x * Math.sin(2 * axis) - y * Math.cos(2 * axis)];

/** Rotation order and mirror axis (radians, or null) the planes actually have. */
export function shapeSymmetry(shape, claimedOrder = 1) {
  const find = planeIndex(shape);
  const holds = (map) => shape.every((plane) => { const g = map(plane.g); return find(g[0], g[1], plane.c) >= 0; });
  let order = 1;
  for (let n = Math.max(1, Math.round(claimedOrder)); n > 1; n--) {
    if (claimedOrder % n === 0 && holds((g) => rotateG(g, TAU / n))) { order = n; break; }
  }
  const first = shape.find((plane) => Math.hypot(...plane.g) > 1e-12);
  let mirror = null;
  if (first) {
    const m0 = Math.hypot(...first.g), phi0 = Math.atan2(first.g[1], first.g[0]);
    for (const plane of shape) {
      if (Math.abs(Math.hypot(...plane.g) - m0) > 1e-7 || Math.abs(plane.c - first.c) > 1e-7) continue;
      const axis = (phi0 + Math.atan2(plane.g[1], plane.g[0])) / 2;
      if (holds((g) => mirrorG(g, axis))) { mirror = axis; break; }
    }
  }
  return { order, mirror };
}

/** Symmetry operations the wheel carries, in tooth units: a turn, or a mirror about an axis. */
function carriedOps({ order, mirror }, teeth) {
  const d = gcd(order, teeth), ops = [];
  for (let k = 0; k < d; k++) ops.push({ turn: (k * teeth) / d });
  if (mirror !== null && teeth % (2 * d) === 0) {
    // Any mirror axis of the tool on a whole tooth; the subgroup's other axes follow.
    for (let k = 0; k < order; k++) {
      const axis = mod(((mirror + (k * Math.PI) / order) * teeth) / TAU, teeth / 2);
      if (Math.abs(axis - Math.round(axis)) > 1e-9) continue;
      for (let j = 0; j < d; j++) ops.push({ axis: Math.round(axis) + (j * teeth) / (2 * d) });
      break;
    }
  }
  const axis = ops.find((op) => op.axis !== undefined)?.axis ?? null;
  return { ops, rotation: d, mirror: axis !== null, axis };
}

const applyToG = (op, g, teeth) => (op.turn !== undefined ? rotateG(g, (op.turn * TAU) / teeth) : mirrorG(g, (op.axis * TAU) / teeth));
const applyToIndex = (op, index, teeth) => mod(op.turn !== undefined ? index + op.turn : 2 * op.axis - index, teeth);

/** Facets that became the same plane as an earlier one although the ideal tool kept them apart. */
function mergedPlanes(planes, shape) {
  const seen = new Map();
  let count = 0;
  planes.forEach((plane, i) => {
    if (plane.flat) return;
    const key = `${plane.index}|${plane.m.toFixed(9)}|${plane.c.toFixed(9)}`;
    const first = seen.get(key);
    if (first === undefined) { seen.set(key, i); return; }
    const a = shape[first], b = shape[i];
    if (Math.abs(a.g[0] - b.g[0]) > 1e-6 || Math.abs(a.g[1] - b.g[1]) > 1e-6 || Math.abs(a.c - b.c) > 1e-6) count += 1;
  });
  return count;
}

/**
 * The second rounding: orbits whose facets would merge with a neighbour (an edge
 * with a meet at both ends, azimuths less than a tooth apart, same tooth) move to
 * the other side of their tooth, the move that removes most merges first (ties:
 * the smaller extra turn); each orbit moves at most once. Null when nothing moves.
 */
function separatedRounding({ raw, orbits, orbitOf, indexOf, meets, teeth }) {
  const shared = new Map();
  for (const meet of meets) {
    const ids = meet.planes;
    for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
      const key = `${ids[a]}:${ids[b]}`;
      shared.set(key, (shared.get(key) ?? 0) + 1);
    }
  }
  const edges = [];
  for (const [key, count] of shared) {
    if (count < 2) continue;
    const [i, j] = key.split(":").map(Number);
    if (raw[i].flat || raw[j].flat) continue;
    const gap = Math.abs(raw[i].index - raw[j].index), apart = Math.min(gap, teeth - gap);
    if (apart > 1e-9 && apart < 1) edges.push([i, j]);
  }
  const choice = orbits.map((orbit) => orbit.nearest);
  if (!edges.length) return null;
  const edgesOfOrbit = orbits.map(() => []);
  edges.forEach(([i, j], e) => {
    edgesOfOrbit[orbitOf[i]].push(e);
    if (orbitOf[j] !== orbitOf[i]) edgesOfOrbit[orbitOf[j]].push(e);
  });
  const merged = (e) => indexOf(edges[e][0], choice) === indexOf(edges[e][1], choice);
  const turn = (o, index) => { const d = Math.abs(orbits[o].raw - index); return Math.min(d, teeth - d); };
  const moved = new Set();
  for (let pass = 0; pass < orbits.length; pass++) {
    let best = null;
    for (let e = 0; e < edges.length; e++) {
      if (!merged(e)) continue;
      for (const o of new Set([orbitOf[edges[e][0]], orbitOf[edges[e][1]]])) {
        if (moved.has(o) || orbits[o].alternative === null) continue;
        const before = edgesOfOrbit[o].filter(merged).length;
        choice[o] = orbits[o].alternative;
        const gain = before - edgesOfOrbit[o].filter(merged).length, extra = turn(o, choice[o]) - turn(o, orbits[o].nearest);
        choice[o] = orbits[o].nearest;
        if (gain > 0 && (!best || gain > best.gain || (gain === best.gain && extra < best.extra))) best = { o, gain, extra };
      }
    }
    if (!best) break;
    choice[best.o] = orbits[best.o].alternative;
    moved.add(best.o);
  }
  return moved.size ? choice : null;
}

/**
 * `shape`: [{ g, c, anchor }] at the tool's own slope; `order`: claimed rotation
 * order; `pinFirst`: keep the slope of the first plane and of every plane with
 * the same ideal slope (a tier tool's main tier, split into several orbits on a
 * wheel that does not carry its symmetry).
 */
export function toothSnappedShape(shape, { order = 1, teeth, pinFirst = false }) {
  const raw = shape.map((plane) => {
    const m = Math.hypot(plane.g[0], plane.g[1]);
    return { m, flat: m < 1e-12, index: m < 1e-12 ? 0 : mod((Math.atan2(plane.g[1], plane.g[0]) * teeth) / TAU, teeth) };
  });
  const offTooth = raw.some((plane) => !plane.flat && Math.abs(plane.index - Math.round(plane.index)) * (360 / teeth) > 1e-9);
  // Nothing to round: the ideal tool already sits on whole teeth, every meet stays exact.
  if (!offTooth) {
    return {
      planes: shape.map((plane, i) => ({ index: mod(Math.round(raw[i].index), teeth), m: raw[i].m, c: plane.c, flat: raw[i].flat, exact: true })),
      report: { meets: 0, meetResidual: 0, maxShift: 0, maxSnapDeg: 0, iterations: 0, lostMeets: 0, mergedFacets: 0, shortestEdge: null, idealShortestEdge: null, newShortEdge: false, separated: false, symmetry: null },
    };
  }
  const symmetry = shapeSymmetry(shape, order);
  const { ops, rotation, mirror, axis } = carriedOps(symmetry, teeth);
  const find = planeIndex(shape);
  const orbitOf = new Int32Array(shape.length).fill(-1), opOf = new Array(shape.length).fill(null), orbits = [];
  shape.forEach((plane, i) => {
    if (orbitOf[i] >= 0) return;
    const orbit = orbits.length;
    orbits.push({ representative: i });
    orbitOf[i] = orbit;
    opOf[i] = ops[0];
    for (const op of ops) {
      const g = applyToG(op, plane.g, teeth), j = find(g[0], g[1], plane.c);
      if (j >= 0 && orbitOf[j] < 0) { orbitOf[j] = orbit; opOf[j] = op; }
    }
  });
  // Each representative's nearest tooth, and the other side of it.
  for (const orbit of orbits) {
    const rep = raw[orbit.representative], off = rep.index - Math.round(rep.index);
    Object.assign(orbit, {
      flat: rep.flat, raw: rep.index, m: rep.m,
      nearest: rep.flat ? 0 : mod(Math.round(rep.index), teeth),
      alternative: rep.flat || Math.abs(off) * (360 / teeth) <= 1e-9 ? null : mod(Math.round(rep.index) + Math.sign(off), teeth),
    });
  }
  const indexOf = (i, choice) => (orbits[orbitOf[i]].flat ? 0 : applyToIndex(opOf[i], choice[orbitOf[i]], teeth));

  const idealCells = envelopeCells(shape, { bound: 1.001 });
  const meets = envelopeMeets(shape, { cells: idealCells });
  const idealShortestEdge = envelopeShortestEdge(shape, { cells: idealCells });
  const solveGroup = new Int32Array(orbits.length).fill(-1);
  let groupCount = 0;
  for (const meet of meets) for (const i of meet.planes) if (solveGroup[orbitOf[i]] < 0) solveGroup[orbitOf[i]] = groupCount++;

  const solveWith = (choice) => {
    const index = shape.map((_, i) => indexOf(i, choice));
    const turn = orbits.map((orbit, o) => (orbit.flat ? 0 : Math.min(Math.abs(orbit.raw - choice[o]), teeth - Math.abs(orbit.raw - choice[o])) * (360 / teeth)));
    // Start every rounded plane pivoted about its anchor (the facet keeps passing through its own point).
    const start = orbits.map((orbit, o) => {
      const r = orbit.representative, phi = (choice[o] * TAU) / teeth, anchor = shape[r].anchor;
      return turn[o] > 1e-9 ? anchor[2] + orbit.m * (Math.cos(phi) * anchor[0] + Math.sin(phi) * anchor[1]) : shape[r].c;
    });
    const groups = new Array(groupCount);
    orbits.forEach((orbit, o) => {
      if (solveGroup[o] >= 0) groups[solveGroup[o]] = { m: orbit.flat ? 0 : orbit.m, c: start[o], fixedSlope: orbit.flat || (pinFirst && Math.abs(orbit.m - raw[0].m) < 1e-12) };
    });
    const solved = solveMeets({
      groups,
      planes: shape.map((_, i) => ({ group: solveGroup[orbitOf[i]], cos: Math.cos((index[i] * TAU) / teeth), sin: Math.sin((index[i] * TAU) / teeth) })),
      points: meets.map((meet) => ({ xyz: [meet.xy[0], meet.xy[1], meet.z], planes: meet.planes })),
      reorder: true,
    });
    const planes = shape.map((plane, i) => {
      const o = orbitOf[i], orbit = orbits[o], g = solveGroup[o];
      // A plane already on a whole tooth outside every solved meet keeps its ideal values.
      if (g < 0 && turn[o] <= 1e-9) return { index: mod(Math.round(index[i]), teeth), m: raw[i].m, c: plane.c, flat: raw[i].flat, exact: true };
      return { index: mod(Math.round(index[i]), teeth), m: orbit.flat ? 0 : g >= 0 ? solved.groups[g].m : orbit.m, c: g >= 0 ? solved.groups[g].c : start[o], flat: orbit.flat, exact: false };
    });
    const surface = planes.map((plane) => ({ g: [plane.m * Math.cos((plane.index * TAU) / teeth), plane.m * Math.sin((plane.index * TAU) / teeth)], c: plane.c }));
    // A meet stays a corner of the tool unless another facet now cuts below it.
    const lostMeets = solved.points.filter((p) => p[2] - Math.min(...surface.map((plane) => plane.c - plane.g[0] * p[0] - plane.g[1] * p[1])) > 1e-9).length;
    const shortestEdge = envelopeShortestEdge(surface);
    return {
      planes,
      report: {
        meets: meets.length,
        // In tool-frame units (rim radius 1) at the shape's slope; the layout scales them.
        meetResidual: solved.residual,
        maxShift: solved.maxShift,
        maxSnapDeg: Math.max(0, ...turn),
        iterations: solved.iterations,
        lostMeets,
        mergedFacets: mergedPlanes(planes, shape),
        shortestEdge,
        idealShortestEdge,
        newShortEdge: shortestEdge < 0.01 && shortestEdge < idealShortestEdge * 0.999,
      },
    };
  };
  const rank = ({ report }) => [report.lostMeets, report.newShortEdge ? 1 : 0, report.mergedFacets, report.maxShift];
  const better = (a, b) => { const x = rank(a), y = rank(b); for (let k = 0; k < x.length; k++) if (x[k] !== y[k]) return x[k] < y[k]; return false; };
  const nearest = orbits.map((orbit) => orbit.nearest);
  let result = { ...solveWith(nearest), separated: false };
  const { report } = result;
  if (meets.length && (report.lostMeets || report.newShortEdge || report.mergedFacets)) {
    const choice = separatedRounding({ raw, orbits, orbitOf, indexOf, meets, teeth });
    if (choice) {
      const other = solveWith(choice);
      if (better(other, result)) result = { ...other, separated: true };
    }
  }
  return {
    planes: result.planes,
    report: { ...result.report, separated: result.separated, symmetry: { rotation, mirror, axis, orbits: orbits.length, solvedOrbits: groupCount } },
  };
}
