import { facetMetadataAfterParameterEdit } from '../domain/facetSurface.js';
import { resolveGroupReference } from '../domain/groupReference.js';
import { indexExportSummary } from '../domain/indexing.js';
import { getCuttingReference } from '../domain/faceting.js';
import { updateConcaveTool } from './concaveTools.js';
import { evaluatePlanarDocument, evaluateDocument } from '../domain/documentGeometry.js';
import {
  measurePolyhedron,
} from '../domain/geometry.js';
import {
  validateFacetingDocument,
  createAddFacetsCommand,
  createReplacePatternCommand,
  replacePatternFacets,
  displayIndex,
  exportFacetingJSON,
  importFacetingJSON,
  scaleFacetsAlongZ,
  translateFacetsAlongZ,
  rotateFacetsByTeeth,
  createFacetingDocument,
  createReplaceDocumentCommand,
  normalizeDocumentSchema,
  normalizeIndex,
} from '../domain/faceting.js';
import { assertDocumentImportBudget } from '../domain/importBudget.js';
import { indexCompatibilityReport } from '../domain/indexing.js';
import { defaultDraftForRegion } from '../domain/cutSession.js';
import {
  planeEntry,
  resolveDraftGeometry,
  solveDraftConstruction,
  snapshotMeetTarget,
} from '../domain/cutConstruction.js';
import { buildConstructionStages } from '../domain/constructionHistory.js';
import {
  enumerateTopologyVertices,
  enumerateTopologyEdges,
  createEdgeMeetTarget,
  evaluateDraftImpact,
  resolveDraftCommitPolicy,
  summarizeEffectiveFacets,
} from '../domain/meetJump.js';
import { inspectPresetPolyhedron } from '../domain/presetQuality.js';
import { validateMeshSolid } from '../domain/mesh/index.js';
import { OPERATION_SCHEMA, validateInput } from './designContract.js';

export function designError(code, message, details) {
  return Object.assign(new Error(message), { code, details });
}
const inspectionCache = new WeakMap();
export function solveDocument(document) {
  return evaluateDocument(document);
}
export function groupFacets(document) {
  const groups = new Map();
  for (const facet of document.facets) {
    if (!groups.has(facet.patternId)) groups.set(facet.patternId, []);
    groups.get(facet.patternId).push(facet);
  }
  return [...groups].map(([id, facets]) => ({ id, facets }));
}

/** Shared final CUT gate for manual draft commits and automated batch planning. */
export function preparePatternCommit(
  document,
  facets,
  editingPatternId = null,
) {
  const baseFacets = document.facets.filter(
    (f) => f.patternId !== editingPatternId,
  );
  const baseSolid = evaluatePlanarDocument(document, { facets: baseFacets });
  const impact = evaluateDraftImpact({
    baseSolid,
    planes: facets.map(planeEntry),
  });
  const editingExisting = Boolean(editingPatternId && document.facets.some((f) => f.patternId === editingPatternId));
  // Editing a saved, fully covered layer still updates useful construction
  // parameters. Its final contribution may remain zero until later cuts go.
  const policy = resolveDraftCommitPolicy(impact, { allowNoOp: editingExisting });
  if (policy === 'block')
    throw designError(
      'CUT_BLOCKED',
      impact.error ||
        (impact.solidErased
          ? '该切割会移除全部材料。'
          : impact.noOp
            ? '当前 CUT 没有形成有效面。'
            : '当前切割无法形成有效实体。'),
      { policy, threats: impact.threats },
    );
  const nextFacets = editingPatternId
    ? replacePatternFacets(document.facets, editingPatternId, facets)
    : [...document.facets, ...facets];
  const nextDocument = normalizeDocumentSchema({ ...document, facets: nextFacets });
  // Replacing a layer preserves its original sequence position, including on concave mesh stock.
  const solid = solveDocument(nextDocument);
  const effective = new Set(summarizeEffectiveFacets(evaluatePlanarDocument(nextDocument)).effectiveFacetIds);
  if (!editingExisting && !facets.some((f) => effective.has(f.id)))
    throw designError('CUT_BLOCKED', '当前 CUT 在完整工序中没有形成有效面。');
  return {
    document: nextDocument,
    solid,
    impact,
    policy,
    command: editingPatternId
      ? createReplacePatternCommand(editingPatternId, facets)
      : createAddFacetsCommand(facets),
  };
}

