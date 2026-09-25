import { add, sub, length, pointKey, dot } from '../domain/math.js';
import { topology } from '../domain/polyhedron.js';
import { compilePlan } from './patternPlan.js';
import { solveLocalOffsets } from './localEditSolver.js';

const operable = (f) => f.bevel !== true && !f.stock;
const visibleOn = (f, side) => side === 'pavilion' ? f.normal[2] < -0.05 : f.normal[2] > 0.05;
const girdle = (f) => Math.abs(f.normal[2]) < 1e-9;
const vertexIdentity = (ids) => `vertex:${[...ids].sort().join('|')}`;
const edgeIdentity = (ids) => `edge:${[...ids].sort().join('|')}`;
const mean = (points) => points.reduce((sum, p) => add(sum, p), [0, 0, 0]).map((x) => x / points.length);
const rotate = (p, angle) => [p[0] * Math.cos(angle) - p[1] * Math.sin(angle), p[0] * Math.sin(angle) + p[1] * Math.cos(angle), p[2] ?? 0];
const same = (a, b, tolerance = 1e-7) => length(sub(a, b)) < tolerance;
const validXY = (value) => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);

const meshCache = new WeakMap();
function mesh(compiled) {
  if (meshCache.has(compiled)) return meshCache.get(compiled);
  const supportFaces = compiled.baseFaces;
  const faces = supportFaces.filter(operable), faceById = new Map(supportFaces.map(f => [f.id, f]));
  const t = topology(supportFaces), incident = t.vertices.map(() => new Set());
  for (const [id, indices] of t.faceVertices) for (const index of indices) incident[index].add(id);
  const indexed = t.vertices.map((point, i) => {
    const planeIds = [...incident[i]].sort();
    return { key: pointKey(point), point, planeIds, identity: vertexIdentity(planeIds), boundary: planeIds.some(id => girdle(faceById.get(id))) };
  });
  const vertices = indexed.filter(v => v.planeIds.length >= 3);
  const edges = t.edges.filter(e => e.faces.length === 2).map(e => {
    const a = indexed[e.a], b = indexed[e.b];
    return { key: [a.key,b.key].sort().join('|'), identity: edgeIdentity(e.faces), a:a.point, b:b.point,
      vertexIds:[a.identity,b.identity], planeIds:[...e.faces].sort(), boundary:e.faces.some(id=>girdle(faceById.get(id))) };
  });
  const verticesByFace = new Map([...t.faceVertices].map(([id, indices]) => [id, indices.map(i=>indexed[i])]));
  const result = { vertices, edges, faces, faceById, verticesByFace, vertexById:new Map(vertices.map(v=>[v.identity,v])) };
  meshCache.set(compiled, result);
  return result;
}

export function editTargets(compiled, side = 'crown') {
  const m = mesh(compiled);
  const visible = (ids) => ids.some((id) => operable(m.faceById.get(id)) && visibleOn(m.faceById.get(id), side));
  return {
    vertices: m.vertices.filter((v) => visible(v.planeIds)),
    edges: m.edges.filter((e) => visible(e.planeIds)),
    faces: m.faces.filter((f) => visibleOn(f, side)).map((f) => ({
      id: f.id, identity: `face:${f.id}`, point: mean(f.points),
      boundary: m.verticesByFace.get(f.id).some(v => v.boundary),
    })),
  };
}

function handle(m, op) {
  if (op.kind === 'vertex.move') {
    const v = m.vertices.find((v) => v.key === op.vertexKey || v.identity === op.vertexKey);
    if (!v) return { error: 'UNKNOWN_VERTEX', message: '该交点不在可编辑网格上。' };
    if (!validXY(op.target)) return { error: 'BAD_TARGET', message: '目标位置无效。' };
    return { vertices: [v], delta: [op.target[0] - v.point[0], op.target[1] - v.point[1]], planeIds: v.planeIds };
  }
  if (op.kind === 'edge.move') {
    const edge = m.edges.find((e) => e.key === op.edgeKey || e.identity === op.edgeKey);
    if (!edge) return { error: 'UNKNOWN_EDGE', message: '该棱不在可编辑网格上。' };
    if (!validXY(op.delta)) return { error: 'BAD_DELTA', message: '位移无效。' };
    return { vertices: edge.vertexIds.map((id) => m.vertexById.get(id)), delta: op.delta, planeIds: edge.planeIds };
  }
  if (op.kind === 'face.move') {
    const face = m.faceById.get(op.faceId);
    if (!face || !operable(face) || girdle(face)) return { error: 'UNKNOWN_FACE', message: '请选择当前平面图中的切面。' };
    if (!validXY(op.delta)) return { error: 'BAD_DELTA', message: '位移无效。' };
    return { vertices: m.verticesByFace.get(face.id), delta: op.delta, planeIds: [face.id] };
  }
  return { error: 'UNKNOWN_OP', message: `未知编辑操作：${op.kind ?? '（无）'}` };
}

