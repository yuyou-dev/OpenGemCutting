import { rotationalStockSupportOffset } from "./faceting.js";
import { clipPolyhedronByPlanes } from "./geometry.js";

export const MEET_STATUS = Object.freeze({
  VALID: "valid",
  UNREACHABLE: "unreachable",
  STALE: "stale",
  DESTRUCTIVE: "destructive",
});

export const JUMP_CLASSIFICATION = Object.freeze({
  CONTACT_ONLY: "contact-only",
  FACET: "facet",
  DESTRUCTIVE: "destructive",
});

const DEFAULT_TOLERANCE = 1e-8;
const SIGNATURE_PRECISION = 1e-9;

function coordinates(value) {
  return Array.isArray(value)
    ? { x: value[0], y: value[1], z: value[2] }
    : { x: value.x, y: value.y, z: value.z };
}

function normalize(vector) {
  const point = coordinates(vector);
  const length = Math.hypot(point.x, point.y, point.z);
  if (!Number.isFinite(length) || length === 0) {
    throw new RangeError("normal must have non-zero finite length");
  }
  return { x: point.x / length, y: point.y / length, z: point.z / length };
}

function dot(left, right) {
  const point = coordinates(right);
  return left.x * point.x + left.y * point.y + left.z * point.z;
}

function quantize(value) {
  const rounded = Math.round(value / SIGNATURE_PRECISION) * SIGNATURE_PRECISION;
  return (Object.is(rounded, -0) ? 0 : rounded).toFixed(9);
}

