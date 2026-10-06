import { clipPolyhedronByPlanes, clipPolyhedronPreview, createCenteredCube } from "./geometry.js";
import { layoutLevels } from "./compositeTools.js";

/*
 * The tool as a hood ("罩"): the cutting surface of a multi-facet draft
 * (composite, ring or grid tool) shown as one part mounted on the machine
 * axis and lowered over the stone. A prism around the axis, spanning the
 * draft's half of the reference, is clipped by every draft plane; the faces
 * that lie on a draft plane are the hood. Display and diagnostics only:
 * the cut itself is the ordinary half-space intersection of the same planes.
 */

const PRISM_SIDES = 48;
const prisms = new Map();

/**
 * The space a hood can occupy: a prism around the axis over its half of the
 * reference, cached per reference and rim. The rim follows the stone (a little
 * wider than its outline) so the hood reads as a cover over this stone.
 */
function hoodPrism(reference, region, stoneRadius = null) {
  const radius = reference.envelope?.radius ?? reference.size / 2;
  const half = reference.envelope?.halfHeight ?? reference.size / 2;
  const [cx, cy, cz] = reference.center ?? [0, 0, 0];
  const rim = Number(((stoneRadius ? Math.min(stoneRadius * 1.08, radius * 1.16) : radius * 1.16)).toFixed(4));
  const key = JSON.stringify([rim, half, cx, cy, cz, region]);
  if (prisms.has(key)) return prisms.get(key);
  const sign = region === "pavilion" ? -1 : 1;
  const planes = [];
  for (let k = 0; k < PRISM_SIDES; k++) {
    const a = (2 * Math.PI * k) / PRISM_SIDES;
    planes.push({ normal: { x: Math.cos(a), y: Math.sin(a), z: 0 }, offset: rim + Math.cos(a) * cx + Math.sin(a) * cy, faceId: `hood-wall-${k}` });
  }
  // From the equator to just past the reference top (crown) or bottom (pavilion).
  planes.push({ normal: { x: 0, y: 0, z: -sign }, offset: -sign * cz, faceId: "hood-base" });
  planes.push({ normal: { x: 0, y: 0, z: sign }, offset: sign * cz + half + radius * 0.08, faceId: "hood-cap" });
  const prism = clipPolyhedronByPlanes(createCenteredCube(2 * Math.max(rim, half) + 1, { center: [cx, cy, cz] }), planes);
  if (prisms.size > 8) prisms.delete(prisms.keys().next().value);
  prisms.set(key, prism);
  return prism;
}

/**
 * Hood of resolved draft facets (each with `id`, `plane`, `industryAngleDeg`,
 * `depth`): faces on draft planes with their machining level, its edges, the
 * apex on the axis and the levels. Null when the planes do not close a hood.
 */
export function toolHood({ facets, reference, region, stoneRadius = null }) {
  if (!facets?.length || !["crown", "pavilion"].includes(region)) return null;
  const sign = region === "pavilion" ? -1 : 1;
  const [cx, cy, cz] = reference.center ?? [0, 0, 0];
  // Hood surface height on the axis: the lowest of the planes there.
  const axisHeights = facets.map((facet) => {
    const { normal, offset } = facet.plane;
    return Math.abs(normal.z) < 1e-9 ? Infinity : (offset - normal.x * cx - normal.y * cy) / normal.z;
  }).filter(Number.isFinite);
  if (!axisHeights.length) return null;
  const apexZ = sign > 0 ? Math.min(...axisHeights) : Math.max(...axisHeights);
  const levels = layoutLevels(facets);
  const levelOf = new Map();
  levels.forEach((level, order) => {
    for (const facet of facets) {
      if (`${facet.industryAngleDeg.toFixed(6)}|${facet.depth.toFixed(6)}` === level.key) levelOf.set(facet.id, order);
    }
  });
  let solid;
  try {
    // The indexed preview kernel keeps one polygon per plane and is fast enough to follow a drag.
    solid = clipPolyhedronPreview(hoodPrism(reference, region, stoneRadius), facets.map((facet) => ({ ...facet.plane, faceId: facet.id })));
  } catch {
    return null;
  }
  if (!solid.vertices.length) return null;
  const point = (index) => {
    const v = solid.vertices[index];
    return [v.x, v.y, v.z];
  };
  const faces = solid.faces
    .filter((face) => levelOf.has(face.facetId ?? face.id))
    .map((face) => ({ id: face.facetId ?? face.id, level: levelOf.get(face.facetId ?? face.id), points: face.vertexIndices.map(point) }));
  const edges = new Map();
  for (const face of faces) face.points.forEach((p, i) => {
    const q = face.points[(i + 1) % face.points.length];
    const key = [p, q].map((v) => v.map((x) => x.toFixed(7)).join(",")).sort().join("|");
    if (!edges.has(key)) edges.set(key, [p, q]);
  });
  return { faces, edges: [...edges.values()], apex: [cx, cy, apexZ], levels: levels.length, region };
}

/** Top view of a hood: face polygons in world XY with their level (index 0 points right). */
export function hoodSketch(hood) {
  if (!hood) return null;
  const faces = hood.faces.map((face) => ({ id: face.id, level: face.level, points: face.points.map(([x, y]) => [x, y]) }));
  const radius = Math.max(1e-9, ...faces.flatMap((face) => face.points.map(([x, y]) => Math.hypot(x, y))));
  return { faces, radius, levels: hood.levels };
}
