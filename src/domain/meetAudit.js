/** Advisory measurements of a committed planar solid, never an aesthetic or cut-validity gate.
 * Facet identities come from effective CUT faces; stock patches are not CUTs.
 * EXACT is an analysis clustering tolerance (0.1% of X width), not solver precision.
 */
export const EXACT = 1e-3, NEAR = 1e-2, SPLIT = 0.12;
export function auditSolid(doc, solid) {
  const byId = new Map(doc.facets.map((f) => [f.id, f]));
  const V = solid.vertices;
  const W = Math.max(...V.map((p) => p.x)) - Math.min(...V.map((p) => p.x));
  // one identity per logical facet: mesh stock splits cut faces into ":patch:N" pieces, and all unfaceted stock
  // pieces are one preform surface
  const fid = (f) => { const id = String(f.facetId ?? f.id ?? 'stock').replace(/:patch:\d+$/, ''); return byId.has(id) ? id : 'stock'; };
  const label = (id) => { const f = byId.get(id); return `${f.label || f.id}:${f.displayIndex ?? f.index}`; };
  const role = (id) => {
    const f = byId.get(id);
    if (!f) return 'stock';
    const nz = f.plane.normal.z;
    if (Math.abs(nz) < 1e-6) return 'girdle';
    if (nz > 1 - 1e-9) return 'table';
    if (nz < -1 + 1e-9) return 'culet';
    return nz > 0 ? 'crown' : 'pavilion';
  };
  const vf = V.map(() => new Set());
  for (const f of solid.faces) for (const i of f.vertexIndices) vf[i].add(fid(f));
  // union vertices closer than EXACT·W into meet points
  const parent = V.map((_, i) => i), find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const dist = (a, b) => Math.hypot(V[a].x - V[b].x, V[a].y - V[b].y, V[a].z - V[b].z) / W;
  const pairs = [];
  // only true corners (≥3 distinct facets) take part; points that just subdivide a straight edge are not meets
  const corner = (i) => vf[i].size >= 3;
  // Opposite endpoints of the same vertical girdle edge represent thickness,
  // even when that thickness is smaller than the clustering threshold.
  const thicknessPair = (i, j, facesA = vf[i], facesB = vf[j]) => {
    const sharedGirdles = [...facesA].filter(id => role(id) === 'girdle' && facesB.has(id));
    const sides = ids => new Set([...ids].map(role).filter(r => r !== 'girdle'));
    const a = sides(facesA), b = sides(facesB);
    return sharedGirdles.length >= 1 && Math.hypot(V[i].x - V[j].x, V[i].y - V[j].y) <= W * EXACT
      && ((a.has('crown') && !a.has('pavilion') && b.has('pavilion') && !b.has('crown'))
        || (b.has('crown') && !b.has('pavilion') && a.has('pavilion') && !a.has('crown')));
  };
  const ordered = V.map((_, i) => i).sort((a, b) => V[a].x - V[b].x);
  for (let x = 0; x < ordered.length; x++) for (let y = x + 1; y < ordered.length; y++) {
    const i = ordered[x], j = ordered[y];
    if (V[j].x - V[i].x >= NEAR * W) break;
    if (thicknessPair(i, j)) continue;
    const d = dist(i, j);
    if (d <= EXACT) parent[find(i)] = find(j);
    else if (d < NEAR && corner(i) && corner(j)) pairs.push([i, j, d]);
  }
  const points = new Map();
  for (let i = 0; i < V.length; i++) { const r = find(i); if (!points.has(r)) points.set(r, new Set()); for (const id of vf[i]) points.get(r).add(id); }
  // a near miss is two distinct meet points (after merging exact ones) that are still < NEAR apart
  const nearSeen = new Set(), near = [];
  for (const [i, j, d] of pairs) {
    const a = find(i), b = find(j);
    if (a === b || thicknessPair(a, b, points.get(a), points.get(b))) continue;
    const k = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (nearSeen.has(k)) continue;
    nearSeen.add(k);
    const roles = new Set([...points.get(a), ...points.get(b)].map(role));
    const where = roles.has('table') ? 'table' : roles.has('girdle') || roles.has('stock') ? 'girdle' : roles.has('crown') ? 'crown' : 'pavilion';
    near.push({ d, where, facets: [...new Set([...points.get(a), ...points.get(b)])].filter((id) => byId.has(id)).map(label) });
  }
  const nearMisses = near;
  const exactMeets = [...points.values()].filter((s) => [...s].filter((id) => byId.has(id) && role(id) !== 'girdle').length >= 4).length;
  // facet areas → slivers
  const area = new Map();
  for (const f of solid.faces) {
    const p = f.vertexIndices.map((i) => V[i]);
    let ax = 0, ay = 0, az = 0;
    for (let k = 1; k + 1 < p.length; k++) {
      const u = [p[k].x - p[0].x, p[k].y - p[0].y, p[k].z - p[0].z], v = [p[k + 1].x - p[0].x, p[k + 1].y - p[0].y, p[k + 1].z - p[0].z];
      ax += u[1] * v[2] - u[2] * v[1]; ay += u[2] * v[0] - u[0] * v[2]; az += u[0] * v[1] - u[1] * v[0];
    }
    area.set(fid(f), (area.get(fid(f)) ?? 0) + Math.hypot(ax, ay, az) / 2);
  }
  const byRole = {};
  for (const [id, a] of area) if (byId.has(id)) (byRole[role(id)] ??= []).push(a);
  const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
  const slivers = [...area].filter(([id, a]) => byId.has(id) && ['crown', 'pavilion'].includes(role(id)) && a < 0.15 * median(byRole[role(id)]))
    .map(([id, a]) => ({ facet: label(id), role: role(id), ofMedian: +(a / median(byRole[role(id)])).toFixed(3) }));
  const effectiveIds = new Set(solid.faces.map(fid));
  const table = [...byId.values()].find((f) => effectiveIds.has(f.id) && role(f.id) === 'table');
  const tableCorners = table ? new Set(V.map((_, i) => i).filter((i) => vf[i].has(table.id) && corner(i)).map(find)).size : 0;
  // girdle levelness: heights of the corners where crown / pavilion facets meet FACETED girdle facets (preform walls,
  // e.g. a heart's cleft, are reported separately as raw pieces); professional designs keep both lines level
  const isGirdle = (id) => byId.has(id) && Math.abs(byId.get(id).plane.normal.z) < 1e-6;
  const side = (i, want) => [...vf[i]].some((id) => byId.has(id) && !isGirdle(id) && (byId.get(id).plane.normal.z > 0) === want);
  const onGirdle = (i) => [...vf[i]].some(isGirdle);
  const zTop = V.filter((_, i) => onGirdle(i) && side(i, true)).map((p) => p.z), zBot = V.filter((_, i) => onGirdle(i) && side(i, false)).map((p) => p.z);
  const spread = (z) => (z.length ? (Math.max(...z) - Math.min(...z)) / W : 0);
  // where the girdle is left as unfaceted preform wall, the facets meet it at their own heights: report that spread too
  // (acceptable only where the outline needs a preformed wall, e.g. a heart's cleft)
  const onWall = (i) => vf[i].has('stock');
  const wTop = V.filter((_, i) => onWall(i) && side(i, true)).map((p) => p.z), wBot = V.filter((_, i) => onWall(i) && side(i, false)).map((p) => p.z);
  const count = (w) => nearMisses.filter((n) => n.where === w).length;
  // split meets and the share of multi-facet meets among interior corners (off the girdle and the preform wall).
  // A short ridge is only a candidate: intentional facet layouts can also contain it.
  const offGirdle = (r) => [...points.get(r)].every((id) => byId.has(id) && role(id) !== 'girdle');
  const inner = [...points.keys()].filter((r) => points.get(r).size >= 3 && offGirdle(r));
  const multiMeetShare = inner.length ? inner.filter((r) => points.get(r).size >= 4).length / inner.length : 1;
  const edgeFacets = new Map();
  for (const f of solid.faces) for (let k = 0; k < f.vertexIndices.length; k++) {
    const a = f.vertexIndices[k], b = f.vertexIndices[(k + 1) % f.vertexIndices.length];
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (!edgeFacets.has(key)) edgeFacets.set(key, new Set());
    edgeFacets.get(key).add(fid(f));
  }
  const ridgeEnds = new Map();                                  // facet pair → the corner points on that ridge
  for (const [key, ids] of edgeFacets) {
    if (ids.size !== 2 || [...ids].some((id) => !byId.has(id) || role(id) === 'girdle')) continue;
    const pair = [...ids].sort().join('|');
    for (const v of key.split(':').map(Number)) if (corner(v)) { if (!ridgeEnds.has(pair)) ridgeEnds.set(pair, new Set()); ridgeEnds.get(pair).add(find(v)); }
  }
  const splitMeets = [];
  for (const [pair, ends] of ridgeEnds) {
    if (ends.size !== 2) continue;
    const [a, b] = [...ends];
    if (points.get(a).size !== 3 || points.get(b).size !== 3 || !offGirdle(a) || !offGirdle(b)) continue;
    // the same azimuth means two tiers of one facet column (a deliberate step such as P2:6|P3:6), not a meet that came apart
    const [p, q] = pair.split('|').map((id) => byId.get(id).plane.normal);
    const tilted = Math.hypot(p.x, p.y) > 1e-6 && Math.hypot(q.x, q.y) > 1e-6;      // a table or culet has no azimuth
    if (tilted && Math.abs(((Math.atan2(p.y, p.x) - Math.atan2(q.y, q.x)) * 180 / Math.PI + 540) % 360 - 180) < 0.5) continue;
    const d = dist(a, b);
    if (d < SPLIT) splitMeets.push({ d, facets: pair.split('|').map(label) });
  }
  return {
    name: doc.name, W: +W.toFixed(4), facets: new Set(solid.faces.map(fid).filter((id) => byId.has(id))).size,
    meetPoints: points.size, exactMeets, nearMisses: nearMisses.length,
    nearByRegion: { table: count('table'), crown: count('crown'), girdle: count('girdle'), pavilion: count('pavilion') },
    girdleSpread: { crown: zTop.length ? +(spread(zTop) * 100).toFixed(2) + '%' : null, pavilion: zBot.length ? +(spread(zBot) * 100).toFixed(2) + '%' : null },
    girdleLevel: zTop.length && zBot.length ? spread(zTop) < 0.005 && spread(zBot) < 0.005 : null,
    rawWallSpread: { crown: +(spread(wTop) * 100).toFixed(2) + '%', pavilion: +(spread(wBot) * 100).toFixed(2) + '%' },
    multiMeetShare: +multiMeetShare.toFixed(3), splitMeets: splitMeets.length,
    slivers: slivers.length, rawGirdlePieces: solid.faces.filter((f) => fid(f) === 'stock').length, tableCorners,
    worst: nearMisses.sort((a, b) => b.d - a.d).slice(0, 10).map((n) => ({ ofW: +(n.d * 100).toFixed(2) + '%', where: n.where, facets: n.facets.join(' ') })),
    sliverList: slivers.slice(0, 6),
    splitList: splitMeets.sort((a, b) => a.d - b.d).slice(0, 8).map((m) => ({ ofW: +(m.d * 100).toFixed(1) + '%', ridge: m.facets.join('|') })),
  };
}