function hash(value) {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return [first, second]
    .map((part) => (part >>> 0).toString(16).padStart(8, "0"))
    .join("");
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableFaceId(face, index) {
  return String(face.id ?? `face-${index}`);
}

function incidentFaceRecords(polyhedron, vertexIndex) {
  return polyhedron.faces
    .map((face, faceIndex) => ({ face, faceIndex, id: stableFaceId(face, faceIndex) }))
    .filter(({ face }) => face.vertexIndices.includes(vertexIndex))
    .sort((left, right) => compareText(left.id, right.id));
}

function geometrySignature(point, faces) {
  const parts = faces.map(({ face, id }) => {
    const normal = normalize(face.normal);
    const operationId = face.sourceOperationId == null ? "" : String(face.sourceOperationId);
    return [
      id,
      operationId,
      quantize(normal.x),
      quantize(normal.y),
      quantize(normal.z),
      quantize(dot(normal, point)),
    ].join(":");
  });
  return `v1:${hash(parts.join("|"))}`;
}

/** Enumerate deterministic topology-aware targets for every solid vertex. */
export function enumerateTopologyVertices(polyhedron) {
  return polyhedron.vertices.map((rawPoint, vertexIndex) => {
    const point = coordinates(rawPoint);
    const faces = incidentFaceRecords(polyhedron, vertexIndex);
    const sourceFaceIds = faces.map(({ id }) => id);
    const sourceOperationIds = [...new Set(
      faces
        .map(({ face }) => face.sourceOperationId)
        .filter((operationId) => operationId != null)
        .map(String),
    )].sort(compareText);

    return {
      vertexIndex,
      topologyKey: `vertex:${sourceFaceIds.map(encodeURIComponent).join("|")}`,
      sourceFaceIds,
      sourceOperationIds,
      sourceGeometrySignature: geometrySignature(point, faces),
      fallbackWorldPoint: [point.x, point.y, point.z],
    };
  }).sort((left, right) => compareText(left.topologyKey, right.topologyKey));
}

/** Solve the faceting-machine depth required for one normalized plane to pass through a vertex. */
export function solveVertexMeet({ normal: rawNormal, target, stock, tolerance = DEFAULT_TOLERANCE }) {
  const normal = normalize(rawNormal);
  const point = target.fallbackWorldPoint ?? target.point ?? target;
  const supportOffset = rotationalStockSupportOffset(normal, stock);
  const requiredDepth = supportOffset - dot(normal, point);
  const offset = supportOffset - requiredDepth;
  const residual = dot(normal, point) - offset;

  return {
    status: requiredDepth < 0 ? MEET_STATUS.UNREACHABLE : MEET_STATUS.VALID,
    requiredDepth,
    depth: requiredDepth < 0 ? null : requiredDepth,
    residual: Math.abs(residual) <= tolerance ? 0 : residual,
    normal,
    offset,
  };
}

/** Derive the explicit facet faces that remain effective in a final solid. */
export function summarizeEffectiveFacets(solid) {
  const byOperation = new Map();

  solid.faces.forEach((face, index) => {
    if (face.sourceOperationId == null || face.sourceOperationId === "rough-cube") return;
    const operationId = String(face.sourceOperationId);
    const entry = byOperation.get(operationId) ?? {
      operationId,
      region: face.region ?? null,
      facetIds: [],
    };
    if (entry.operationType == null && face.operationType != null) {
      entry.operationType = face.operationType;
    }
    entry.facetIds.push(stableFaceId(face, index));
    byOperation.set(operationId, entry);
  });

  const operations = [...byOperation.values()]
    .sort((left, right) => compareText(left.operationId, right.operationId))
    .map((entry) => ({
      ...entry,
      facetIds: entry.facetIds.sort(compareText),
      count: entry.facetIds.length,
    }));

  return {
    effectiveFacetIds: operations.flatMap((entry) => entry.facetIds).sort(compareText),
    operations,
  };
}

function threatRecords(baseSolid, resultSolid) {
  const before = summarizeEffectiveFacets(baseSolid);
  const after = summarizeEffectiveFacets(resultSolid);
  const afterByOperation = new Map(after.operations.map((entry) => [entry.operationId, entry]));

  return before.operations.flatMap((entry) => {
    const survivingIds = new Set(afterByOperation.get(entry.operationId)?.facetIds ?? []);
    const faceIds = entry.facetIds.filter((faceId) => !survivingIds.has(faceId));
    if (faceIds.length === 0) return [];
    const survivingCount = entry.count - faceIds.length;
    return [{
      operationId: entry.operationId,
      region: entry.region,
      ...(entry.operationType != null ? { operationType: entry.operationType } : {}),
      beforeCount: entry.count,
      survivingCount,
      removedCount: faceIds.length,
      fullyRemoved: survivingCount === 0,
      faceIds,
    }];
  });
}

/** Apply a draft to the committed solid and classify its visible/safety impact. */
export function evaluateDraftImpact({ baseSolid, planes, tolerance = DEFAULT_TOLERANCE }) {
  const beforeIds = new Set(baseSolid.faces.map((face, index) => stableFaceId(face, index)));
  const resultSolid = clipPolyhedronByPlanes(baseSolid, planes, { tolerance });
  const threats = threatRecords(baseSolid, resultSolid);
  const solidErased = resultSolid.vertices.length === 0;
  const destructive = solidErased || threats.length > 0;
  const generatedFaceCount = resultSolid.faces.reduce(
    (count, face, index) => count + Number(!beforeIds.has(stableFaceId(face, index))),
    0,
  );
  const removedFaceCount = threats.reduce((count, threat) => count + threat.removedCount, 0);
  const noOp = !solidErased && generatedFaceCount === 0 && removedFaceCount === 0;
  const faceRemoval = !solidErased && threats.length > 0;
  const classification = destructive
    ? JUMP_CLASSIFICATION.DESTRUCTIVE
    : generatedFaceCount > 0
      ? JUMP_CLASSIFICATION.FACET
      : JUMP_CLASSIFICATION.CONTACT_ONLY;

  return {
    classification,
    status: destructive ? MEET_STATUS.DESTRUCTIVE : MEET_STATUS.VALID,
    destructive,
    noOp,
    solidErased,
    faceRemoval,
    impactKind: solidErased ? "solid-erased" : faceRemoval ? "face-removal" : noOp ? "no-op" : "facet",
    threats,
    generatedFaceCount,
    removedFaceCount,
    resultSolid,
  };
}

/** Resolve the single commit gate shared by ordinary CUT, Jump, and Meet. */
export function resolveDraftCommitPolicy(impact) {
  if (impact.solidErased || impact.noOp) return "block";

  const fullyRemoved = impact.threats.filter((threat) => threat.fullyRemoved);
  if (fullyRemoved.some((threat) => (
    threat.region === "girdle"
    || threat.operationType === "table"
    || threat.operationId === "table-facet"
  ))) return "block";
  if (fullyRemoved.some((threat) => threat.region === "crown" || threat.region === "pavilion")) {
    return "confirm";
  }
  if (impact.threats.length > 0) return "warn";
  return "allow";
}

/** Build stable shallow-to-deep Jump candidates from the committed solid only. */
export function generateJumpCandidates({
  baseSolid,
  normal: rawNormal,
  stock,
  targets = enumerateTopologyVertices(baseSolid),
  tolerance = DEFAULT_TOLERANCE,
}) {
  const normal = normalize(rawNormal);
  const supportOffset = rotationalStockSupportOffset(normal, stock);
  const solved = targets
    .map((target) => ({
      target,
      depth: supportOffset - dot(normal, target.fallbackWorldPoint),
    }))
    .filter(({ depth }) => depth >= 0)
    .sort((left, right) => left.depth - right.depth
      || compareText(left.target.topologyKey, right.target.topologyKey));

  const groups = [];
  for (const entry of solved) {
    const group = groups.at(-1);
    if (group && Math.abs(entry.depth - group[0].depth) <= tolerance) {
      group.push(entry);
    } else {
      groups.push([entry]);
    }
  }
  const representatives = groups.map((group) => [...group].sort(
    (left, right) => compareText(left.target.topologyKey, right.target.topologyKey),
  )[0]);

  return representatives.map(({ target, depth }, index) => ({
    source: "jump",
    key: target.topologyKey,
    target,
    depth,
    index,
  }));
}

/** Classify only a displayed or selected stop, using the complete CUT orbit. */
export function classifyJumpCandidate({
  candidate,
  baseSolid,
  normal: rawNormal,
  stock,
  planesForDepth,
  tolerance = DEFAULT_TOLERANCE,
}) {
  const normal = normalize(rawNormal);
  const planes = planesForDepth
    ? planesForDepth(candidate.depth)
    : [{
      normal,
      offset: rotationalStockSupportOffset(normal, stock) - candidate.depth,
      faceId: "meet-jump-primary",
      operationId: "meet-jump-preview",
    }];
  const impact = evaluateDraftImpact({ baseSolid, planes, tolerance });
  return { ...candidate, classification: impact.classification, threats: impact.threats };
}

/** Resolve the previous or next stable Jump stop without mutating draft state. */
export function adjacentJumpCandidateIndex({
  candidates,
  currentDepth,
  currentKey = null,
  direction = 1,
  tolerance = 1e-7,
}) {
  const currentIndex = candidates.findIndex((candidate) => candidate.key === currentKey);
  if (currentIndex >= 0) {
    const adjacent = currentIndex + (direction < 0 ? -1 : 1);
    return adjacent >= 0 && adjacent < candidates.length ? adjacent : -1;
  }
  return direction < 0
    ? candidates.findLastIndex((candidate) => candidate.depth < currentDepth - tolerance)
    : candidates.findIndex((candidate) => candidate.depth > currentDepth + tolerance);
}

/** Resolve persisted construction metadata without using its fallback point as a live target. */
export function resolvePersistedVertexTarget(target, baseSolid) {
  const match = enumerateTopologyVertices(baseSolid)
    .find((candidate) => candidate.topologyKey === target.topologyKey);

  if (!match) {
    return { status: MEET_STATUS.STALE, target: null, reason: "topology-missing" };
  }
  if (match.sourceGeometrySignature !== target.sourceGeometrySignature) {
    return { status: MEET_STATUS.STALE, target: match, reason: "geometry-changed" };
  }
  return { status: MEET_STATUS.VALID, target: match, reason: null };
}
