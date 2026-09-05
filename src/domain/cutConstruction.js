import { normalizeIndex, displayIndex, resolveFacet, resolveFacetPattern } from "./faceting.js";
import { MEET_STATUS, resolvePersistedMeetTarget, solveVertexMeet, solveDualMeet } from "./meetJump.js";

export function parseCustomIndices(value) {
  const tokens = value.trim() ? value.trim().split(/[\s,，;；]+/) : [];
  if (tokens.length === 0) return { indices: [], error: "请输入至少一个 1–96 整数索引。" };

  const values = [];
  for (const token of tokens) {
    const number = Number(token);
    if (!Number.isInteger(number) || number < 1 || number > 96) {
      return { indices: [], error: `“${token}” 不是 1–96 范围内的整数索引。` };
    }
    values.push(normalizeIndex(number));
  }

  const indices = [...new Set(values)].sort((left, right) => displayIndex(left) - displayIndex(right));
  return { indices, error: "" };
}

export function planeEntry(facet) {
  return {
    ...facet.plane,
    operationId: facet.patternId,
    faceId: facet.id,
    region: facet.region,
    operationType: facet.metadata?.operationType,
  };
}

export function resolveDraftGeometry(draft, region, stock) {
  try {
    if (draft.patternMode === "symmetric") {
      return {
        facets: resolveFacetPattern({
          patternId: "draft-symmetric",
          region,
          baseIndex: draft.baseIndex,
          repeat: draft.repeat,
          mirror: draft.mirrorOffset,
          industryAngleDeg: draft.industryAngle,
          depth: draft.depth,
        }, { stock }),
        error: "",
      };
    }
    const parsed = parseCustomIndices(draft.customIndices);
    if (parsed.error) return { facets: [], error: parsed.error };
    if (!parsed.indices.includes(normalizeIndex(draft.baseIndex))) return { facets: [], error: "请从自定义索引集合中选择主切面。" };
    return {
      facets: parsed.indices.map((index, ordinal) => resolveFacet({
        id: `draft-arbitrary:${displayIndex(index)}`,
        patternId: "draft-arbitrary",
        ordinal,
        region,
        baseIndex: index,
        repeat: 1,
        mirror: 0,
        index,
        industryAngleDeg: draft.industryAngle,
        depth: draft.depth,
      }, { stock })),
      error: "",
    };
  } catch (error) {
    return { facets: [], error: error.message };
  }
}


export function solveDraftConstruction({ draft, region, stock, meet, baseSolid }) {
  const resolutions = [meet.target, meet.secondTarget].filter(Boolean)
    .map((target) => resolvePersistedMeetTarget(target, baseSolid));
  if (resolutions.some((result) => result.status !== MEET_STATUS.VALID)) {
    return { draft, meet: { ...meet, status: MEET_STATUS.STALE, message: "Meet 来源已失效；请重新选择或解除约束。" } };
  }
  const [target, secondTarget] = resolutions.map((result) => result.target);
  const resolved = resolveDraftGeometry(draft, region, stock);
  const primary = resolved.facets.find((facet) => normalizeIndex(facet.index) === normalizeIndex(draft.baseIndex));
  if (!primary) return { draft, meet: { ...meet, status: MEET_STATUS.STALE, message: resolved.error || "请选择有效主切面。" } };
  const solved = secondTarget
    ? solveDualMeet({ targetA: target, targetB: secondTarget, baseIndex: draft.baseIndex, region, stock })
    : solveVertexMeet({ normal: primary.plane.normal, target, stock });
  const messages = {
    "duplicate-points": "A 与 B 重合；请选择不同的第二点。",
    "non-unique-angle": "两点无法确定唯一行业角；请更换第二点或主分度。",
    "angle-out-of-range": "当前主分度下的双 Meet 超出部位角度范围。",
    "negative-depth": "目标超出当前切面的可达范围；请调整角度或主分度。",
  };
  const valid = solved.status === MEET_STATUS.VALID;
  return {
    draft: valid ? { ...draft, depth: solved.depth, ...(secondTarget ? { industryAngle: solved.industryAngleDeg } : {}) } : draft,
    meet: { ...meet, target, ...(secondTarget ? { secondTarget } : {}), status: solved.status,
      reason: solved.reason, requiredDepth: solved.requiredDepth, residual: solved.residual,
      message: valid ? "" : messages[solved.reason] || "目标不可达；请调整自由参数或重新选择。" },
  };
}

export function snapshotMeetTarget(target) {
  const result = Object.fromEntries(["kind", "topologyKey", "sourceFaceIds", "sourceOperationIds", "sourceGeometrySignature", "fallbackWorldPoint", "edgeTopologyKey", "ratio"].filter((key) => target[key] !== undefined).map((key) => [key, target[key]]));
  if (target.endpoints) result.endpoints = target.endpoints.map(snapshotMeetTarget);
  return result;
}