export function constructionPrefix(document, patternId) {
  if (!patternId) return evaluatePlanarDocument(document);
  const stage = buildConstructionStages(document).find(
    (item) => item.id === patternId,
  );
  if (!stage) throw designError('PATTERN_NOT_FOUND', `未找到图层 ${patternId}`);
  return stage.beforeSolid;
}
export function topologyOf(solid) {
  const vertices = enumerateTopologyVertices(solid);
  return {
    vertices,
    edges: enumerateTopologyEdges(solid, { targets: vertices }),
  };
}
export function lookupTarget(solid, key, ratio) {
  const { vertices, edges } = topologyOf(solid);
  const vertex = vertices.find((item) => item.topologyKey === key);
  if (vertex) return vertex;
  const edge = edges.find(
    (item) => item.topologyKey === key || item.edgeTopologyKey === key,
  );
  if (edge && Number.isFinite(ratio)) return createEdgeMeetTarget(edge, ratio);
  throw designError(
    'TARGET_NOT_FOUND',
    '目标不在该层之前的真实施工阶段中；请重新读取顶点/棱。',
    { key },
  );
}
export function draftForPattern(facets) {
  const first = facets[0];
  return {
    industryAngle: first.industryAngleDeg,
    depth: first.depth,
    indexTeeth: first.indexTeeth ?? 96,
    baseIndex: first.metadata?.primaryIndex ?? first.baseIndex,
    repeat: first.repeat,
    mirrorOffset: first.mirror,
    patternMode: first.metadata?.patternMode ?? 'symmetric',
    customIndices: facets.map((f) => displayIndex(f.index, f.indexTeeth ?? 96)).join(' '),
    preform: Boolean(first.metadata?.preform),
  };
}
function constructCut(document, operation) {
  if (!operation.patternId)
    throw designError('INVALID_OPERATION', 'CUT 需要稳定的 patternId。');
  const existing = document.facets.filter(
    (f) => f.patternId === operation.patternId,
  );
  const first = existing[0];
  const region = first?.region ?? operation.region;
  if (!region) throw designError('INVALID_OPERATION', '新 CUT 需要 region。');
  if (first && operation.region && first.region !== operation.region)
    throw designError('LOCKED_REGION', '编辑不能更改已保存 CUT 的部位。');
  let draft = {
    ...(first ? draftForPattern(existing) : defaultDraftForRegion(region, { indexTeeth: document.indexGear.teeth })),
    ...operation.draft,
  };
  if (draft.indexTeeth !== document.indexGear.teeth)
    throw designError('INDEX_GEAR_MISMATCH', '平面切割必须使用项目分度盘。');
  const table = first?.metadata?.operationType === 'table';
  if (
    (table &&
      (draft.industryAngle !== 0 ||
        draft.repeat !== 1 ||
        draft.mirrorOffset !== 0 ||
        draft.patternMode !== 'symmetric')) ||
    (region === 'girdle' && draft.industryAngle !== 90)
  )
    throw designError(
      'LOCKED_PARAMETER',
      '固定台面和腰部的角度/轨道必须遵守工作台结构约束。',
    );
  let meet = operation.meet?.clear
    ? null
    : (first?.metadata?.construction ?? null);
  if (operation.meet?.a || meet) {
    if (table || region === 'girdle')
      throw designError('MEET_UNAVAILABLE', '固定台面和腰部不支持 Meet。');
    const prefix = constructionPrefix(
      document,
      first ? operation.patternId : null,
    );
    if (operation.meet?.a)
      meet = {
        target: lookupTarget(prefix, operation.meet.a, operation.meet.ratioA),
        ...(operation.meet.b
          ? {
              secondTarget: lookupTarget(
                prefix,
                operation.meet.b,
                operation.meet.ratioB,
              ),
            }
          : {}),
      };
    const solved = solveDraftConstruction({
      draft,
      region,
      stock: getCuttingReference(document),
      meet,
      baseSolid: prefix,
    });
    if (solved.meet.status !== 'valid')
      throw designError('MEET_UNREACHABLE', solved.meet.message, solved.meet);
    draft = solved.draft;
    meet = solved.meet;
  }
  const resolved = resolveDraftGeometry(draft, region, getCuttingReference(document));
  if (resolved.error) throw designError('INVALID_CUT', resolved.error);
  const metadata = {
    ...first?.metadata,
    patternMode: draft.patternMode,
    primaryIndex: normalizeIndex(draft.baseIndex, draft.indexTeeth),
    integerIndexOnly: resolved.facets.every((facet) => Number.isInteger(facet.index)),
    preform: draft.preform,
  };
  if (table || region === 'girdle') delete metadata.preform;
  if (meet)
    metadata.construction = {
      type: meet.secondTarget
        ? 'dual-meet'
        : meet.target.kind === 'edge-point'
          ? 'edge-meet'
          : 'vertex-meet',
      solverVersion: 2,
      primaryIndex: normalizeIndex(draft.baseIndex, draft.indexTeeth),
      target: snapshotMeetTarget(meet.target),
      ...(meet.secondTarget
        ? { secondTarget: snapshotMeetTarget(meet.secondTarget) }
        : {}),
    };
  else delete metadata.construction;
  const facets = resolved.facets.map((f) => ({
    ...f,
    id: `${operation.patternId}:${displayIndex(f.index, f.indexTeeth ?? 96)}`,
    patternId: operation.patternId,
    label: operation.label ?? first?.label ?? operation.patternId,
    metadata: facetMetadataAfterParameterEdit(f, document.facets.filter(old => old.patternId === operation.patternId), metadata),
  }));
  return preparePatternCommit(
    document,
    facets,
    first ? operation.patternId : null,
  );
}

