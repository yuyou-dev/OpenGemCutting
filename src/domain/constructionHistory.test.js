import test from "node:test";
import assert from "node:assert/strict";
import { createFacetingDocument, resolveFacetPattern } from "./faceting.js";
import { clipPolyhedronByPlanes } from "./geometry.js";
import { enumerateTopologyVertices, enumerateTopologyEdges, createEdgeMeetTarget, solveVertexMeet } from "./meetJump.js";
import { buildConstructionStages } from "./constructionHistory.js";

function fixture(kind = "vertex") {
  const source = resolveFacetPattern({ patternId: "p1", region: "pavilion", baseIndex: 0, repeat: 4, industryAngleDeg: 41, depth: 0.42 });
  const document = createFacetingDocument({ facets: source });
  const solid = buildConstructionStages(document)[0].afterSolid;
  const target = kind === "edge"
    ? createEdgeMeetTarget(enumerateTopologyEdges(solid).find((edge) => edge.sourceOperationIds.includes("p1")), 0.95)
    : enumerateTopologyVertices(solid).find((vertex) => vertex.sourceOperationIds.includes("p1"));
  const params = { patternId: "c1", region: "crown", baseIndex: 6, repeat: 4, industryAngleDeg: 32, depth: 0.1 };
  const primary = resolveFacetPattern(params).find((facet) => facet.index === 6);
  const solved = solveVertexMeet({ normal: primary.plane.normal, target, stock: document.stock });
  const construction = kind === "edge"
    ? { type: "edge-meet", solverVersion: 2, primaryIndex: 6, target }
    : { type: "vertex-meet", solverVersion: 1, target };
  const crown = resolveFacetPattern({ ...params, depth: solved.depth, metadata: { patternMode: "symmetric", construction } });
  return createFacetingDocument({ facets: [...source, ...crown] });
}

test("construction stages match exact sequential clipping and remain read-only", () => {
  const document = fixture();
  const snapshot = structuredClone(document);
  const stages = buildConstructionStages(document);
  assert.equal(stages[1].beforeSolid, stages[0].afterSolid);
  assert.equal(stages[1].construction.status, "valid");
  const expected = clipPolyhedronByPlanes(stages[0].beforeSolid, document.facets.map((facet) => ({
    ...facet.plane, operationId: facet.patternId, faceId: facet.id, region: facet.region,
  })));
  assert.deepEqual(stages.at(-1).afterSolid, expected);
  assert.deepEqual(document, snapshot);
});

test("saved edge intent resolves on the prefix and reports source hide/delete/reorder without changing geometry", () => {
  const document = fixture("edge");
  assert.equal(buildConstructionStages(document)[1].construction.status, "valid");
  const hidden = buildConstructionStages(document, { hiddenPatternIds: ["p1"] });
  assert.equal(hidden[0].beforeSolid, hidden[0].afterSolid);
  assert.equal(hidden[1].construction.reason, "source-hidden");
  const crown = document.facets.filter((facet) => facet.patternId === "c1");
  const source = document.facets.filter((facet) => facet.patternId === "p1");
  assert.equal(buildConstructionStages({ ...document, facets: crown })[0].construction.reason, "source-missing");
  const reordered = buildConstructionStages({ ...document, facets: [...crown, ...source] });
  assert.equal(reordered[0].construction.reason, "source-order");
  assert.deepEqual(reordered[0].facets, crown);
  assert.equal(buildConstructionStages(document)[1].construction.status, "valid");
});

test("changes to source signatures and primary plane produce distinct stale diagnostics", () => {
  const document = fixture();
  const changedSource = resolveFacetPattern({ patternId: "p1", region: "pavilion", baseIndex: 0, repeat: 4, industryAngleDeg: 41, depth: 0.43 });
  const changed = buildConstructionStages({ ...document, facets: [...changedSource, ...document.facets.filter((facet) => facet.patternId === "c1")] });
  assert.ok(["geometry-changed", "topology-missing"].includes(changed[1].construction.reason));
  const movedPlane = structuredClone(document);
  movedPlane.facets.find((facet) => facet.patternId === "c1" && facet.index === 6).plane.offset += 0.01;
  assert.equal(buildConstructionStages(movedPlane)[1].construction.reason, "plane-mismatch");
});

test("dual saved intent checks both points and rejects a non-unique pair", async () => {
  const { solveDualMeet } = await import("./meetJump.js");
  const document = fixture();
  const source = document.facets.filter((facet) => facet.patternId === "p1");
  const base = buildConstructionStages({ ...document, facets: source })[0].afterSolid;
  const targets = enumerateTopologyVertices(base);
  let pair;
  for (const targetA of targets) {
    for (const targetB of targets) {
      const solved = solveDualMeet({ targetA, targetB, region: "crown", baseIndex: 6, stock: document.stock });
      if (solved.status === "valid" && solved.industryAngleDeg > 1 && solved.industryAngleDeg < 89) pair = { targetA, targetB, solved };
      if (pair) break;
    }
    if (pair) break;
  }
  assert.ok(pair);
  const construction = { type: "dual-meet", solverVersion: 2, primaryIndex: 6, target: pair.targetA, secondTarget: pair.targetB };
  const crown = resolveFacetPattern({ patternId: "dual", region: "crown", baseIndex: 6, repeat: 4,
    industryAngleDeg: pair.solved.industryAngleDeg, depth: pair.solved.depth,
    metadata: { patternMode: "symmetric", construction } });
  const dual = createFacetingDocument({ facets: [...source, ...crown] });
  assert.equal(buildConstructionStages(dual)[1].construction.status, "valid");
  const duplicate = structuredClone(dual);
  duplicate.facets.filter((facet) => facet.patternId === "dual").forEach((facet) => {
    facet.metadata.construction.secondTarget = facet.metadata.construction.target;
  });
  assert.equal(buildConstructionStages(duplicate)[1].construction.reason, "duplicate-points");
});
