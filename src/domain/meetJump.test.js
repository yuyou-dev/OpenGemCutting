import assert from "node:assert/strict";
import test from "node:test";

import { facetNormal, resolveFacetPattern, rotationalStockSupportOffset } from "./faceting.js";
import { clipPolyhedron, clipPolyhedronByPlanes, createCenteredCube } from "./geometry.js";
import {
  JUMP_CLASSIFICATION,
  MEET_STATUS,
  adjacentJumpCandidateIndex,
  classifyJumpCandidate,
  createEdgeMeetTarget,
  enumerateTopologyEdges,
  enumerateTopologyVertices,
  evaluateDraftImpact,
  generateJumpCandidates,
  generateDualJumpCandidates,
  resolveDraftCommitPolicy,
  resolvePersistedMeetTarget,
  solveDualMeet,
  solveVertexMeet,
  summarizeEffectiveFacets,
} from "./meetJump.js";

const EPSILON = 1e-9;

function approximately(actual, expected, tolerance = EPSILON) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

function cutCube() {
  return clipPolyhedron(createCenteredCube(), {
    normal: { x: 1, y: 0, z: 0 },
    offset: 0.5,
    operationId: "C1",
    faceId: "C1:96",
  });
}

test("enumerates deterministic topology targets with source identity and geometry signatures", () => {
  const solid = cutCube();
  const first = enumerateTopologyVertices(solid);
  const second = enumerateTopologyVertices(structuredClone(solid));

  assert.equal(first.length, solid.vertices.length);
  assert.deepEqual(first, second);
  assert.deepEqual(first.map((target) => target.topologyKey), [...first]
    .map((target) => target.topologyKey).sort());
  assert.ok(first.every((target) => target.sourceFaceIds.length === 3));
  assert.ok(first.every((target) => /^v1:[0-9a-f]{16}$/.test(target.sourceGeometrySignature)));

  const cutTargets = first.filter((target) => target.sourceFaceIds.includes("C1:96"));
  assert.equal(cutTargets.length, 4);
  assert.ok(cutTargets.every((target) => target.sourceOperationIds.includes("C1")));
  assert.ok(cutTargets.every((target) => target.fallbackWorldPoint[0] === 0.5));
});

test("real edge targets survive vertex reindexing and polygon winding with stable ratio direction", () => {
  const solid = cutCube();
  const edges = enumerateTopologyEdges(solid);
  assert.equal(edges.length, 12);
  assert.equal(new Set(edges.map((edge) => edge.topologyKey)).size, 12);
  assert.ok(edges.every((edge) => edge.endpoints[0].topologyKey < edge.endpoints[1].topologyKey));
  assert.ok(edges.every((edge) => solid.faces.some((face) => (
    face.vertexIndices.some((vertexIndex, index) => (
      vertexIndex === edge.vertexIndices[0]
      && face.vertexIndices[(index + 1) % face.vertexIndices.length] === edge.vertexIndices[1]
    ))
  ))));
  const reversed = structuredClone(solid);
  reversed.vertices.reverse();
  reversed.faces.reverse();
  reversed.faces.forEach((face) => {
    face.vertexIndices = face.vertexIndices.map((index) => solid.vertices.length - 1 - index).reverse();
  });
  const reversedEdges = enumerateTopologyEdges(reversed);
  for (const [index, edge] of edges.entries()) {
    const match = reversedEdges[index];
    assert.equal(match.topologyKey, edge.topologyKey);
    assert.equal(match.sourceGeometrySignature, edge.sourceGeometrySignature);
    assert.deepEqual(createEdgeMeetTarget(match, 0.95).fallbackWorldPoint,
      createEdgeMeetTarget(edge, 0.95).fallbackWorldPoint);
  }
});