export function transformGroup(
  document,
  region,
  { scale = 1, deltaZ = 0, rotationTeeth = 0, indexTeeth = document.indexGear.teeth } = {},
) {
  if (!['crown', 'pavilion'].includes(region))
    throw designError('INVALID_REGION', '整体变换只适用于冠部或亭部。');
  const solid = solveDocument(document);
  const targets = document.facets.filter((f) => f.region === region);
  if (!targets.length)
    throw designError('EMPTY_GROUP', '当前分组没有可变换的 CUT。');
  const { top, bottom } = resolveGroupReference(document);
  let transformed =
    scale === 1
      ? targets
      : scaleFacetsAlongZ(targets, scale, region === 'crown' ? top : bottom, {
          stock: getCuttingReference(document),
        });
  if (deltaZ)
    transformed = translateFacetsAlongZ(transformed, deltaZ, {
      stock: getCuttingReference(document),
    });
  if (rotationTeeth) {
    const rotated = new Map(
      rotateFacetsByTeeth(
        transformed.filter((f) => f.metadata?.operationType !== 'table'),
        rotationTeeth,
        { stock: getCuttingReference(document), indexTeeth },
      ).map((f) => [f.id, f]),
    );
    transformed = transformed.map((f) => rotated.get(f.id) ?? f);
  }
  const byId = new Map(transformed.map((f) => [f.id, f]));
  const next = normalizeDocumentSchema({
    ...document,
    facets: document.facets.map((f) => byId.get(f.id) ?? f),
  });
  const after = solveDocument(next);
  const effective = new Set(summarizeEffectiveFacets(after).effectiveFacetIds);
  const lost = summarizeEffectiveFacets(solid).effectiveFacetIds.filter(
    (id) => !effective.has(id),
  );
  if (!after.vertices.length || measurePolyhedron(after).volume <= 1e-10)
    throw designError('TRANSFORM_BLOCKED', '整体变换会移除全部材料。', {
      lost,
    });
  return next;
}

/** Independent portable parameter groups; no derived mesh or editor state. */
export const PARAMETER_GROUP_TABLE = Object.freeze({
  stock: Object.freeze({ field: 'stock', label: '底胚' }),
  planar: Object.freeze({ field: 'facets', label: '平面切割' }),
  concave: Object.freeze({ field: 'concaveCuts', label: '凹面加工' }),
});

export function exportParameterGroup(document, group) {
  const entry = PARAMETER_GROUP_TABLE[group];
  if (!entry) throw designError('INVALID_PARAMETER_GROUP', '请选择底胚、平面切割或凹面加工参数组。');
  return {
    kind: 'facet-parameter-group', schemaVersion: 1, group,
    [entry.field]: structuredClone(document[entry.field] ?? []),
    ...(group === 'planar' ? { indexGear: document.indexGear, cuttingReference: getCuttingReference(document), machining: indexExportSummary(document) } : {}),
  };
}