function unchanged(plan, delta, reason = '') {
  return {
    planes: plan.planes, affectedIds: [], warnings: reason ? [reason] : [], fallbacks: [], unchanged: true,
    edit: { requestedDelta: [...delta], actualDelta: [0, 0], limited: length(delta) > 1e-10, reason, maxDisplacementMm: 0, maxHeightMm: 0 },
  };
}

function symmetryTargets(m, selected, count) {
  const targets = [];
  for (let i = 0; i < count; i++) {
    const angle = 2 * Math.PI * i / count, delta = rotate(selected.delta, angle).slice(0, 2);
    for (const vertex of selected.vertices) {
      const p = rotate(vertex.point, angle);
      const match = i === 0 ? vertex : m.vertices.find((v) => same(v.point, p));
      if (!match) return { error: 'SYMMETRY_UNAVAILABLE', message: '当前图案已不对称，找不到对应交点。请关闭对称联动后局部编辑。' };
      targets.push({ identity: match.identity, delta });
    }
  }
  return { targets };
}

function neighborhood(m, targets, rings = 1) {
  const distances = new Map(targets.map((t) => [t.identity, 0]));
  for (let depth = 0; depth < 5; depth++) for (const edge of m.edges) {
    const [a, b] = edge.vertexIds;
    if (distances.get(a) === depth && !distances.has(b)) distances.set(b, depth + 1);
    if (distances.get(b) === depth && !distances.has(a)) distances.set(a, depth + 1);
  }
  const seedPlanes = new Set(targets.flatMap((t) => m.vertexById.get(t.identity).planeIds));
  const patch = new Set(seedPlanes);
  for (let ring=0;ring<rings;ring++) {
    const previous=new Set(patch);
    for (const v of m.vertices) if (v.planeIds.some((id) => previous.has(id))) for (const id of v.planeIds) patch.add(id);
  }
  return { patch, distances };
}

function localSolution(plan, m, selectedPlaneIds, targets, settings, count) {
  const { patch, distances } = neighborhood(m, targets, settings.patchRings ?? 1);
  const direction = selectedPlaneIds.reduce((s, id) => s + m.faceById.get(id).normal[2], 0) < 0 ? -1 : 1;
  const eligible = (p) => !p.stock && (girdle(p) ? !settings.lockOutline : p.normal[2] * direction > 0.05);
  // Stock faces support real vertices but are immutable, never CUT variables.
  const planeById = new Map([...m.faceById, ...plan.planes.map((p) => [p.id, p])]);
  const variables = new Set([...patch].filter((id) => eligible(planeById.get(id)))), symmetryPairs = [];
  if (count > 1) for (const id of [...variables]) {
    const p = planeById.get(id);
    for (let i = 1; i < count; i++) {
      const normal = rotate(p.normal, 2 * Math.PI * i / count);
      const other = plan.planes.find((q) => same(q.normal, normal) && Math.abs(q.offset - p.offset) < 1e-7 && m.faceById.has(q.id));
      if (!other) return { error: 'SYMMETRY_UNAVAILABLE', message: '当前切面已不对称，请关闭对称联动后局部编辑。' };
      variables.add(other.id);
      symmetryPairs.push([id, other.id]);
    }
  }
  return solveLocalOffsets({ vertices: m.vertices, planeById, variableIds: [...variables], targets, distances, symmetryPairs, preserveConnectivity: !targets.some(t => t.hard), heightLimit: settings.heightLimit });
}

// With fixed normals, vertex trajectories are linear. Bound the step before a
// vertex reaches another plane, instead of discovering collisions by rebuilding.
function connectivityLimit(plan, m, solution) {
  let limit = 1;
  const supports = new Map([...m.faceById, ...plan.planes.map(p => [p.id, p])]);
  for (const v of m.vertices) {
    const movement = solution.movements.get(v.identity) ?? [0,0,0];
    for (const p of supports.values()) {
      if (v.planeIds.includes(p.id)) continue;
      const closing = dot(p.normal, movement) - (solution.offsets.get(p.id) ?? 0);
      if (closing <= 1e-14) continue;
      const clearance = Math.max(0, p.offset - dot(p.normal, v.point));
      limit = Math.min(limit, Math.max(0, clearance - 1e-12) / closing);
    }
  }
  return limit;
}