test("edge ratio targets interpolate exact points, canonicalize endpoints, and reject invalid ratios", () => {
  const edge = enumerateTopologyEdges(cutCube())[0];
  assert.deepEqual(createEdgeMeetTarget(edge, 0), edge.endpoints[0]);
  assert.deepEqual(createEdgeMeetTarget(edge, 1), edge.endpoints[1]);
  for (const ratio of [1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4, 0.95]) {
    const target = createEdgeMeetTarget(edge, ratio);
    const normal = facetNormal(33, 59.03);
    const solved = solveVertexMeet({ normal, target });
    assert.equal(target.kind, "edge-point");
    target.fallbackWorldPoint.forEach((value, axis) => approximately(value,
      (1 - ratio) * edge.endpoints[0].fallbackWorldPoint[axis]
      + ratio * edge.endpoints[1].fallbackWorldPoint[axis]));
    approximately(normal.x * target.fallbackWorldPoint[0]
      + normal.y * target.fallbackWorldPoint[1]
      + normal.z * target.fallbackWorldPoint[2], solved.offset);
  }
  for (const ratio of [-0.01, 1.01, NaN, Infinity, "0.5"]) {
    assert.throws(() => createEdgeMeetTarget(edge, ratio), RangeError);
  }
});

test("edge enumeration excludes zero length segments while retaining short real edges", () => {
  const solid = createCenteredCube();
  const edge = enumerateTopologyEdges(solid)[0];
  const [startIndex, endIndex] = edge.vertexIndices;
  solid.vertices[endIndex] = { ...solid.vertices[startIndex] };
  assert.ok(!enumerateTopologyEdges(solid).some((candidate) => candidate.topologyKey === edge.topologyKey));
  solid.vertices[endIndex].x += 1e-6;
  assert.ok(enumerateTopologyEdges(solid).some((candidate) => candidate.topologyKey === edge.topologyKey));
});

test("persisted edge targets become stale on endpoint movement or removed sources, and recover on undo", () => {
  const solid = cutCube();
  const edge = enumerateTopologyEdges(solid)
    .find((candidate) => candidate.endpoints.every((endpoint) => endpoint.fallbackWorldPoint[0] === 0.5));
  const target = createEdgeMeetTarget(edge, 0.95);
  const resolve = (source) => resolvePersistedMeetTarget(target, source);
  assert.equal(resolve(solid).status, MEET_STATUS.VALID);
  assert.deepEqual(resolve(solid).target, target);
  const moved = structuredClone(solid);
  moved.vertices[edge.vertexIndices[0]].z += 0.1;
  assert.equal(resolve(moved).status, MEET_STATUS.STALE);
  assert.equal(resolve(moved).reason, "geometry-changed");
  assert.equal(resolve(createCenteredCube()).reason, "topology-missing");
  const misleadingFallback = { ...target, fallbackWorldPoint: [0, 0, 0] };
  assert.deepEqual(resolvePersistedMeetTarget(misleadingFallback, solid).target.fallbackWorldPoint,
    target.fallbackWorldPoint);
  assert.equal(resolve(structuredClone(solid)).status, MEET_STATUS.VALID);
});

test("dual Meet solves both residuals at every integer index for crown and pavilion without rounding", () => {
  for (const region of ["crown", "pavilion"]) {
    const sign = region === "crown" ? 1 : -1;
    for (let baseIndex = 0; baseIndex < 96; baseIndex += 1) {
      const radial = facetNormal(baseIndex, 0);
      for (const industryAngleDeg of [0, 0.01, 30.9712345, 89.99, 90]) {
        const angle = industryAngleDeg * Math.PI / 180;
        const targetA = { fallbackWorldPoint: [0.1, -0.05, 0.2 * sign] };
        const targetB = { fallbackWorldPoint: [
          0.1 + 0.4 * Math.cos(angle) * radial.x - 0.13 * radial.y,
          -0.05 + 0.4 * Math.cos(angle) * radial.y + 0.13 * radial.x,
          0.2 * sign - 0.4 * sign * Math.sin(angle),
        ] };
        const result = solveDualMeet({ targetA, targetB, baseIndex, region });
        assert.equal(result.status, MEET_STATUS.VALID, `${region} I${baseIndex} A${industryAngleDeg}: ${result.reason}`);
        approximately(result.industryAngleDeg, industryAngleDeg, 1e-8);
        assert.ok(result.depth >= 0);
        for (const target of [targetA, targetB]) {
          const [x, y, z] = target.fallbackWorldPoint;
          approximately(result.normal.x * x + result.normal.y * y + result.normal.z * z, result.offset);
        }
        assert.deepEqual(result.residuals, [0, 0]);
        const swapped = solveDualMeet({ targetA: targetB, targetB: targetA, baseIndex, region });
        approximately(swapped.industryAngleDeg, result.industryAngleDeg, 1e-8);
        approximately(swapped.depth, result.depth);
      }
    }
  }
});

