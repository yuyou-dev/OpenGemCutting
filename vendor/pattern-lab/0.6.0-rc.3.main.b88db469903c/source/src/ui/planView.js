/** DOM-free 2D crown-plan projection and hit-testing, extracted from the
 * original vanilla shell. Canvas pixel painting lives in the React layer;
 * every geometric decision is here so it stays node-testable. */

export const GUIDE_RADII = [0.3, 0.6, 0.9];

export const PLAN_COLORS = Object.freeze({
  guide: '#ebedef',
  faceFill: '#fcfcfc',
  faceFillWithReference: '#ffffff30',
  frostedFill: '#f4d6df',
  selectedFill: '#f9c6d4',
  multiFill: '#fbe0e9',
  faceStroke: '#70767a',
  frostedStroke: '#bb8595',
  selectedStroke: '#ed225d',
  control: '#efb5c5',
  controlSelected: '#ed225d',
  controlRing: '#fff',
  ghost: '#ed225d',
  editHandle: '#ffffff',
  editHandleRing: '#70767a',
  editEdge: '#5f666a',
  lockedOutline: '#9aa0a5',
  requested: '#b47a33',
  caption: '#aaa',
});

/** Pavilion plans are viewed bottom-up, so x is mirrored; flip is ±1 and
 * therefore its own inverse, keeping project/unproject exact inverses. */
export function flipLayout(l, side = 'crown') {
  return { ...l, flip: side === 'pavilion' ? -1 : 1 };
}

export function planLayout(w, h, side = 'crown') {
  return flipLayout({ s: Math.min(w, h) / 2.55, x: w / 2, y: h / 2 - 4 }, side);
}

export function projectPlan(l, p) {
  return [l.x + (l.flip ?? 1) * p[0] * l.s, l.y - p[1] * l.s];
}

export function unprojectPlan(l, px, py) {
  return [((px - l.x) / l.s) * (l.flip ?? 1), -(py - l.y) / l.s];
}

export function containsPoint(poly, p) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** Faces visible from one side of the stone, matching the plan painter. */
export function planSidePredicate(side = 'crown') {
  return side === 'pavilion' ? (f) => f.normal[2] < -0.05 : (f) => f.normal[2] > 0.05;
}

export function hitTestFace(compiled, p, side = 'crown') {
  const visible = planSidePredicate(side);
  return compiled.faces.find((f) => visible(f) && containsPoint(f.points, p)) ?? null;
}

/** radiusPx is a CSS-pixel pick tolerance, converted into plan units. */
export function hitTestControl(plan, l, p, radiusPx = 9) {
  let best = null;
  let distance = radiusPx / l.s;
  for (const plane of plan.planes) {
    if (!plane.control) continue;
    const d = Math.hypot(plane.control[0] - p[0], plane.control[1] - p[1]);
    if (d < distance) {
      best = plane;
      distance = d;
    }
  }
  return best;
}

/** Point-to-segment distance on the plan XY projection (z ignored), with the
 * parameter clamped to the segment so endpoints behave like caps. */
function segmentDistance(a, b, p) {
  const abx = b[0] - a[0], aby = b[1] - a[1];
  const apx = p[0] - a[0], apy = p[1] - a[1];
  const len2 = abx * abx + aby * aby;
  const t = len2 > 0 ? Math.min(1, Math.max(0, (apx * abx + apy * aby) / len2)) : 0;
  return Math.hypot(apx - t * abx, apy - t * aby);
}

/** Nearest editTargets vertex within a CSS-pixel pick tolerance (same
 * screen-space contract as hitTestControl). `targets` is the result of
 * editTargets(compiled, side) for the visible side. */
export function hitTestVertex(targets, l, p, radiusPx = 8) {
  let best = null;
  let bd = radiusPx / l.s;
  for (const v of targets.vertices) {
    const d = Math.hypot(v.point[0] - p[0], v.point[1] - p[1]);
    if (d < bd) {
      bd = d;
      best = v;
    }
  }
  return best;
}

/** Nearest editTargets edge by point-to-segment distance on the XY
 * projection, within a CSS-pixel pick tolerance. */
export function hitTestEdge(targets, l, p, radiusPx = 7) {
  let best = null;
  let bd = radiusPx / l.s;
  for (const e of targets.edges) {
    const d = segmentDistance(e.a, e.b, p);
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  return best;
}

/** The face tool edits its selected face's boundary before its interior.
 * Generator controls are intentionally absent: they are a different tool. */
export function hitTestPlanEdit(tool, compiled, targets, l, p, side = 'crown', selectedFaceId = null, { shiftKey = false, multiSelectMode = false } = {}) {
  // Face multi-selection owns the whole facet, including its boundary handles.
  if (tool === 'face' && (shiftKey || multiSelectMode)) return null;
  if (tool === 'vertex' || tool === 'edge') {
    const hit = tool === 'vertex' ? hitTestVertex(targets, l, p) : hitTestEdge(targets, l, p);
    return hit ? { kind: tool, key: hit.key } : null;
  }
  if (tool !== 'face') return null;
  if (selectedFaceId) {
    const boundary = {
      vertices: targets.vertices.filter((v) => v.planeIds.includes(selectedFaceId)),
      edges: targets.edges.filter((e) => e.planeIds.includes(selectedFaceId)),
    };
    const vertex = hitTestVertex(boundary, l, p);
    if (vertex) return { kind: 'vertex', key: vertex.key };
    const edge = hitTestEdge(boundary, l, p);
    if (edge) return { kind: 'edge', key: edge.key };
  }
  const face = hitTestFace(compiled, p, side);
  return face ? { kind: 'face', key: face.id } : null;
}

/** Locate an existing target in a preview mesh through its incident face IDs.
 * Position keys change during a move, while the face incidence stays useful. */
export function previewTargetPoints(compiled, target) {
  const faces = compiled.baseFaces ?? compiled.faces;
  const incident = target.planeIds.map((id) => faces.find((f) => f.id === id));
  if (!incident.length || incident.some((f) => !f)) return [];
  return incident[0].points.filter((p) =>
    incident.every((f) => f.points.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 1e-7)),
  );
}

// ---- map-like zoom / pan ---------------------------------------------------

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 12;

export function clampZoom(z) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/** Zoom anchored at screen point (cx, cy): the plan point under the cursor
 * stays under the cursor. flip (±1) cancels out of the anchor math. */
export function zoomLayout(l, factor, cx, cy) {
  return { ...l, s: l.s * factor, x: cx - factor * (cx - l.x), y: cy - factor * (cy - l.y) };
}

/** Translate the layout by a screen-space delta. */
export function panLayout(l, dx, dy) {
  return { ...l, x: l.x + dx, y: l.y + dy };
}

/** Compose the base plan layout with the interactive view state: zoom about
 * the base origin, then pan by raw screen px, so `panX/panY` are literal
 * screen offsets and a zoom of 1 with zero pan reproduces the base layout. */
export function viewLayout(base, view = {}) {
  return {
    ...base,
    s: base.s * (view.zoom ?? 1),
    x: base.x + (view.panX ?? 0),
    y: base.y + (view.panY ?? 0),
  };
}