function changedPlanes(plan, offsets, amount) {
  return plan.planes.map((p) => {
    const delta = (offsets.get(p.id) ?? 0) * amount;
    if (Math.abs(delta) < 1e-12) return p;
    const next = { ...p, offset: p.offset + delta };
    delete next.control;
    delete next.generator;
    return next;
  });
}

function topologyPreserved(before, candidate) {
  const after = mesh(candidate);
  if (before.faces.length !== after.faces.length || before.vertices.length !== after.vertices.length || before.edges.length !== after.edges.length) return false;
  if (before.faces.some((f) => !after.faceById.has(f.id))) return false;
  return before.vertices.every((v) => after.vertexById.has(v.identity));
}

function displacement(before, candidate, selected, mm) {
  const after = mesh(candidate);
  let maxDisplacement = 0, maxHeight = 0;
  for (const v of before.vertices) {
    const next = after.vertexById.get(v.identity);
    if (!next) continue;
    const delta = sub(next.point, v.point);
    maxDisplacement = Math.max(maxDisplacement, length(delta));
    maxHeight = Math.max(maxHeight, Math.abs(delta[2]));
  }
  const deltas = selected.vertices.map((v) => sub(after.vertexById.get(v.identity).point, v.point));
  return { actualDelta: mean(deltas).slice(0, 2), maxDisplacementMm: maxDisplacement * mm, maxHeightMm: maxHeight * mm };
}

function merge(plan, compiled, m, op, options, count) {
  const a = m.vertices.find((v) => v.key === op.vertexKeyA || v.identity === op.vertexKeyA);
  const b = m.vertices.find((v) => v.key === op.vertexKeyB || v.identity === op.vertexKeyB);
  const adjacent = a && b && m.edges.find((e) => e.vertexIds.includes(a.identity) && e.vertexIds.includes(b.identity));
  if (!adjacent || a === b) return { error: 'NOT_ADJACENT', message: '两个交点不相邻，无法合并。' };
  const targets = [], pairs = [];
  for (let i = 0; i < count; i++) {
    const angle = 2 * Math.PI * i / count;
    const source = m.vertices.find((v) => same(v.point, rotate(a.point, angle)));
    const target = m.vertices.find((v) => same(v.point, rotate(b.point, angle)));
    if (!source || !target) return { error: 'SYMMETRY_UNAVAILABLE', message: '当前图案找不到对应交点，请关闭对称联动后合并。' };
    pairs.push({ source, target, mergedIdentity: vertexIdentity([...new Set([...source.planeIds, ...target.planeIds])]) });
    targets.push({ identity: source.identity, delta: sub(target.point, source.point), hard: true });
    targets.push({ identity: target.identity, delta: [0, 0, 0], hard: true });
  }
  const solution = localSolution(plan, m, adjacent.planeIds, targets, options, count);
  if (solution.error === 'SYMMETRY_UNAVAILABLE') return solution;
  if (solution.error) return { error: 'MERGE_NOT_LOCAL', message: '局部邻域内无法同时保留现有切面并合并这两个点；请先调整附近形状。' };
  const planes = changedPlanes(plan, solution.offsets, 1);
  let candidate;
  try { candidate = compilePlan({ ...plan, planes }); } catch { /* Infeasible merge stays untouched. */ }
  const after = candidate && mesh(candidate);
  const mergingIds = new Set(pairs.flatMap(({ source, target }) => [source.identity, target.identity]));
  const preserved = after && m.vertices.every((v) => mergingIds.has(v.identity) || after.vertexById.has(v.identity));
  if (!candidate?.audit.passed || !preserved || after.vertices.length !== m.vertices.length - count || after.edges.length !== m.edges.length - count || after.faces.length !== m.faces.length || !pairs.every((pair) => same(after.vertexById.get(pair.mergedIdentity)?.point ?? [Infinity, 0, 0], pair.target.point))) {
    return { error: 'MERGE_NOT_LOCAL', message: '这次合并无法限制在局部邻域并保留周边结构，请选择相邻的较短棱。' };
  }
  const mm = compiled.audit.mmPerUnit;
  const movements = [...solution.movements.values()];
  const maximum = Math.max(0, ...movements.map(length)) * mm;
  const height = Math.max(0, ...movements.map((v) => Math.abs(v[2]))) * mm;
  const mergeMm = length(sub(b.point, a.point)) * mm;
  if (maximum > mergeMm * 2.5 || height > Math.min(0.25, mergeMm * 0.5)) {
    return { error: 'MERGE_NOT_LOCAL', message: '这次合并会过多牵动周边形状，请选择更近的交点。' };
  }
  const actualDelta = sub(b.point, a.point).slice(0, 2);
  return {
    planes, affectedIds: planes.filter((p, i) => p !== plan.planes[i]).map((p) => p.id),
    warnings: ['交点已合并；相连的短棱已收拢。'], fallbacks: [], previewCompiled: candidate,
    edit: { requestedDelta: actualDelta, actualDelta, limited: false, reason: '', maxDisplacementMm: maximum, maxHeightMm: height },
  };
}