test("dual Meet distinguishes duplicate, nonunique, out of region, and negative depth constraints", () => {
  const solve = (a, b, extra = {}) => solveDualMeet({
    targetA: { fallbackWorldPoint: a }, targetB: { fallbackWorldPoint: b },
    baseIndex: 0, region: "crown", ...extra,
  });
  assert.equal(solve([0, 0, 0], [0, 0, 0]).reason, "duplicate-points");
  assert.equal(solve([0, 0, 0], [0, 0.5, 0]).reason, "non-unique-angle");
  assert.equal(solve([0, 0, 0], [0.5, 0, 0.5]).reason, "angle-out-of-range");
  const negative = solve([2, 0, 2], [2.5, 0, 1.5]);
  assert.equal(negative.status, MEET_STATUS.UNREACHABLE);
  assert.equal(negative.reason, "negative-depth");
  assert.ok(negative.requiredDepth < 0);
  assert.equal(negative.depth, null);
  const recovered = solve([0, 0, 0], [0.5, 0, 0.5], { region: "pavilion" });
  assert.equal(recovered.status, MEET_STATUS.VALID);
  approximately(recovered.industryAngleDeg, 45);
  assert.deepEqual(solve([0, 0, 0], [0.5, 0, -0.5], { baseIndex: 96 }),
    solve([0, 0, 0], [0.5, 0, -0.5]));
  assert.throws(() => solve([0, 0, 0], [0.5, 0, -0.5], { baseIndex: 0.1 }));
  assert.throws(() => solve([0, 0, 0], [0.5, 0, -0.5], { region: "girdle" }));
});

test("dual Meet supports vertex-edge and edge-edge combinations from actual solid topology", () => {
  const solid = cutCube();
  const vertices = enumerateTopologyVertices(solid);
  const edges = enumerateTopologyEdges(solid);
  const edgePoints = edges.map((edge) => createEdgeMeetTarget(edge, 0.95));
  const combinations = [[vertices, edgePoints], [edgePoints, edgePoints]];
  for (const [left, right] of combinations) {
    let validCount = 0;
    for (const targetA of left) for (const targetB of right) {
      const result = solveDualMeet({ targetA, targetB, baseIndex: 33, region: "crown" });
      if (result.status !== MEET_STATUS.VALID) continue;
      validCount += 1;
      for (const target of [targetA, targetB]) {
        const [x, y, z] = target.fallbackWorldPoint;
        approximately(result.normal.x * x + result.normal.y * y + result.normal.z * z, result.offset);
      }
    }
    assert.ok(validCount > 0);
  }
});

