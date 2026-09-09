/** Compare a reference-derived junction graph with the final solid, not construction prefixes. */
export function inspectTopology(solid, plan) {
  if (!plan) return { status: 'unassessed', issues: ['未提供独立的参考拓扑清单，不能判定造型通过。'] };
  const issues = [], nodes = new Map(), identities = solid.faces.map(f => f.facetId ?? f.id);
  const incident = solid.vertices.map(() => new Set());
  const edgeFaces = new Map();
  solid.faces.forEach((face, f) => {
    for (const i of face.vertexIndices) incident[i].add(identities[f]);
    face.vertexIndices.forEach((a, i) => {
      const b = face.vertexIndices[(i + 1) % face.vertexIndices.length];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (!edgeFaces.has(key)) edgeFaces.set(key, { a, b, faces: new Set() });
      edgeFaces.get(key).faces.add(identities[f]);
    });
  });
  if (!plan.nodes?.length || !Array.isArray(plan.edges) || !plan.edges.length) issues.push('清单须包含非空 nodes 和 edges。');
  for (const node of plan.nodes ?? []) {
    if (nodes.has(node.id)) { issues.push(`${node.id}: 重复节点`); continue; }
    if (!node.reference || !Array.isArray(node.facets) || new Set(node.facets).size < 3) {
      issues.push(`${node.id}: 须说明参考位置并指定至少三个不同刻面`); continue;
    }
    const candidates = incident.flatMap((faces, i) => node.facets.every(f => faces.has(f)) ? [i] : []);
    if (candidates.length !== 1) issues.push(`${node.id}: 应有唯一共点，实际 ${candidates.length} 个`);
    else if (node.exact && incident[candidates[0]].size !== node.facets.length) issues.push(`${node.id}: 共点出现额外刻面`);
    nodes.set(node.id, { ...node, vertex: candidates.length === 1 ? candidates[0] : null });
  }
  for (const [from, to] of plan.edges ?? []) {
    const a = nodes.get(from), b = nodes.get(to);
    if (!a || !b || a.vertex === null || b.vertex === null) { issues.push(`${from} → ${to}: 端点未通过`); continue; }
    const pair = a.facets.filter(f => b.facets.includes(f));
    if (pair.length !== 2) { issues.push(`${from} → ${to}: 棱应由两个共同刻面支撑`); continue; }
    const adjacency = new Map();
    for (const edge of edgeFaces.values()) if (pair.every(f => edge.faces.has(f))) {
      for (const [u, v] of [[edge.a, edge.b], [edge.b, edge.a]]) {
        if (!adjacency.has(u)) adjacency.set(u, []);
        adjacency.get(u).push(v);
      }
    }
    const queue = [a.vertex], visited = new Set(queue);
    for (let i = 0; i < queue.length; i++) for (const v of adjacency.get(queue[i]) ?? []) if (!visited.has(v)) { visited.add(v); queue.push(v); }
    if (!visited.has(b.vertex)) issues.push(`${from} → ${to}: 缺失真实连接棱`);
  }
  return { status: issues.length ? 'failed' : 'passed', checkedNodes: nodes.size, checkedEdges: plan.edges?.length ?? 0, issues, scope: '只检查清单覆盖的连接关系；清单是否忠于参考、是否完整，仍须等尺度目视审查。' };
}