export function prepareParameterGroupReplacement(document, parameterGroup) {
  const { group } = parameterGroup ?? {};
  if (group === 'stock') throw designError('STOCK_LOCKED', '底胚只在新建项目时选择，编辑中不能更换或缩放。');
  const entry = PARAMETER_GROUP_TABLE[group];
  if (!entry || parameterGroup.kind !== 'facet-parameter-group' || parameterGroup.schemaVersion !== 1)
    throw designError('INVALID_PARAMETER_GROUP', '参数组文件格式或版本不受支持。');
  const allowed = new Set(['kind', 'schemaVersion', 'group', entry.field, ...(group === 'planar' ? ['indexGear', 'cuttingReference', 'machining'] : [])]);
  if (Object.keys(parameterGroup).some((key) => !allowed.has(key)) || parameterGroup[entry.field] === undefined)
    throw designError('INVALID_PARAMETER_GROUP', '文件必须只包含所选参数组，不可同时替换其他参数。');
  if (group === 'planar' && parameterGroup.cuttingReference && JSON.stringify(parameterGroup.cuttingReference) !== JSON.stringify(getCuttingReference(document)))
    throw designError('REFERENCE_MISMATCH', '切割坐标不一致，请将此文件作为新项目打开。');
  const value = group === 'planar' && Array.isArray(parameterGroup.facets)
    ? parameterGroup.facets.map(facet => ({ ...facet, indexTeeth: facet.indexTeeth ?? parameterGroup.indexGear?.teeth ?? 96 }))
    : parameterGroup[entry.field];
  const input = { ...document, [entry.field]: value };
  assertDocumentImportBudget(input);
  // The factory keeps authored parameters while deriving their planes against
  // the fixed cutting reference. It also upgrades v3 only
  // when needed and applies the same canonical JSON validation as file import.
  const next = createFacetingDocument(input);
  const solid = solveDocument(next);
  if (!solid.vertices.length || measurePolyhedron(solid).volume <= 1e-10)
    throw designError('EMPTY_SOLID', '这组参数会移除全部材料；当前设计已保留。');
  return {
    document: next,
    solid,
    command: createReplaceDocumentCommand(next, { description: `替换${entry.label}参数` }),
  };
}

// A drag's final operation is also its commit. Keep only the latest prepared
// result per immutable base document so pointer-up does not solve it again.
const concavePreparations = new WeakMap();
export function prepareConcaveTool(document, operation) {
  const key = JSON.stringify(operation);
  const cached = concavePreparations.get(document);
  if (cached?.key === key) return cached.prepared;
  const prepared = prepareParameterGroupReplacement(document, { kind: 'facet-parameter-group', schemaVersion: 1, group: 'concave', concaveCuts: updateConcaveTool(document, operation) });
  concavePreparations.set(document, { key, prepared });
  return prepared;
}

function requirePattern(document, patternId) {
  const facets = document.facets.filter((facet) => facet.patternId === patternId);
  if (!facets.length) throw designError('PATTERN_NOT_FOUND', '未找到指定图层。');
  return facets;
}

/** Same operation dispatch for browser commands, batch plans and MCP. */
export const DESIGN_OPERATION_TABLE = Object.freeze({
  cut(document, operation) {
    const result = constructCut(document, operation);
    return { document: result.document, change: { patternId: operation.patternId, policy: result.policy, generated: result.impact.generatedFaceCount, threats: result.impact.threats } };
  },
  transform(document, operation) {
    return { document: transformGroup(document, operation.region, operation), change: { kind: operation.kind, region: operation.region } };
  },
  'concave-tool'(document, operation) {
    return { document: prepareConcaveTool(document, operation).document, change: { kind: operation.kind, toolId: operation.toolId } };
  },
  'replace-parameters'(document, operation) {
    return { document: prepareParameterGroupReplacement(document, operation.parameterGroup).document, change: { kind: operation.kind, group: operation.parameterGroup.group } };
  },
  remove(document, operation) {
    const facets = requirePattern(document, operation.patternId);
    if (facets[0].metadata?.operationType === 'table') throw designError('TABLE_PROTECTED', '固定台面不能删除。');
    return { document: { ...document, facets: document.facets.filter((f) => f.patternId !== operation.patternId) }, change: { kind: operation.kind, patternId: operation.patternId } };
  },
  rename(document, operation) {
    requirePattern(document, operation.patternId);
    if (!operation.label) throw designError('INVALID_OPERATION', '重命名需要 label。');
    return { document: { ...document, facets: document.facets.map((f) => f.patternId === operation.patternId ? { ...f, label: operation.label } : f) }, change: { kind: operation.kind, patternId: operation.patternId } };
  },
  reorder(document, operation) {
    const groups = groupFacets(document);
    if (operation.order?.length !== groups.length || new Set(operation.order).size !== groups.length || operation.order.some((id) => !groups.some((g) => g.id === id)))
      throw designError('INVALID_ORDER', '顺序必须恰好包含全部图层各一次。');
    const table = groups.find((g) => g.facets[0].metadata?.operationType === 'table');
    if (table && operation.order[0] !== table.id) throw designError('TABLE_PROTECTED', '固定台面必须保持首层。');
    return { document: { ...document, facets: operation.order.flatMap((id) => groups.find((g) => g.id === id).facets) }, change: { kind: operation.kind } };
  },
});