test("Jump B candidates sort by angle, dedupe ties stably, honor endpoints, and classify only the selected orbit", () => {
  const baseSolid = cutCube();
  const targets = enumerateTopologyVertices(baseSolid);
  const targetA = createEdgeMeetTarget(enumerateTopologyEdges(baseSolid)[0], 0.5);
  const settings = { baseSolid, targetA, baseIndex: 33, region: "crown" };
  const candidates = generateDualJumpCandidates({ ...settings, targets });
  assert.ok(candidates.length > 2);
  assert.deepEqual(generateDualJumpCandidates({ ...settings, targets: [...targets].reverse() }), candidates);
  assert.ok(candidates.every((candidate) => !Object.hasOwn(candidate, "classification")));
  assert.ok(candidates.every((candidate, index) => index === 0
    || candidate.industryAngleDeg > candidates[index - 1].industryAngleDeg + 1e-8));
  assert.equal(adjacentJumpCandidateIndex({ candidates, currentAngle: -1 }), 0);
  assert.equal(adjacentJumpCandidateIndex({ candidates, currentAngle: 91 }), -1);
  assert.equal(adjacentJumpCandidateIndex({ candidates, currentAngle: 91, direction: -1 }), candidates.length - 1);
  assert.equal(adjacentJumpCandidateIndex({ candidates, currentAngle: -1, direction: -1 }), -1);
  const selected = candidates[1];
  const before = structuredClone(candidates);
  let resolutions = 0;
  const classified = classifyJumpCandidate({
    candidate: selected, baseSolid,
    planesForCandidate: (candidate) => {
      resolutions += 1;
      return resolveFacetPattern({
        patternId: "draft", region: settings.region, baseIndex: settings.baseIndex,
        repeat: 8, mirror: 3, industryAngleDeg: candidate.industryAngleDeg, depth: candidate.depth,
      }).map((facet) => ({ ...facet.plane, faceId: facet.id, operationId: facet.patternId }));
    },
  });
  assert.equal(resolutions, 1);
  assert.ok(Object.values(JUMP_CLASSIFICATION).includes(classified.classification));
  assert.deepEqual(candidates, before);
  assert.equal(adjacentJumpCandidateIndex({ candidates, currentAngle: selected.industryAngleDeg }), 2);
});

test("keeps saved crown intersections available as topology targets for the next tier", () => {
  const table = resolveFacetPattern({
    patternId: "table-facet", region: "crown", baseIndex: 0, repeat: 1,
    industryAngleDeg: 0, depth: 0.2,
  });
  const girdle = resolveFacetPattern({
    patternId: "girdle-1", region: "girdle", baseIndex: 0, repeat: 32,
    industryAngleDeg: 90, depth: 0.2,
  });
  const crown = resolveFacetPattern({
    patternId: "crown-1", region: "crown", baseIndex: 36, repeat: 8,
    industryAngleDeg: 32, depth: 0.42,
  });
  const planeEntry = (facet) => ({
    ...facet.plane,
    operationId: facet.patternId,
    faceId: facet.id,
    region: facet.region,
  });
  const baseSolid = clipPolyhedronByPlanes(
    createCenteredCube(),
    [...table, ...girdle].map(planeEntry),
  );
  const crownSolid = clipPolyhedronByPlanes(
    createCenteredCube(),
    [...table, ...girdle, ...crown].map(planeEntry),
  );
  const baseTargets = enumerateTopologyVertices(baseSolid);
  const crownTargets = enumerateTopologyVertices(crownSolid);
  const tableMeets = crownTargets.filter((target) => (
    target.sourceOperationIds.includes("crown-1")
    && target.sourceOperationIds.includes("table-facet")
  ));

  assert.equal(baseTargets.length, 64);
  assert.equal(crownTargets.length, 80);
  assert.equal(tableMeets.length, 8);
  assert.ok(tableMeets.every((target) => (
    Math.hypot(target.fallbackWorldPoint[0], target.fallbackWorldPoint[1]) < 0.6
  )));
});

test("vertex meet solves exact depth and preserves an unreachable negative requirement", () => {
  const normal = { x: 1, y: 0, z: 0 };
  const valid = solveVertexMeet({
    normal,
    target: { fallbackWorldPoint: [0.25, 0, 0] },
  });
  assert.equal(valid.status, MEET_STATUS.VALID);
  approximately(valid.requiredDepth, 0.75);
  approximately(valid.depth, 0.75);
  assert.equal(valid.residual, 0);

  const unreachable = solveVertexMeet({
    normal,
    target: { fallbackWorldPoint: [1.25, 0, 0] },
  });
  assert.equal(unreachable.status, MEET_STATUS.UNREACHABLE);
  approximately(unreachable.requiredDepth, -0.25);
  assert.equal(unreachable.depth, null);
  assert.equal(unreachable.residual, 0);
});

