import { clipPolyhedronByPlanes, createCenteredCube } from "./geometry.js";
import { MEET_STATUS, resolvePersistedMeetTarget, solveDualMeet } from "./meetJump.js";

const REASONS = {
  "source-hidden": "来源层已隐藏",
  "source-missing": "来源层已删除",
  "source-order": "来源层不在当前工序之前",
  "topology-missing": "来源顶点或棱已不存在",
  "geometry-changed": "来源几何已变化",
  "primary-missing": "主切面已不存在",
  "duplicate-points": "两个约束点重合",
  "non-unique-angle": "两个约束点不能确定唯一角度",
  "angle-out-of-range": "双点约束角度超出部位范围",
  "negative-depth": "双点约束需要负深度",
  "plane-mismatch": "已保存切面不再经过约束点",
};

/** Diagnose intent against the construction prefix; never rewrite saved explicit planes. */
export function diagnoseSavedConstruction({ facets, beforeSolid, precedingPatternIds, allPatternIds, stock, hiddenPatternIds = [] }) {
  const construction = facets[0]?.metadata?.construction;
  if (!construction) return null;
  const primaryIndex = construction.primaryIndex ?? facets[0].baseIndex;
  const primary = facets.find((facet) => facet.index === primaryIndex);
  const persistedTargets = [construction.target, construction.secondTarget].filter(Boolean);
  const hidden = new Set(hiddenPatternIds);
  const preceding = new Set(precedingPatternIds);
  const all = new Set(allPatternIds);
  const failure = (reason, targets = []) => ({ status: MEET_STATUS.STALE, reason, message: REASONS[reason] ?? "构造来源已失效", targets, primaryIndex });
  for (const target of persistedTargets) {
    for (const source of target.sourceOperationIds) {
      if (source === "rough-cube") continue;
      if (hidden.has(source)) return failure("source-hidden");
      if (!all.has(source)) return failure("source-missing");
      if (!preceding.has(source)) return failure("source-order");
    }
  }
  if (!primary) return failure("primary-missing");
  const resolutions = persistedTargets.map((target) => resolvePersistedMeetTarget(target, beforeSolid));
  const targets = resolutions.map((resolution) => resolution.target);
  const invalid = resolutions.find((resolution) => resolution.status !== MEET_STATUS.VALID);
  if (invalid) return failure(invalid.reason, targets);
  if (construction.type === "dual-meet") {
    const solved = solveDualMeet({ region: primary.region, baseIndex: primaryIndex, targetA: targets[0], targetB: targets[1], stock });
    if (solved.status !== MEET_STATUS.VALID) return failure(solved.reason, targets);
  }
  const normal = primary.plane.normal;
  const normalLength = Math.hypot(normal.x, normal.y, normal.z);
  const residuals = targets.map((target) => {
    const [x, y, z] = target.fallbackWorldPoint;
    return Math.abs(normal.x * x + normal.y * y + normal.z * z - primary.plane.offset) / normalLength;
  });
  if (residuals.some((residual) => residual > 1e-7)) return failure("plane-mismatch", targets);
  return { status: MEET_STATUS.VALID, reason: null, message: "构造来源有效", targets, primaryIndex };
}

/** One cached sequence per committed document/visibility change; excludes all live draft state. */
export function buildConstructionStages(document, { hiddenPatternIds = [] } = {}) {
  const groups = new Map();
  for (const facet of document.facets) {
    if (!groups.has(facet.patternId)) groups.set(facet.patternId, []);
    groups.get(facet.patternId).push(facet);
  }
  const allPatternIds = [...groups.keys()];
  const precedingPatternIds = [];
  const hidden = new Set(hiddenPatternIds);
  let solid = createCenteredCube(document.stock.size, {
    center: document.stock.center, sourceOperationId: "rough-cube", region: "rough",
  });
  return [...groups].map(([id, facets], index) => {
    const beforeSolid = solid;
    const construction = diagnoseSavedConstruction({ facets, beforeSolid, precedingPatternIds, allPatternIds, hiddenPatternIds, stock: document.stock });
    if (!hidden.has(id)) {
      solid = clipPolyhedronByPlanes(beforeSolid, facets.map((facet) => ({
        ...facet.plane, operationId: id, faceId: facet.id, region: facet.region,
        operationType: facet.metadata?.operationType,
      })));
    }
    const stage = {
      id, patternId: id, index, facets, beforeSolid, afterSolid: solid,
      hidden: hidden.has(id), preform: facets[0]?.metadata?.preform === true,
      construction,
    };
    precedingPatternIds.push(id);
    return stage;
  });
}
