import {
  COMPOSITE_TOOLS, compositeTool, compositeToolDefaults, compositeToolAngle, normalizeCompositeParams,
  compositeToolLayout, compositeExactGears, compositeToolOrder,
} from '../domain/compositeTools.js';
import { DEFAULT_ARC_CUT, DEFAULT_RING_CUT, normalizeRingCut, ringCutLayout } from '../domain/ringCut.js';
import { DEFAULT_GRID_CUT, DEFAULT_GRID_EDGE_ANGLE, gridCutLayout, gridSymmetryAvailable } from '../domain/gridCut.js';
import { INDEX_GEARS } from '../domain/indexing.js';
import { getCuttingReference, rotationalStockSupportOffset, facetNormal, industryAngleToBetaDeg } from '../domain/faceting.js';
import { gridCutFootprint, fitToolExtent } from './gridFit.js';
import { resolveDraftGeometry } from '../domain/cutConstruction.js';
import { toolHood } from '../domain/compositeHood.js';

/*
 * One interface over every composite tool for the editor: which tool a draft
 * uses, how to start one, change its shape, fit it and read its report. Ring
 * and grid tools keep their own draft fields; the shared composite engine
 * covers the rest. Patches still go through the CUT session's
 * changeDraftWithConstruction → toolDraftPatch path; nothing here dispatches.
 */

export { COMPOSITE_TOOLS };

/** The composite tool a CUT draft uses, or null for an ordinary (symmetric / custom) cut. */
export function activeCompositeTool(draft) {
  if (draft?.composite) return compositeTool(draft.composite.tool);
  if (draft?.grid) return compositeTool('grid');
  if (draft?.ring) return compositeTool(draft.ring.kind === 'arc' ? 'ring-arc' : 'ring-fan');
  return null;
}

/** Shape parameters of the draft's tool, in registry terms. */
export function activeToolParams(draft) {
  const tool = activeCompositeTool(draft);
  if (!tool) return null;
  if (tool.engine === 'ring') return { ...draft.ring };
  if (tool.engine === 'grid') return { ...draft.grid };
  return normalizeCompositeParams(tool.id, draft.composite.params);
}

/** Tools a region can use, grouped for the library. */
export function toolsForRegion(region) {
  return COMPOSITE_TOOLS.filter((tool) => tool.regions.includes(region));
}

/** Radius of the stone's girdle (largest radial distance of a girdle face), or null. */
export function girdleRadius(document, solid) {
  const girdleIds = new Set(document.facets.filter((facet) => facet.region === 'girdle').map((facet) => facet.patternId));
  let radius = 0;
  for (const face of solid.faces ?? []) {
    if (!girdleIds.has(face.sourceOperationId)) continue;
    for (const index of face.vertexIndices) radius = Math.max(radius, Math.hypot(solid.vertices[index].x, solid.vertices[index].y));
  }
  return radius > 0 ? radius : null;
}

/** Depth at which a plane with this direction first touches the solid. */
function contactDepth({ region, index, indexTeeth, industryAngle, reference, solid }) {
  const normal = facetNormal(index, industryAngleToBetaDeg(region, industryAngle), indexTeeth);
  const support = rotationalStockSupportOffset(normal, reference);
  const reach = Math.max(...solid.vertices.map((v) => normal.x * v.x + normal.y * v.y + normal.z * v.z));
  return Math.max(0, support - reach);
}

/**
 * Draft patch that mounts a tool on the current region: shape defaults (or a
 * preset), the region's angle, whole-tooth rotation 0, and a placement that
 * just bites into the current stone (apex at its top or bottom).
 */