test("draft impact distinguishes contact, a visible facet, and committed-face destruction", () => {
  const baseSolid = cutCube();
  const contact = evaluateDraftImpact({
    baseSolid,
    planes: [{ normal: { x: 0, y: 1, z: 0 }, offset: 1 }],
  });
  assert.equal(contact.classification, JUMP_CLASSIFICATION.CONTACT_ONLY);
  assert.equal(contact.destructive, false);
  assert.equal(contact.noOp, true);
  assert.equal(contact.solidErased, false);
  assert.equal(contact.impactKind, "no-op");
  assert.equal(resolveDraftCommitPolicy(contact), "block");

  const facet = evaluateDraftImpact({
    baseSolid,
    planes: [{
      normal: { x: 0, y: 1, z: 0 },
      offset: 0.5,
      operationId: "draft",
      faceId: "draft:96",
    }],
  });
  assert.equal(facet.classification, JUMP_CLASSIFICATION.FACET);
  assert.equal(facet.generatedFaceCount, 1);
  assert.equal(facet.noOp, false);
  assert.equal(facet.impactKind, "facet");
  assert.deepEqual(facet.threats, []);
  assert.equal(resolveDraftCommitPolicy(facet), "allow");

  const destructive = evaluateDraftImpact({
    baseSolid,
    planes: [{
      normal: { x: -1, y: 0, z: 0 },
      offset: -0.75,
      operationId: "draft",
      faceId: "draft:96",
    }],
  });
  assert.equal(destructive.classification, JUMP_CLASSIFICATION.DESTRUCTIVE);
  assert.equal(destructive.status, MEET_STATUS.DESTRUCTIVE);
  assert.equal(destructive.solidErased, true);
  assert.equal(destructive.faceRemoval, false);
  assert.equal(destructive.impactKind, "solid-erased");
  assert.equal(resolveDraftCommitPolicy(destructive), "block");
  assert.deepEqual(destructive.threats, [{
    operationId: "C1",
    region: null,
    beforeCount: 1,
    survivingCount: 0,
    removedCount: 1,
    fullyRemoved: true,
    faceIds: ["C1:96"],
  }]);
});

test("effective facet summaries expose stable ids and per-operation counts", () => {
  const baseSolid = clipPolyhedronByPlanes(createCenteredCube(), [
    { normal: { x: 1, y: 0, z: 0 }, offset: 0.5, operationId: "C1", faceId: "C1:x", region: "crown" },
    { normal: { x: 0, y: 1, z: 0 }, offset: 0.5, operationId: "C1", faceId: "C1:y", region: "crown" },
    { normal: { x: 0, y: 0, z: 1 }, offset: 0.5, operationId: "T1", faceId: "T1:96", region: "crown" },
  ]);

  assert.deepEqual(summarizeEffectiveFacets(baseSolid), {
    effectiveFacetIds: ["C1:x", "C1:y", "T1:96"],
    operations: [
      { operationId: "C1", region: "crown", facetIds: ["C1:x", "C1:y"], count: 2 },
      { operationId: "T1", region: "crown", facetIds: ["T1:96"], count: 1 },
    ],
  });
});

