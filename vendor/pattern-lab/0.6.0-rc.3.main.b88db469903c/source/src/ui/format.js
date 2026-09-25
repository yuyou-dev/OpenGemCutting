import { planeMachine } from '../core/domain/machine.js';

export function gearText(plan) {
  return `${plan.machine.teeth} 齿 / ${plan.metadata?.symmetry ?? '自定义'} 向`;
}

export function footerStateText(plan, compiled, elapsedMs) {
  return `${plan.machine.teeth} 齿 · ${compiled.audit.commandCount} 条指令 / ${compiled.faces.length} 个有效面 · 构建 ${elapsedMs.toFixed(0)} ms`;
}

export function metricsRow(compiled) {
  return {
    effective: compiled.faces.length,
    frosted: compiled.audit.frostedFacets,
    minEdge: compiled.audit.minEdgeMm?.toFixed(4)??'未标定',
    residual: compiled.audit.maxHalfspaceResidual.toExponential(1),
  };
}

export function progressText(p, view) {
  return `${p.sample} / ${p.target} spp · ${p.width ?? 256} × ${p.height ?? p.width ?? 256} 像素 · ${view === 'surface' ? '面身份诊断' : '渐进光学预览'}`;
}

export function export96Title(teeth) {
  return `按 ${teeth} 齿导出公共平面文档，保留精确几何与完整工序。`;
}

export function selectedHelpText(face) {
  if (face.bevel) return '派生细边：通过两侧支撑平面和肩宽生成。可单独改变抛光状态。';
  if (face.table) return '固定水平台面。表面状态可独立切换。';
  return '单面调整可能破坏对称；棱与交点始终来自真实裁切。';
}

/** Filtered face-list rows for the inspection panel. */
export function facetRows(compiled, teeth, query) {
  const q = String(query ?? '').toLowerCase();
  return compiled.faces
    .filter((f) => f.id.toLowerCase().includes(q))
    .map((f) => ({
      id: f.id,
      region: f.region ?? (f.normal[2] > 0 ? 'crown' : f.normal[2] < 0 ? 'pavilion' : 'girdle'),
      group: f.table ? '台面' : f.bevel ? '磨砂细边' : f.stock ? '毛坯表面' : f.group || '独立切面',
      angle: planeMachine(f, teeth).angle,
      finish: f.finish.state,
    }));
}

/** Preserve source operation order; a group name may occur in several regions. */
export function facetGroups(rows, region) {
  const groups = new Map();
  for (const row of rows) {
    if (row.region !== region) continue;
    if (!groups.has(row.group)) groups.set(row.group, { name: row.group, rows: [] });
    groups.get(row.group).rows.push(row);
  }
  return [...groups.values()];
}
