import test from "node:test";
import assert from "node:assert/strict";
import { createFacetingDocument, resolveFacetPattern, exportFacetingJSON, importFacetingJSON } from "./faceting.js";
import { buildConstructionStages } from "./constructionHistory.js";
import { enumerateTopologyVertices, enumerateTopologyEdges, createEdgeMeetTarget, solveDualMeet } from "./meetJump.js";
import { createCutSession, cutSessionReducer, resolveCutSession, CUT_SESSION_EVENT } from "./cutSession.js";
import { parseCustomIndices, resolveDraftGeometry, snapshotMeetTarget, solveDraftConstruction } from "./cutConstruction.js";

function setup() {
  const source = resolveFacetPattern({ patternId: "p1", label: "P1", region: "pavilion", baseIndex: 0, repeat: 4, industryAngleDeg: 41, depth: 0.42 });
  const document = createFacetingDocument({ facets: source });
  const baseSolid = buildConstructionStages(document)[0].afterSolid;
  const vertices = enumerateTopologyVertices(baseSolid);
  const edges = enumerateTopologyEdges(baseSolid, { targets: vertices });
  const draft = { patternMode: "arbitrary", customIndices: "96 6 30 54", baseIndex: 6, repeat: 4, mirrorOffset: 0, industryAngle: 32, depth: 0.1, preform: true };
  return { source, document, stock: document.stock, baseSolid, vertices, edges, draft, region: "crown" };
}

function saveSolved(context, result) {
  const meet = result.meet;
  const construction = {
    type: meet.secondTarget ? "dual-meet" : meet.target.kind === "edge-point" ? "edge-meet" : "vertex-meet",
    solverVersion: 2, primaryIndex: result.draft.baseIndex,
    target: snapshotMeetTarget(meet.target),
    ...(meet.secondTarget ? { secondTarget: snapshotMeetTarget(meet.secondTarget) } : {}),
  };
  const facets = resolveDraftGeometry(result.draft, context.region, context.stock).facets.map((facet) => ({
    ...facet, metadata: { patternMode: result.draft.patternMode, primaryIndex: result.draft.baseIndex, preform: true, construction },
  }));
  const document = createFacetingDocument({ facets: [...context.source, ...facets] });
  const restored = importFacetingJSON(exportFacetingJSON(document));
  assert.deepEqual(restored, document);
  assert.equal(buildConstructionStages(restored).at(-1).construction.status, "valid");
  return restored;
}

function findPair(context, angle = (value) => value > 1 && value < 89) {
  for (const target of context.vertices) {
    for (const secondTarget of context.vertices) {
      const solved = solveDualMeet({ targetA: target, targetB: secondTarget, baseIndex: context.draft.baseIndex, region: context.region, stock: context.stock });
      if (solved.status === "valid" && angle(solved.industryAngleDeg)) return { target, secondTarget };
    }
  }
  throw new Error("Fixture has no requested pair");
}

test("custom primary uses its selected member, preserves the set and persists vertex/edge snapshots", () => {
  const context = setup();
  assert.deepEqual(parseCustomIndices(context.draft.customIndices).indices, [6, 30, 54, 0]);
  const targets = [context.vertices.find((target) => solveDraftConstruction({ ...context, meet: { target } }).meet.status === "valid"),
    context.edges.map((edge) => createEdgeMeetTarget(edge, 0.95)).find((target) => solveDraftConstruction({ ...context, meet: { target } }).meet.status === "valid")];
  for (const target of targets) {
    const result = solveDraftConstruction({ ...context, meet: { target } });
    assert.equal(result.meet.status, "valid");
    assert.equal(result.draft.baseIndex, 6);
    assert.equal(result.draft.customIndices, context.draft.customIndices);
    const saved = saveSolved(context, result);
    const construction = saved.facets.at(-1).metadata.construction;
    assert.equal(construction.primaryIndex, 6);
    assert.equal(construction.target.vertexIndex, undefined);
    if (construction.target.endpoints) assert.ok(construction.target.endpoints.every((endpoint) => endpoint.vertexIndex === undefined));
  }
});