export function startToolPatch(toolId, { document, solid, region, indexTeeth, presetParams = null, draft = null }) {
  const tool = compositeTool(toolId);
  if (!tool) throw new RangeError(`未知复合刀具：${toolId}`);
  if (!tool.regions.includes(region)) throw new RangeError(`${tool.label}不能用于${region === 'girdle' ? '腰部' : '该部位'}。`);
  const reference = getCuttingReference(document);
  const zs = solid.vertices.map((vertex) => vertex.z);
  const half = reference.envelope?.halfHeight ?? reference.size / 2, centre = reference.center?.[2] ?? 0;
  const apexDepth = Math.max(0, region === 'pavilion' ? Math.min(...zs) - (centre - half) : centre + half - Math.max(...zs));
  const params = { ...compositeToolDefaults(tool.id, region), ...(presetParams ?? {}) };
  if (tool.engine === 'ring') {
    const ring = normalizeRingCut({ ...(tool.kind === 'arc' ? DEFAULT_ARC_CUT : DEFAULT_RING_CUT), ...params, kind: tool.kind, rotation: 0 }, indexTeeth);
    const angle = region === 'girdle' ? 90 : draft?.industryAngle ?? compositeToolAngle(tool.id, region);
    const layout = ringCutLayout(ring, indexTeeth);
    const depth = contactDepth({ region, index: layout.primaryIndex, indexTeeth, industryAngle: angle, reference, solid }) + 0.02;
    return { ring, industryAngle: angle, depth };
  }
  if (tool.engine === 'grid') {
    return { grid: { ...DEFAULT_GRID_CUT, ...params }, ring: null, patternMode: 'grid', industryAngle: DEFAULT_GRID_EDGE_ANGLE, depth: apexDepth + 0.02, baseIndex: 0 };
  }
  // A tool spans the girdle: its rim sits on the girdle radius when the stone has one.
  const radius = reference.envelope?.radius ?? reference.size / 2;
  const girdle = girdleRadius(document, solid);
  const extent = girdle ? Math.min(1.5, Math.max(0.2, Number((girdle / radius).toFixed(4)))) : 1;
  return {
    composite: { tool: tool.id, params, extent, snap: 'tooth' },
    patternMode: 'composite',
    industryAngle: compositeToolAngle(tool.id, region),
    depth: Number((apexDepth + 0.02).toFixed(6)),
    baseIndex: 0,
  };
}

/** Patch that changes the draft tool's shape parameters. */
export function toolParamsPatch(draft, paramPatch) {
  const tool = activeCompositeTool(draft);
  if (!tool) return {};
  if (tool.engine === 'ring') return { ring: { ...draft.ring, ...paramPatch } };
  if (tool.engine === 'grid') {
    const grid = { ...draft.grid, ...paramPatch };
    // Mirror axes must land on whole teeth; a symmetry the wheel cannot mirror drops the mirror.
    if (grid.mirror && !gridSymmetryAvailable(grid.symmetry, draft.indexTeeth ?? 96, true)) grid.mirror = false;
    return { grid };
  }
  return { composite: { ...draft.composite, params: { ...draft.composite.params, ...paramPatch } } };
}

/** Patch that changes the draft tool's extent (grid range or composite radius). */
export function toolExtentPatch(draft, extent) {
  if (draft?.grid) return { grid: { ...draft.grid, extent } };
  if (draft?.composite) return { composite: { ...draft.composite, extent } };
  return {};
}

export function toolSnapPatch(draft, snap) {
  return draft?.composite ? { composite: { ...draft.composite, snap } } : {};
}

export const toolExtent = (draft) => draft?.grid?.extent ?? draft?.composite?.extent ?? null;

/** Symmetry choices of the grid tool on this wheel (disabled when the wheel cannot hold them). */
export function gridSymmetryChoices(indexTeeth, mirror = true) {
  return [1, 2, 3, 4, 6].map((symmetry) => ({ symmetry, available: gridSymmetryAvailable(symmetry, indexTeeth, mirror) }));
}

/**
 * A uniform report of the draft tool for the panels: facet count, machining
 * groups, symmetry and wheel fit, plus warnings in design language. `impact`
 * (the draft's preview solid) adds what the stone's outline did to the tool.
 */