export function planDesign(document, operations) {
  let next = document;
  const changes = [];
  for (const [step, operation] of operations.entries()) {
    validateInput(OPERATION_SCHEMA, operation, `operations[${step}]`);
    try {
      const result = DESIGN_OPERATION_TABLE[operation.kind](next, operation);
      next = result.document;
      solveDocument(next);
      changes.push({ step, ...result.change });
    } catch (error) {
      error.details = { ...error.details, step, operation };
      throw error;
    }
  }
  const validation = validateFacetingDocument(next);
  if (!validation.valid)
    throw designError(
      'INVALID_DOCUMENT',
      '方案不符合文档契约。',
      validation.errors,
    );
  const solid = solveDocument(next);
  if (measurePolyhedron(solid).volume <= 1e-10)
    throw designError('EMPTY_SOLID', '方案未保留非零体积。');
  return {
    document: next,
    changes,
    // Preserved for existing bridge clients; coverage no longer requires a
    // second approval because every operation remains in undoable history.
    requiredConfirmations: [],
  };
}
export function inspectDesign(document) {
  if (inspectionCache.has(document)) return inspectionCache.get(document);
  const solid = solveDocument(document);
  const effective = summarizeEffectiveFacets(solid);
  const stages = buildConstructionStages(document);
  const dimensions = Object.fromEntries(
    ['x', 'y', 'z'].map((k) => [
      k,
      solid.vertices.length
        ? Math.max(...solid.vertices.map((v) => v[k])) -
          Math.min(...solid.vertices.map((v) => v[k]))
        : 0,
    ]),
  );
  const roundtrip = solveDocument(
    importFacetingJSON(exportFacetingJSON(document)),
  );
  const measured = measurePolyhedron(solid);
  let geometryIssues = [];
  if (solid.kind === 'mesh') {
    try {
      validateMeshSolid(solid);
    } catch (error) {
      geometryIssues = [
        { code: error.code ?? 'INVALID_MESH', message: error.message },
      ];
    }
  } else geometryIssues = inspectPresetPolyhedron(solid).issues;
  const result = {
    name: document.name,
    indexGear: { ...document.indexGear },
    concaveCuts: document.concaveCuts ?? [],
    geometryIssues,
    stockKind: document.stock.kind ?? 'cube',
    logicalCutPlanes: document.facets.length,
    effectiveCutPlanes: document.facets.filter((f) => effective.effectiveFacetIds.includes(f.id)).length,
    parameterGroups: { stock: document.stock.kind, planar: document.facets.length, concave: document.concaveCuts?.length ?? 0 },
    indexCompatibility: {
      all: indexCompatibilityReport(document),
      final: indexCompatibilityReport(document, { effectiveFacetIds: effective.effectiveFacetIds, scope: 'final' }),
    },
    stockSurfacePieces: solid.faces.filter((f) => f.region === 'rough').length,
    surfacePieces: solid.faces.length,
    metrics: {
      volume: measured.volume,
      surfaceArea: measured.surfaceArea,
      centroid: measured.centroid,
    },
    dimensions,
    roundtripVolumeError: Math.abs(
      measurePolyhedron(roundtrip).volume - measurePolyhedron(solid).volume,
    ),
    groups: stages.map((s) => ({
      patternId: s.id,
      label: s.facets[0].label,
      region: s.facets[0].region,
      draft: draftForPattern(s.facets),
      generatedPlanes: s.facets.length,
      effectivePlanes: s.facets.filter((f) =>
        effective.effectiveFacetIds.includes(f.id),
      ).length,
      construction: s.construction,
    })),
  };
  inspectionCache.set(document, result);
  return result;
}
