import { createStockSolid } from '../domain/stockGeometry.js';
import {
  clipPolyhedronByPlanes,
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
} from '../domain/faceting.js';
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
const solidCache = new WeakMap();
const inspectionCache = new WeakMap();
export function solveDocument(document) {
  if (!solidCache.has(document))
    solidCache.set(
      document,
      clipPolyhedronByPlanes(
        createStockSolid(document.stock),
        document.facets.map(planeEntry),
      ),
    );
  return solidCache.get(document);
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
  const baseSolid = clipPolyhedronByPlanes(
    createStockSolid(document.stock),
    baseFacets.map(planeEntry),
  );
  const impact = evaluateDraftImpact({
    baseSolid,
    planes: facets.map(planeEntry),
  });
  const policy = resolveDraftCommitPolicy(impact);
  if (policy === 'block')
    throw designError(
      'CUT_BLOCKED',
      impact.error ||
        (impact.solidErased
          ? '该切割会移除全部材料。'
          : impact.noOp
            ? '当前 CUT 没有形成有效面。'
            : '该切割会使台面或腰部结构层整体失效。'),
      { policy, threats: impact.threats },
    );
  const nextFacets = editingPatternId
    ? replacePatternFacets(document.facets, editingPatternId, facets)
    : [...document.facets, ...facets];
  const nextDocument = { ...document, facets: nextFacets };
  // Replacing a layer preserves its original sequence position, including on concave mesh stock.
  const solid = solveDocument(nextDocument);
  const effective = new Set(summarizeEffectiveFacets(solid).effectiveFacetIds);
  if (!facets.some((f) => effective.has(f.id)))
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
  if (!patternId) return solveDocument(document);
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
    baseIndex: first.metadata?.primaryIndex ?? first.baseIndex,
    repeat: first.repeat,
    mirrorOffset: first.mirror,
    patternMode: first.metadata?.patternMode ?? 'symmetric',
    customIndices: facets.map((f) => displayIndex(f.index)).join(' '),
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
    ...(first ? draftForPattern(existing) : defaultDraftForRegion(region)),
    ...operation.draft,
  };
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
      stock: document.stock,
      meet,
      baseSolid: prefix,
    });
    if (solved.meet.status !== 'valid')
      throw designError('MEET_UNREACHABLE', solved.meet.message, solved.meet);
    draft = solved.draft;
    meet = solved.meet;
  }
  const resolved = resolveDraftGeometry(draft, region, document.stock);
  if (resolved.error) throw designError('INVALID_CUT', resolved.error);
  const metadata = {
    ...first?.metadata,
    patternMode: draft.patternMode,
    primaryIndex: draft.baseIndex,
    integerIndexOnly: true,
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
      primaryIndex: draft.baseIndex,
      target: snapshotMeetTarget(meet.target),
      ...(meet.secondTarget
        ? { secondTarget: snapshotMeetTarget(meet.secondTarget) }
        : {}),
    };
  else delete metadata.construction;
  const facets = resolved.facets.map((f) => ({
    ...f,
    id: `${operation.patternId}:${displayIndex(f.index)}`,
    patternId: operation.patternId,
    label: operation.label ?? first?.label ?? operation.patternId,
    metadata,
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
  { scale = 1, deltaZ = 0, rotationTeeth = 0 } = {},
) {
  if (!['crown', 'pavilion'].includes(region))
    throw designError('INVALID_REGION', '整体变换只适用于冠部或亭部。');
  const solid = solveDocument(document);
  const targets = document.facets.filter((f) => f.region === region);
  if (!targets.length)
    throw designError('EMPTY_GROUP', '当前分组没有可变换的 CUT。');
  const girdleIds = new Set(
    document.facets
      .filter((f) => f.region === 'girdle')
      .map((f) => f.patternId),
  );
  const zs = solid.faces
    .filter((f) => girdleIds.has(f.sourceOperationId))
    .flatMap((f) => f.vertexIndices.map((i) => solid.vertices[i].z));
  const center = document.stock.center[2];
  const half = document.stock.kind === 'mesh' ? 0 : document.stock.size / 2;
  const top = zs.length ? Math.max(...zs) : center + half;
  const bottom = zs.length ? Math.min(...zs) : center - half;
  const waist = Math.max(document.stock.size * 0.01, 0.01);
  if (zs.length || document.stock.kind !== 'mesh') {
    if (
      (region === 'crown' && deltaZ < bottom + waist - top) ||
      (region === 'pavilion' && deltaZ > top - waist - bottom)
    )
      throw designError('GIRDLE_PROTECTED', '该位移会消除腰部。');
  }
  let transformed =
    scale === 1
      ? targets
      : scaleFacetsAlongZ(targets, scale, region === 'crown' ? top : bottom, {
          stock: document.stock,
        });
  if (deltaZ)
    transformed = translateFacetsAlongZ(transformed, deltaZ, {
      stock: document.stock,
    });
  if (rotationTeeth) {
    const rotated = new Map(
      rotateFacetsByTeeth(
        transformed.filter((f) => f.metadata?.operationType !== 'table'),
        rotationTeeth,
        { stock: document.stock },
      ).map((f) => [f.id, f]),
    );
    transformed = transformed.map((f) => rotated.get(f.id) ?? f);
  }
  const byId = new Map(transformed.map((f) => [f.id, f]));
  const next = {
    ...document,
    facets: document.facets.map((f) => byId.get(f.id) ?? f),
  };
  const after = solveDocument(next);
  const effective = new Set(summarizeEffectiveFacets(after).effectiveFacetIds);
  const lost = summarizeEffectiveFacets(solid).effectiveFacetIds.filter(
    (id) => !effective.has(id),
  );
  if (!after.vertices.length || lost.length)
    throw designError('TRANSFORM_BLOCKED', '整体变换会消除已有切面。', {
      lost,
    });
  return next;
}

export function planDesign(document, operations) {
  let next = document;
  const changes = [];
  for (const [step, operation] of operations.entries()) {
    validateInput(OPERATION_SCHEMA, operation, `operations[${step}]`);
    try {
      if (operation.kind === 'cut') {
        const result = constructCut(next, operation);
        next = result.document;
        changes.push({
          step,
          patternId: operation.patternId,
          policy: result.policy,
          generated: result.impact.generatedFaceCount,
          threats: result.impact.threats,
        });
      } else if (operation.kind === 'transform') {
        next = transformGroup(next, operation.region, operation);
        changes.push({ step, kind: 'transform', region: operation.region });
      } else {
        const groups = groupFacets(next);
        const group = groups.find((g) => g.id === operation.patternId);
        if (operation.kind !== 'reorder' && !group)
          throw designError('PATTERN_NOT_FOUND', '未找到指定图层。');
        if (
          group?.facets[0].metadata?.operationType === 'table' &&
          operation.kind === 'remove'
        )
          throw designError('TABLE_PROTECTED', '固定台面不能删除。');
        if (operation.kind === 'remove')
          next = {
            ...next,
            facets: next.facets.filter(
              (f) => f.patternId !== operation.patternId,
            ),
          };
        if (operation.kind === 'rename') {
          if (!operation.label)
            throw designError('INVALID_OPERATION', '重命名需要 label。');
          next = {
            ...next,
            facets: next.facets.map((f) =>
              f.patternId === operation.patternId
                ? { ...f, label: operation.label }
                : f,
            ),
          };
        }
        if (operation.kind === 'reorder') {
          if (
            operation.order?.length !== groups.length ||
            new Set(operation.order).size !== groups.length ||
            operation.order.some((id) => !groups.some((g) => g.id === id))
          )
            throw designError(
              'INVALID_ORDER',
              '顺序必须恰好包含全部图层各一次。',
            );
          const table = groups.find(
            (g) => g.facets[0].metadata?.operationType === 'table',
          );
          if (table && operation.order[0] !== table.id)
            throw designError('TABLE_PROTECTED', '固定台面必须保持首层。');
          next = {
            ...next,
            facets: operation.order.flatMap(
              (id) => groups.find((g) => g.id === id).facets,
            ),
          };
        }
        solveDocument(next);
        changes.push({
          step,
          kind: operation.kind,
          patternId: operation.patternId,
        });
      }
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
    requiredConfirmations: [
      ...new Set(
        changes.flatMap((c) =>
          c.policy === 'confirm'
            ? c.threats.filter((t) => t.fullyRemoved).map((t) => t.operationId)
            : [],
        ),
      ),
    ],
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
    geometryIssues,
    stockKind: document.stock.kind ?? 'cube',
    logicalCutPlanes: document.facets.length,
    effectiveCutPlanes: effective.effectiveFacetIds.length,
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
