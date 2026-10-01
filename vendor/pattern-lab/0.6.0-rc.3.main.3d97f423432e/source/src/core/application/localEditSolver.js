import { cross, dot } from '../domain/math.js';

// With fixed normals, vertex displacements are linear in plane offsets.
function basis(rows, size) {
  const result = [];
  for (const item of rows) {
    const v = [...item.row];
    let value = item.value ?? 0;
    for (let pass = 0; pass < 2; pass++) for (const q of result) {
      const amount = dot(v, q.row);
      for (let i = 0; i < size; i++) v[i] -= amount * q.row[i];
      value -= amount * q.value;
    }
    const norm = Math.hypot(...v);
    if (norm > 1e-9) result.push({ row: v.map((x) => x / norm), value: value / norm });
    else if (Math.abs(value) > 1e-8) return null;
  }
  return result;
}

function nullspace(constraints, size) {
  const equations = basis(constraints, size);
  if (!equations) return null;
  const fixed = equations.map((q) => q.row), free = [];
  for (let i = 0; i < size; i++) {
    const v = Array(size).fill(0);
    v[i] = 1;
    for (let pass = 0; pass < 2; pass++) for (const q of [...fixed, ...free]) {
      const amount = dot(v, q);
      for (let j = 0; j < size; j++) v[j] -= amount * q[j];
    }
    const norm = Math.hypot(...v);
    if (norm > 1e-8) free.push(v.map((x) => x / norm));
  }
  const origin = Array.from({ length: size }, (_, i) => equations.reduce((sum, q) => sum + q.row[i] * q.value, 0));
  return { free, origin };
}

function positiveSolver(matrix) {
  const n = matrix.length, lower = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
    let value = matrix[i][j];
    for (let k = 0; k < j; k++) value -= lower[i][k] * lower[j][k];
    lower[i][j] = i === j ? Math.sqrt(Math.max(value, 1e-14)) : value / lower[j][j];
  }
  return rhs => {
    const y = Array(n).fill(0), x = Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      let value = rhs[i];
      for (let j = 0; j < i; j++) value -= lower[i][j] * y[j];
      y[i] = value / lower[i][i];
    }
    for (let i = n - 1; i >= 0; i--) {
      let value = y[i];
      for (let j = i + 1; j < n; j++) value -= lower[j][i] * x[j];
      x[i] = value / lower[i][i];
    }
    return x;
  };
}

function solvePositive(matrix, rhs) { return positiveSolver(matrix)(rhs); }

// Feasible active-set minimization: a short edge constrains the local solution,
// rather than scaling every useful motion down to that edge's first collision.
function constrainedMinimum(matrix, rhs, free, origin, contact) {
  const solve = positiveSolver(matrix), optimum = solve(rhs), count = rhs.length;
  let current = Array(count).fill(0);
  const active = [];
  for (let iteration = 0; iteration < 128; iteration++) {
    const multipliers = active.length ? solvePositive(
      active.map(a => active.map(b => dot(a.row, b.inverse))),
      active.map(a => dot(a.row, optimum) - a.bound),
    ) : [];
    const candidate = optimum.map((x,i) => x - active.reduce((sum,a,j)=>sum+a.inverse[i]*multipliers[j],0));
    const direction = candidate.map((x,i)=>x-current[i]);
    const hit = contact(current, direction, new Set(active.map(a=>a.key)));
    if (hit) {
      current = current.map((x,i)=>x+hit.amount*direction[i]);
      const row = free.map(q=>dot(q,hit.row)), norm = Math.hypot(...row);
      if (norm < 1e-12) break;
      const normalized = row.map(x=>x/norm);
      active.push({key:hit.key,row:normalized,bound:(hit.bound-dot(hit.row,origin))/norm,inverse:solve(normalized)});
      continue;
    }
    current = candidate;
    let release = -1;
    for (let i=0;i<multipliers.length;i++) if (multipliers[i] < -1e-9 && (release < 0 || multipliers[i] < multipliers[release])) release=i;
    if (release < 0) break;
    active.splice(release,1);
  }
  return current;
}

function vertexRows(vertex, planes, variables) {
  const ids = vertex.planeIds;
  let chosen = null, determinant = 0;
  for (let i = 0; i < ids.length - 2; i++) for (let j = i + 1; j < ids.length - 1; j++) for (let k = j + 1; k < ids.length; k++) {
    const normals = [ids[i], ids[j], ids[k]].map((id) => planes.get(id).normal);
    const det = dot(normals[0], cross(normals[1], normals[2]));
    if (Math.abs(det) > Math.abs(determinant)) {
      determinant = det;
      chosen = { ids: [ids[i], ids[j], ids[k]], normals };
    }
  }
  if (!chosen || Math.abs(determinant) < 1e-10) return null;
  const { normals } = chosen;
  const columns = [cross(normals[1], normals[2]), cross(normals[2], normals[0]), cross(normals[0], normals[1])];
  const rows = Array.from({ length: 3 }, () => Array(variables.size).fill(0));
  chosen.ids.forEach((id, column) => {
    if (!variables.has(id)) return;
    for (let axis = 0; axis < 3; axis++) rows[axis][variables.get(id)] = columns[column][axis] / determinant;
  });
  return rows;
}