test("impact reports partial and full operation face removal without erasing the solid", () => {
  const baseSolid = clipPolyhedronByPlanes(createCenteredCube(), [
    { normal: { x: 1, y: 0, z: 0 }, offset: 0.5, operationId: "C1", faceId: "C1:x", region: "crown" },
    { normal: { x: 0, y: 1, z: 0 }, offset: 0.5, operationId: "C1", faceId: "C1:y", region: "crown" },
  ]);
  const partial = evaluateDraftImpact({
    baseSolid,
    planes: [{ normal: { x: 1, y: 0, z: 0 }, offset: 0, operationId: "draft", faceId: "draft:x" }],
  });
  assert.equal(partial.solidErased, false);
  assert.equal(partial.faceRemoval, true);
  assert.equal(partial.impactKind, "face-removal");
  assert.equal(partial.removedFaceCount, 1);
  assert.equal(resolveDraftCommitPolicy(partial), "warn");
  assert.deepEqual(partial.threats, [{
    operationId: "C1",
    region: "crown",
    beforeCount: 2,
    survivingCount: 1,
    removedCount: 1,
    fullyRemoved: false,
    faceIds: ["C1:x"],
  }]);
  assert.deepEqual(summarizeEffectiveFacets(partial.resultSolid).operations, [
    { operationId: "C1", region: "crown", facetIds: ["C1:y"], count: 1 },
    { operationId: "draft", region: null, facetIds: ["draft:x"], count: 1 },
  ]);

  const fullyRemoved = evaluateDraftImpact({
    baseSolid,
    planes: [
      { normal: { x: 1, y: 0, z: 0 }, offset: 0, operationId: "draft", faceId: "draft:x" },
      { normal: { x: 0, y: 1, z: 0 }, offset: 0, operationId: "draft", faceId: "draft:y" },
    ],
  });
  assert.equal(fullyRemoved.solidErased, false);
  assert.equal(fullyRemoved.faceRemoval, true);
  assert.equal(fullyRemoved.removedFaceCount, 2);
  assert.equal(resolveDraftCommitPolicy(fullyRemoved), "confirm");
  assert.deepEqual(fullyRemoved.threats, [{
    operationId: "C1",
    region: "crown",
    beforeCount: 2,
    survivingCount: 0,
    removedCount: 2,
    fullyRemoved: true,
    faceIds: ["C1:x", "C1:y"],
  }]);
});

test("a plane repeated from the base has zero contribution and is an explicit no-op", () => {
  const baseSolid = cutCube();
  const impact = evaluateDraftImpact({
    baseSolid,
    planes: [{ normal: { x: 1, y: 0, z: 0 }, offset: 0.5, operationId: "draft", faceId: "draft:96" }],
  });

  assert.equal(impact.generatedFaceCount, 0);
  assert.equal(impact.noOp, true);
  assert.equal(impact.solidErased, false);
  assert.equal(impact.faceRemoval, false);
  assert.equal(impact.impactKind, "no-op");
  assert.deepEqual(impact.threats, []);
});

test("commit policy blocks full table and girdle removal and confirms pavilion removal", () => {
  const fullThreat = (operationId, region) => ({
    operationId,
    region,
    beforeCount: 8,
    survivingCount: 0,
    removedCount: 8,
    fullyRemoved: true,
    faceIds: [],
  });
  const impact = (threat) => ({
    noOp: false,
    solidErased: false,
    threats: [threat],
  });

  assert.equal(resolveDraftCommitPolicy(impact(fullThreat("table-facet", "crown"))), "block");
  assert.equal(resolveDraftCommitPolicy(impact(fullThreat("G1", "girdle"))), "block");
  assert.equal(resolveDraftCommitPolicy(impact(fullThreat("P1", "pavilion"))), "confirm");
});

test("commit policy recognizes a custom-id table from propagated geometry metadata", () => {
  const baseSolid = clipPolyhedron(createCenteredCube(), {
    normal: { x: 0, y: 0, z: 1 },
    offset: 0.8,
    operationId: "custom-table",
    faceId: "custom-table:96",
    region: "crown",
    operationType: "table",
  });
  const impact = evaluateDraftImpact({
    baseSolid,
    planes: [{
      normal: { x: 0, y: 0, z: 1 },
      offset: 0.7,
      operationId: "C1",
      faceId: "C1:96",
      region: "crown",
    }],
  });

  assert.deepEqual(impact.threats, [{
    operationId: "custom-table",
    region: "crown",
    operationType: "table",
    beforeCount: 1,
    survivingCount: 0,
    removedCount: 1,
    fullyRemoved: true,
    faceIds: ["custom-table:96"],
  }]);
  assert.equal(resolveDraftCommitPolicy(impact), "block");
});