/** Fixed normals retain integer indices and cutting angles. Nearby heights may
 * move slightly; the path search stops before connectivity changes. Merge is an
 * explicit exception. previewCompiled precedes controller-owned group changes. */
export function applyPlanEdit(plan, compiled, op, options = {}) {
  const settings = { lockOutline: true, symmetry: false, ...options }, m = mesh(compiled);
  const count = settings.symmetry ? plan.metadata?.symmetry : 1;
  if (settings.symmetry && (!Number.isInteger(count) || count < 2 || plan.machine.teeth % count !== 0)) {
    return { error: 'SYMMETRY_UNAVAILABLE', message: '当前设计没有可用的对称组信息，请关闭对称联动后局部编辑。' };
  }
  if (op?.kind === 'vertex.merge') return merge(plan, compiled, m, op, settings, count);
  if (!['vertex.move', 'edge.move', 'face.move'].includes(op?.kind)) return { error: 'UNKNOWN_OP', message: `未知编辑操作：${op?.kind ?? '（无）'}` };
  const selected = handle(m, op);
  if (selected.error) return selected;
  if (length(selected.delta) < 1e-10) return unchanged(plan, selected.delta);
  const expanded = symmetryTargets(m, selected, count);
  if (expanded.error) return expanded;
  const requestedMm = length(selected.delta) * compiled.audit.mmPerUnit;
  const solution = localSolution(plan, m, selected.planeIds, expanded.targets, {...settings, patchRings: 2, heightLimit: Math.min(0.05,requestedMm*0.5)/compiled.audit.mmPerUnit}, count);
  if (solution.error) return solution;
  const maximumMm = Math.min(0.25, requestedMm * 2.5), heightMm = Math.min(0.05, requestedMm * 0.5);
  const movements = [...solution.movements.values()];
  const maximum = Math.max(0, ...movements.map(length)) * compiled.audit.mmPerUnit;
  const height = Math.max(0, ...movements.map((v) => Math.abs(v[2]))) * compiled.audit.mmPerUnit;
  const topologyLimit = connectivityLimit(plan, m, solution);
  const limit = Math.min(topologyLimit, maximum ? maximumMm / maximum : 1, height ? heightMm / height : 1);
  if (!movements.length || maximum < 1e-8) return unchanged(plan, selected.delta, settings.lockOutline ? '已到达当前约束允许的位置；外轮廓保持锁定。' : '已到达当前切面约束允许的位置。');
  if (limit * requestedMm < 0.000001) return unchanged(plan, selected.delta, '附近切面或短棱限制了这个方向的移动；继续拖动会改变连接关系。');
  let best = null, low = 0, high = limit;
  for (let attempt = 0; attempt < 11; attempt++) {
    const amount = attempt === 0 ? limit : (low + high) / 2;
    const planes = changedPlanes(plan, solution.offsets, amount);
    let candidate;
    try { candidate = compilePlan({ ...plan, planes }); } catch { /* Search closer to the starting shape. */ }
    if (candidate?.audit.passed && topologyPreserved(m, candidate)) {
      best = { planes, candidate, amount };
      low = amount;
      if (attempt === 0) break;
    } else high = amount;
    if (high * requestedMm < 0.000001) break;
  }
  if (!best || best.amount * requestedMm < 0.000001) return unchanged(plan, selected.delta, '已到达局部可调整范围；继续拖动会改变周边切面。');
  const measured = displacement(m, best.candidate, selected, compiled.audit.mmPerUnit);
  const limited = length(sub(measured.actualDelta, selected.delta)) > Math.max(1e-7, length(selected.delta) * 0.001);
  const reason = limited ? (topologyLimit < 1 ? '附近切面或短棱限制了移动范围；已停在保留连接关系的可行位置。' : '已协调邻面，移动达到当前局部约束允许的范围。') : '';
  return {
    planes: best.planes, affectedIds: best.planes.filter((p, i) => p !== plan.planes[i]).map((p) => p.id),
    warnings: reason ? [reason] : [], fallbacks: [], previewCompiled: best.candidate,
    edit: { requestedDelta: [...selected.delta], ...measured, limited, reason },
  };
}