export function solveLocalOffsets({ vertices, planeById, variableIds, targets, distances, symmetryPairs = [], preserveConnectivity = false, heightLimit = Infinity }) {
  const variables = new Map(variableIds.map((id, i) => [id, i])), size = variables.size;
  if (!size) return { offsets: new Map(), movements: new Map() };
  const rowsByVertex = new Map(), constraints = [];
  for (const vertex of vertices) {
    if (!vertex.planeIds.some((id) => variables.has(id))) continue;
    const rows = vertexRows(vertex, planeById, variables);
    if (!rows) return { error: 'DEGENERATE_VERTEX', message: '这个交点附近的切面过于接近平行，暂时无法稳定微调。' };
    rowsByVertex.set(vertex.identity, rows);
    if (vertex.planeIds.length > 3) for (const id of vertex.planeIds) {
      const normal = planeById.get(id).normal;
      const row = Array.from({ length: size }, (_, j) => normal.reduce((s, x, axis) => s + x * rows[axis][j], 0));
      if (variables.has(id)) row[variables.get(id)] -= 1;
      constraints.push({ row });
    }
  }
  for (const [a, b] of symmetryPairs) {
    const row = Array(size).fill(0);
    if (variables.has(a)) row[variables.get(a)] += 1;
    if (variables.has(b)) row[variables.get(b)] -= 1;
    constraints.push({ row });
  }
  for (const target of targets.filter((t) => t.hard)) {
    const rows = rowsByVertex.get(target.identity);
    if (!rows && lengthSquared(target.delta) > 1e-16) return { error: 'EDIT_CONSTRAINTS', message: '当前锁定范围内无法到达这个位置。' };
    rows?.forEach((row, axis) => constraints.push({ row, value: target.delta[axis] }));
  }
  const space = nullspace(constraints, size);
  if (!space) return { error: 'EDIT_CONSTRAINTS', message: '当前切面约束无法同时保留这些交点。' };
  const { free, origin } = space, count = free.length;
  const matrix = Array.from({ length: count }, () => Array(count).fill(0)), rhs = Array(count).fill(0);
  function addRow(row, value, weight) {
    const projected = free.map((q) => dot(q, row));
    const relative = value - dot(row, origin);
    for (let i = 0; i < count; i++) {
      rhs[i] += weight * projected[i] * relative;
      for (let j = 0; j <= i; j++) matrix[i][j] += weight * projected[i] * projected[j];
    }
  }
  for (const [identity, rows] of rowsByVertex) {
    const weight = (1 + (distances.get(identity) ?? 4)) ** 2;
    rows.forEach((row, axis) => addRow(row, 0, weight * (axis === 2 ? 9 : 1)));
  }
  for (const target of targets) {
    if (target.hard) continue;
    const rows = rowsByVertex.get(target.identity);
    if (!rows) continue;
    addRow(rows[0], target.delta[0], 1e6);
    addRow(rows[1], target.delta[1], 1e6);
  }
  for (let i = 0; i < count; i++) {
    matrix[i][i] += 1e-8;
    for (let j = 0; j < i; j++) matrix[j][i] = matrix[i][j];
  }
  // Keep a fixed numerical clearance: repeatedly leaving 1% of a short edge
  // eventually shrinks it below the clipping/welding tolerance and freezes editing.
  const planes = [...planeById.values()];
  const contacts = preserveConnectivity ? vertices.map((vertex,vi) => {
    const rows = rowsByVertex.get(vertex.identity);
    return { rows, heightKeys:[-(vi*2+1),-(vi*2+2)], planes:planes.flatMap((plane,pi)=> {
      const index=variables.get(plane.id);
      if (vertex.planeIds.includes(plane.id) || (!rows && index===undefined)) return [];
      return [{normal:plane.normal,index,key:vi*planes.length+pi,bound:Math.max(0,plane.offset-dot(plane.normal,vertex.point)-2e-9)}];
    }) };
  }) : [];
  function contact(current, direction, active) {
    const position = origin.map((x,i)=>x+free.reduce((sum,q,j)=>sum+q[i]*current[j],0));
    const step = origin.map((_,i)=>free.reduce((sum,q,j)=>sum+q[i]*direction[j],0));
    let hit = null, amount = 1;
    for (const vertex of contacts) {
      const {rows} = vertex;
      const movement = rows?.map(row=>dot(row,position)) ?? [0,0,0];
      const velocity = rows?.map(row=>dot(row,step)) ?? [0,0,0];
      if (rows && Number.isFinite(heightLimit)) for (const [i,sign] of [-1,1].entries()) {
        const key = vertex.heightKeys[i], closing = sign * velocity[2];
        if (active.has(key) || closing <= 1e-14) continue;
        const fraction = Math.max(0,(heightLimit-sign*movement[2])/closing);
        if (fraction < amount) { amount=fraction; hit={key,amount,row:rows[2].map(x=>sign*x),bound:heightLimit}; }
      }
      for (const {normal,index,key,bound} of vertex.planes) {
        if (active.has(key)) continue;
        const closing = normal[0]*velocity[0]+normal[1]*velocity[1]+normal[2]*velocity[2] - (step[index] ?? 0);
        if (closing <= 1e-14) continue;
        const clearance = bound - normal[0]*movement[0]-normal[1]*movement[1]-normal[2]*movement[2] + (position[index] ?? 0);
        const fraction = Math.max(0,clearance/closing);
        if (fraction >= amount) continue;
        amount = fraction;
        const row = Array.from({length:size},(_,j)=>normal.reduce((sum,x,axis)=>sum+x*(rows?.[axis][j] ?? 0),0)-(index===j?1:0));
        hit = {key,amount,row,bound};
      }
    }
    return hit;
  }
  const coefficients = preserveConnectivity ? constrainedMinimum(matrix,rhs,free,origin,contact) : solvePositive(matrix, rhs);
  const offsets = Array.from({ length: size }, (_, i) => free.reduce((sum, q, j) => sum + q[i] * coefficients[j], origin[i]));
  return {
    offsets: new Map(variableIds.map((id, i) => [id, offsets[i]])),
    movements: new Map([...rowsByVertex].map(([identity, rows]) => [identity, rows.map((row) => dot(row, offsets))])),
  };
}

const lengthSquared = (v) => dot(v, v);