test("face removal and zero contribution remain disjoint impact states", () => {
  const baseSolid = clipPolyhedronByPlanes(createCenteredCube(), [
    { normal: { x: 1, y: 0, z: 0 }, offset: 0.5, operationId: "C1", faceId: "C1:x", region: "crown" },
    { normal: { x: 0, y: 1, z: 0 }, offset: 0.5, operationId: "C1", faceId: "C1:y", region: "crown" },
  ]);
  const removalWithoutFinalDraftFace = evaluateDraftImpact({
    baseSolid,
    planes: [
      { normal: { x: 1, y: 0, z: 0 }, offset: 0, operationId: "draft", faceId: "draft:x" },
      { normal: { x: -1, y: 0, z: 0 }, offset: 0, operationId: "draft", faceId: "draft:opposite" },
    ],
  });

  assert.equal(removalWithoutFinalDraftFace.solidErased, true);
  assert.equal(removalWithoutFinalDraftFace.noOp, false);
  assert.equal(resolveDraftCommitPolicy(removalWithoutFinalDraftFace), "block");
});

test("repeated draft planes project only the contributing facet into the final summary", () => {
  const impact = evaluateDraftImpact({
    baseSolid: createCenteredCube(),
    planes: [
      { normal: { x: 1, y: 0, z: 0 }, offset: 0.5, operationId: "draft", faceId: "draft:first", region: "crown" },
      { normal: { x: 1, y: 0, z: 0 }, offset: 0.5, operationId: "draft", faceId: "draft:duplicate", region: "crown" },
    ],
  });

  assert.equal(impact.generatedFaceCount, 1);
  assert.equal(impact.noOp, false);
  assert.deepEqual(summarizeEffectiveFacets(impact.resultSolid), {
    effectiveFacetIds: ["draft:first"],
    operations: [{
      operationId: "draft",
      region: "crown",
      facetIds: ["draft:first"],
      count: 1,
    }],
  });
});

test("jump candidates sort by depth, dedupe equal depths, and choose the lowest topology key", () => {
  const baseSolid = cutCube();
  const normal = { x: 1, y: 0, z: 0 };
  const support = rotationalStockSupportOffset(normal);
  const candidates = generateJumpCandidates({ baseSolid, normal });

  assert.equal(candidates.length, 2);
  assert.ok(candidates[0].depth < candidates[1].depth);
  approximately(candidates[0].depth, support - 0.5);
  approximately(candidates[1].depth, support + 1);
  assert.ok(candidates.every((candidate) => !Object.hasOwn(candidate, "classification")));
  assert.ok(candidates.every((candidate) => !Object.hasOwn(candidate, "threats")));

  const classified = candidates.map((candidate) => classifyJumpCandidate({ candidate, baseSolid, normal }));
  assert.equal(classified[0].classification, JUMP_CLASSIFICATION.CONTACT_ONLY);
  assert.equal(classified[1].classification, JUMP_CLASSIFICATION.DESTRUCTIVE);
  assert.ok(candidates.every((candidate) => !Object.hasOwn(candidate, "classification")));

  const targetsAtFirstDepth = enumerateTopologyVertices(baseSolid)
    .filter((target) => target.fallbackWorldPoint[0] === 0.5)
    .map((target) => target.topologyKey)
    .sort();
  assert.equal(candidates[0].key, targetsAtFirstDepth[0]);
  assert.equal(candidates[0].target.topologyKey, targetsAtFirstDepth[0]);
});

test("jump depth deduplication uses the supplied geometric tolerance", () => {
  const almostCube = createCenteredCube();
  almostCube.vertices[1].x -= 5e-9;

  const deduped = generateJumpCandidates({
    baseSolid: almostCube,
    normal: { x: 1, y: 0, z: 0 },
    tolerance: 1e-8,
  });
  const distinct = generateJumpCandidates({
    baseSolid: almostCube,
    normal: { x: 1, y: 0, z: 0 },
    tolerance: 1e-10,
  });

  assert.equal(deduped.length, 2);
  assert.equal(distinct.length, 3);
});