export function toolReport(draft, { document, region, facets = [], impactSolid = null }) {
  const tool = activeCompositeTool(draft);
  if (!tool) return null;
  const teeth = draft.indexTeeth ?? document.indexGear.teeth;
  const reference = getCuttingReference(document);
  const warnings = [], notes = [];
  let levels = 0, order = 1, exactSymmetry = true, exactGears = null, maxSnapDeg = 0, fractional = 0, meetsSplit = false;
  try {
    if (tool.engine === 'ring') {
      const layout = ringCutLayout(draft.ring, teeth);
      order = layout.ring.symmetry;
      exactSymmetry = layout.exactSymmetry;
      levels = layout.levels.length;
      if (!layout.exactSymmetry) warnings.push(`${teeth} 齿分度盘不能整除 ${order} 边，各边中心分别取整，边距相差 1 齿。`);
      if (layout.merged) warnings.push(`相邻边有 ${layout.merged} 个刻面取整到同一分度，已合并。`);
      if (layout.crossesNeighbours) warnings.push('扇面越过了相邻边的中心，请减小细分间距。');
      if (layout.residual > 0.02) warnings.push('取整后拐点偏离理想弧线超过外接圆半径的 2%。');
      if (layout.degenerate) warnings.push('取整后面数不足以围成外形，请加大凸度。');
    } else if (tool.engine === 'grid') {
      const layout = gridCutLayout(draft.grid, { indexTeeth: teeth, reference, edgeAngle: draft.industryAngle, depth: draft.depth, rotation: Math.round(draft.baseIndex) });
      order = layout.grid.symmetry;
      levels = layout.levels.length;
      maxSnapDeg = layout.report.maxSnapDeg;
      notes.push(layout.report.meets ? `${layout.report.meets} 个多面交点已联合求解（偏差 ${layout.report.meetResidual.toExponential(0)}）` : '每个交点只有三面相交，天然精确');
      if (layout.report.mergedCells) warnings.push(`${layout.report.mergedCells} 个网格单元在整齿取整后重合为同一平面，实际网格被简化；请减少行列数或换分度盘。`);
    } else {
      const layout = compositeToolLayout(draft.composite, { indexTeeth: teeth, reference, angle: draft.industryAngle, depth: draft.depth, rotation: Math.round(draft.baseIndex) });
      order = layout.report.order;
      exactSymmetry = layout.report.exactSymmetry;
      levels = layout.levels.length;
      maxSnapDeg = layout.report.maxSnapDeg;
      fractional = layout.report.fractional;
      if (draft.composite.snap === 'exact') {
        exactGears = compositeExactGears(layout, teeth, [...new Set([...INDEX_GEARS, teeth])]);
        if (fractional) warnings.push(`${fractional} 个刻面落在小数分度；${exactGears.length ? `可整齿加工的分度盘：${exactGears.join('、')}` : '常用分度盘都不能整齿加工'}。`);
      } else if (layout.version === 1) {
        notes.push('此图层保留原整齿算法；编辑与保存不会自动改用新版交点求解。');
        if (maxSnapDeg > 1e-6) warnings.push(`原整齿算法按各面锚点取整，最大方位偏转 ${maxSnapDeg.toFixed(2)}°；多面交点可能分裂。`);
      } else if (maxSnapDeg > 1e-6) {
        // Tooth snapping rounds each symmetry orbit once and joint-solves every meet of four or more faces.
        const r = layout.report, radius = reference.envelope?.radius ?? reference.size / 2;
        const shift = `${((r.maxShift / radius) * 100).toFixed(1)}%`;
        notes.push(r.meets
          ? `已取整到 ${teeth} 齿，最大方位偏转 ${maxSnapDeg.toFixed(2)}°；${r.meets} 个多面交点已联合求解（偏差 ${r.meetResidual.toExponential(0)}，交点最大移动半径的 ${shift}）`
          : `已取整到 ${teeth} 齿，最大方位偏转 ${maxSnapDeg.toFixed(2)}°；每个交点只有三面相交，天然精确`);
        meetsSplit = !r.meetsExact || r.lostMeets > 0;
        if (!r.meetsExact) warnings.push(`整齿取整后多面交点未能求解精确（偏差 ${r.meetResidual.toExponential(0)}）；可在“分度取整”切换“精确小数”。`);
        else if (r.lostMeets) warnings.push(`整齿求解后有 ${r.lostMeets} 个多面交点被相邻刻面切开，不再是尖角；可切换“精确小数”，或选择能整除该对称的分度盘。`);
        if (r.mergedFacets) warnings.push(`${r.mergedFacets} 个刻面在整齿取整后与相邻刻面重合为同一平面，图案被简化；可切换“精确小数”或换分度盘。`);
        if (r.newShortEdge) warnings.push(`整齿取整后刀具出现短于半径 1% 的短棱（${(r.shortestEdge / radius * 100).toFixed(2)}%）；可切换“精确小数”对比。`);
        else if (r.meetShiftLarge) warnings.push(`整齿求解让交点最多移动半径的 ${shift}，造型偏离理想较多；可切换“精确小数”对比。`);
      }
      if (!exactSymmetry) warnings.push(`${teeth} 齿分度盘不能整除 ${order} 次对称，各扇区分别取整，对称性略有偏差。`);
      if (layout.report.dropped) notes.push(`${layout.report.dropped} 个刀面在毛坯包络之外，未生成。`);
    }
  } catch (error) {
    warnings.push(error.message);
  }
  let lostCells = 0, shortEdge = '';
  if (impactSolid && facets.length) {
    const { missing, shortest } = gridCutFootprint(impactSolid, facets.map((facet) => facet.id));
    lostCells = missing.length;
    const radius = reference.envelope?.radius ?? reference.size / 2;
    if (Number.isFinite(shortest) && shortest < radius * 0.01) shortEdge = `${shortest < 1e-4 ? shortest.toExponential(1) : shortest.toFixed(4)} u`;
    if (lostCells === facets.length) warnings.push('刀具还没有切到宝石：请增大深度。');
    else if (lostCells) notes.push(`${lostCells} 个刀面落在宝石外形之外或被其他面覆盖，未形成刻面。`);
    // Where tooth snapping could not keep a meet as a corner, a short edge comes from the
    // tool, not the outline: say so instead of suggesting a fit.
    if (shortEdge && meetsSplit) {
      warnings.push(`整齿取整让多面交点分裂，出现短于半径 1% 的短棱（${shortEdge}）；可在“分度取整”切换“精确小数”对比，或选择能整除的对称与分度盘。`);
    } else if (shortEdge) warnings.push(`外圈有短于半径 1% 的短棱（${shortEdge}）；可点“贴合腰线”。`);
  }
  return { tool, facets: facets.length, levels, order, exactSymmetry, exactGears, maxSnapDeg, fractional, lostCells, warnings, notes };
}