test("dual solver, snapshot validator and saved-stage diagnostics agree including ordinary horizontal cuts", () => {
  const context = setup();
  for (const pair of [findPair(context), findPair(context, (angle) => angle === 0)]) {
    const result = solveDraftConstruction({ ...context, meet: pair });
    assert.equal(result.meet.status, "valid");
    saveSolved(context, result);
  }
});

test("saved valid Meet selection stays clean until a change; cancelling B preview restores the exact A draft", () => {
  const context = setup();
  const pair = findPair(context);
  const single = solveDraftConstruction({ ...context, meet: { target: pair.target } });
  const initial = createCutSession("edit", { patternId: "edited", region: context.region, draft: single.draft, construction: { meet: single.meet } });
  assert.equal(resolveCutSession(initial).previewEnabled, false);
  assert.equal(resolveCutSession(initial).canCommit, false);
  const dual = solveDraftConstruction({ ...context, draft: single.draft, meet: pair });
  const candidate = { target: pair.secondTarget, depth: dual.draft.depth, industryAngleDeg: dual.draft.industryAngle, status: "valid", classification: "facet", key: pair.secondTarget.topologyKey };
  const preview = cutSessionReducer(initial, { type: CUT_SESSION_EVENT.SELECT_MEET_CANDIDATE, candidate });
  assert.equal(preview.draft.industryAngle, dual.draft.industryAngle);
  assert.equal(preview.construction.meet.secondTarget, undefined);
  const restored = cutSessionReducer(preview, { type: CUT_SESSION_EVENT.CANCEL_CONSTRUCTION_TOOL });
  assert.deepEqual(restored.draft, initial.draft);
  assert.deepEqual(restored.construction.meet, initial.construction.meet);
  assert.equal(restored.dirty, false);
});

test("removing A promotes B and re-solves its single depth; stale sources never consume fallback coordinates", () => {
  const context = setup();
  const pair = findPair(context);
  const dual = solveDraftConstruction({ ...context, meet: pair });
  const session = createCutSession("edit", { patternId: "edited", region: context.region, draft: dual.draft, construction: { meet: dual.meet } });
  const promoted = solveDraftConstruction({ ...context, draft: dual.draft, meet: { target: pair.secondTarget } });
  const changed = cutSessionReducer(session, { type: CUT_SESSION_EVENT.CLEAR_MEET, slot: "A", meet: promoted.meet, patch: promoted.draft });
  assert.deepEqual(changed.construction.meet.target, pair.secondTarget);
  assert.equal(changed.construction.meet.secondTarget, undefined);
  assert.equal(resolveCutSession(changed).angleEditable, true);
  assert.equal(resolveCutSession(changed).depthEditable, false);
  const staleTarget = { ...pair.target, topologyKey: "vertex:deleted", fallbackWorldPoint: [0, 0, 0] };
  const stale = solveDraftConstruction({ ...context, meet: { target: staleTarget } });
  assert.equal(stale.meet.status, "stale");
  assert.equal(stale.draft, context.draft);
  assert.deepEqual(stale.meet.target, staleTarget);
});

test("custom primary removal is blocked without silently choosing a different member", () => {
  const context = setup();
  const target = context.vertices.find((item) => solveDraftConstruction({ ...context, meet: { target: item } }).meet.status === "valid");
  const solved = solveDraftConstruction({ ...context, meet: { target } });
  const session = createCutSession("edit", { patternId: "custom", region: context.region, draft: solved.draft, construction: { meet: solved.meet } });
  const removed = cutSessionReducer(session, { type: CUT_SESSION_EVENT.CHANGE_DRAFT, patch: { customIndices: "96 30 54" } });
  assert.equal(removed, session);
  const invalid = resolveDraftGeometry({ ...context.draft, customIndices: "96 30 54" }, context.region, context.stock);
  assert.equal(invalid.facets.length, 0);
  assert.match(invalid.error, /主切面/);
});