test("adjacent Jump lookup previews the next stop without changing the current depth", () => {
  const candidates = [
    { key: "first", depth: 0.1 },
    { key: "second", depth: 0.4 },
    { key: "third", depth: 0.8 },
  ];

  assert.equal(adjacentJumpCandidateIndex({ candidates, currentDepth: 0 }), 0);
  assert.equal(adjacentJumpCandidateIndex({ candidates, currentDepth: 0.2 }), 1);
  assert.equal(adjacentJumpCandidateIndex({ candidates, currentDepth: 0.4 }), 2);
  assert.equal(adjacentJumpCandidateIndex({ candidates, currentDepth: 0.4, currentKey: "second" }), 2);
  assert.equal(adjacentJumpCandidateIndex({ candidates, currentDepth: 0.4, currentKey: "second", direction: -1 }), 0);
  assert.equal(adjacentJumpCandidateIndex({ candidates, currentDepth: 0.8, currentKey: "third" }), -1);
});

test("jump evaluates the whole symmetric draft while using only the primary normal for depths", () => {
  const baseSolid = cutCube();
  const normal = { x: 1, y: 0, z: 0 };
  const candidates = generateJumpCandidates({ baseSolid, normal });
  const classified = candidates.map((candidate) => classifyJumpCandidate({
    candidate, baseSolid, normal,
    planesForDepth: (depth) => [
      { normal: { x: 1, y: 0, z: 0 }, offset: 1 - depth, faceId: "draft:primary" },
      { normal: { x: -1, y: 0, z: 0 }, offset: -0.75, faceId: "draft:mirror" },
    ],
  }));

  assert.ok(classified.every((candidate) => candidate.classification === JUMP_CLASSIFICATION.DESTRUCTIVE));
  assert.ok(classified.every((candidate) => candidate.threats.some(({ operationId }) => operationId === "C1")));
});

test("classifying one Jump stop resolves its repeated and mirrored planes once without classifying other stops", () => {
  const baseSolid = cutCube();
  const pattern = { patternId: "draft", region: "crown", baseIndex: 33, repeat: 8, mirror: 3, industryAngleDeg: 30.97 };
  const facetsAtDepth = (depth) => resolveFacetPattern({ ...pattern, depth });
  const initialFacets = facetsAtDepth(0);
  const normal = initialFacets.find((facet) => facet.index === pattern.baseIndex).plane.normal;
  const candidates = generateJumpCandidates({ baseSolid, normal });
  assert.ok(candidates.length > 2);
  assert.equal(initialFacets.length, 16);
  const originalCandidates = structuredClone(candidates);
  const selected = candidates[1];
  const planes = facetsAtDepth(selected.depth).map((facet) => ({
    ...facet.plane, faceId: facet.id, operationId: facet.patternId, region: facet.region,
  }));
  const expected = evaluateDraftImpact({ baseSolid, planes });
  let resolutions = 0;
  const classified = classifyJumpCandidate({
    candidate: selected, baseSolid, normal,
    planesForDepth: (depth) => {
      resolutions += 1;
      assert.equal(depth, selected.depth);
      return planes;
    },
  });

  assert.equal(resolutions, 1);
  assert.deepEqual(classified, {
    ...selected, classification: expected.classification, threats: expected.threats,
  });
  assert.deepEqual(candidates, originalCandidates);
});

test("persisted vertex targets resolve only while topology and source geometry signatures still match", () => {
  const original = cutCube();
  const target = enumerateTopologyVertices(original)
    .find((candidate) => candidate.sourceFaceIds.includes("C1:96")
      && candidate.fallbackWorldPoint[1] === 1);
  const valid = resolvePersistedMeetTarget(target, structuredClone(original));
  assert.equal(valid.status, MEET_STATUS.VALID);
  assert.deepEqual(valid.target, target);

  const topologyChanged = clipPolyhedron(original, {
    normal: { x: 0, y: 1, z: 0 },
    offset: 0.5,
    operationId: "C2",
    faceId: "C2:24",
  });
  const missing = resolvePersistedMeetTarget(target, topologyChanged);
  assert.equal(missing.status, MEET_STATUS.STALE);
  assert.equal(missing.reason, "topology-missing");

  const geometryChanged = structuredClone(original);
  geometryChanged.vertices[target.vertexIndex].x -= 0.1;
  const changed = resolvePersistedMeetTarget(target, geometryChanged);
  assert.equal(changed.status, MEET_STATUS.STALE);
  assert.equal(changed.reason, "geometry-changed");
  assert.ok(changed.target);
});