/** "Fit to girdle" for grid and composite tools: the nearest extent that leaves no short edge at the outline. */
export function fitToolToGirdle({ document, draft, region, patternId = null }) {
  if (draft?.grid) {
    return fitToolExtent({
      document, draft, region, patternId,
      extentOf: (current) => current.grid.extent,
      withExtent: (current, extent) => ({ ...current, grid: { ...current.grid, extent } }),
    });
  }
  if (draft?.composite) {
    return fitToolExtent({
      document, draft, region, patternId, limits: [0.2, 1.5],
      extentOf: (current) => current.composite.extent ?? 1,
      withExtent: (current, extent) => ({ ...current, composite: { ...current.composite, extent } }),
    });
  }
  return null;
}

/** Rotational order of the draft's tool (index ring dots). */
export function activeToolOrder(draft) {
  const tool = activeCompositeTool(draft);
  if (!tool) return null;
  if (tool.engine === 'ring') return draft.ring.symmetry;
  if (tool.engine === 'grid') return draft.grid.symmetry;
  return compositeToolOrder(tool.id, draft.composite.params);
}

const previewCache = new Map();

/**
 * The hood of a tool with given (or default) shape on a default reference,
 * for library thumbnails and preset cards. Cached per tool, region, wheel and shape.
 */
export function toolPreviewHood(toolId, { region = 'crown', indexTeeth = 96, params = null } = {}) {
  const key = JSON.stringify([toolId, region, indexTeeth, params]);
  if (previewCache.has(key)) return previewCache.get(key);
  const tool = compositeTool(toolId);
  const reference = { kind: 'cube', size: 2, center: [0, 0, 0] };
  const shape = { ...compositeToolDefaults(toolId, region === 'girdle' ? 'crown' : region), ...(params ?? {}) };
  const side = region === 'pavilion' ? 'pavilion' : 'crown';
  let draft;
  if (tool.engine === 'ring') {
    draft = { industryAngle: 34, depth: 0.25, baseIndex: 0, indexTeeth, repeat: 1, mirrorOffset: 0, patternMode: 'arbitrary', customIndices: '', ring: normalizeRingCut({ ...(tool.kind === 'arc' ? DEFAULT_ARC_CUT : DEFAULT_RING_CUT), ...shape, kind: tool.kind, rotation: 0 }, indexTeeth) };
    const layout = ringCutLayout(draft.ring, indexTeeth);
    draft = { ...draft, customIndices: layout.indices.join(' '), baseIndex: layout.primaryIndex };
  } else if (tool.engine === 'grid') {
    draft = { industryAngle: DEFAULT_GRID_EDGE_ANGLE, depth: 0.1, baseIndex: 0, indexTeeth, patternMode: 'grid', grid: { ...DEFAULT_GRID_CUT, ...shape } };
  } else {
    draft = { industryAngle: compositeToolAngle(toolId, side), depth: 0.1, baseIndex: 0, indexTeeth, patternMode: 'composite', composite: { tool: toolId, params: shape, extent: 0.86, snap: 'tooth' } };
  }
  let hood = null;
  try {
    const { facets } = resolveDraftGeometry(draft, side, reference);
    hood = toolHood({ facets, reference, region: side });
  } catch {
    hood = null;
  }
  if (previewCache.size > 160) previewCache.delete(previewCache.keys().next().value);
  previewCache.set(key, hood);
  return hood;
}
