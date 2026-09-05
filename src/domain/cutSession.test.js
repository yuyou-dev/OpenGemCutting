import assert from "node:assert/strict";
import test from "node:test";
import {
  CUT_SESSION_EVENT,
  CUT_SESSION_MODE,
  CUT_SESSION_TABLE,
  createCutSession,
  cutSessionReducer,
  defaultDraftForRegion,
  resolveCutSession,
} from "./cutSession.js";

const LAYER_DRAFT = Object.freeze({
  industryAngle: 41.25,
  depth: 0.5,
  baseIndex: 8,
  repeat: 8,
  mirrorOffset: 3,
  patternMode: "symmetric",
  customIndices: "02 22",
});

const MEET_TARGET = Object.freeze({
  topologyKey: "v:C1.0|G1.2|G1.3",
  sourceFaceIds: ["C1.0", "G1.2", "G1.3"],
  sourceOperationIds: ["C1", "G1"],
  sourceGeometrySignature: "geometry-1",
  fallbackWorldPoint: [0.2, -0.1, 0.3],
});

const VALID_CANDIDATE = Object.freeze({
  source: "manual",
  key: MEET_TARGET.topologyKey,
  target: MEET_TARGET,
  depth: 0.625,
  classification: "valid",
  threats: [],
});

const VALID_MEET = Object.freeze({
  target: MEET_TARGET,
  status: "valid",
  requiredDepth: 0.625,
  residual: 0,
  threats: [],
});

test("defines one closed interaction contract for every CUT mode", () => {
  Object.values(CUT_SESSION_MODE).forEach((mode) => {
    const config = CUT_SESSION_TABLE[mode];
    assert.ok(config);
    if (mode !== CUT_SESSION_MODE.IDLE) {
      assert.equal(config.canCancel, true);
      assert.ok(config.exitLabel);
    }
  });
});

test("every mode defines the same capability keys", () => {
  const expected = Object.keys(CUT_SESSION_TABLE[CUT_SESSION_MODE.IDLE]).sort();
  Object.values(CUT_SESSION_MODE).forEach((mode) => {
    assert.deepEqual(Object.keys(CUT_SESSION_TABLE[mode]).sort(), expected);
  });
});

test("resolveCutSession invariants per mode", () => {
  const idle = resolveCutSession(createCutSession());
  assert.equal(idle.previewEnabled, false);
  assert.equal(idle.canCommit, false);
  assert.ok(idle.draft);
  assert.equal(idle.group, null);
  assert.deepEqual(idle.construction, { tool: "none", candidate: null, meet: null });
  assert.equal(idle.canUseMeetJump, false);
  assert.equal(idle.depthEditable, false);

  const create = resolveCutSession(createCutSession(CUT_SESSION_MODE.CREATE, { region: "crown" }));
  assert.equal(create.dirty, true);
  assert.equal(create.previewEnabled, true);
  assert.equal(create.canCommit, true);
  assert.equal(create.canUseMeetJump, true);
  assert.equal(create.depthEditable, true);

  const edit = createCutSession(CUT_SESSION_MODE.EDIT, { patternId: "P2", region: "pavilion", draft: LAYER_DRAFT });
  assert.equal(resolveCutSession(edit).canCommit, false);
  assert.equal(resolveCutSession(edit).previewEnabled, false);
  const editDirty = cutSessionReducer(edit, { type: CUT_SESSION_EVENT.CHANGE_DRAFT, patch: { depth: 0.4 } });
  assert.equal(resolveCutSession(editDirty).canCommit, true);
  assert.equal(resolveCutSession(editDirty).previewEnabled, true);

  const group = createCutSession(CUT_SESSION_MODE.GROUP, { region: "crown" });
  assert.equal(resolveCutSession(group).canCommit, group.dirty);
  assert.equal(resolveCutSession(group).canCommit, false);
  const groupDirty = cutSessionReducer(group, { type: CUT_SESSION_EVENT.CHANGE_GROUP, patch: { rotationTeeth: 2 } });
  assert.equal(resolveCutSession(groupDirty).canCommit, groupDirty.dirty);
  assert.equal(resolveCutSession(groupDirty).canCommit, true);
});

test("every resolved mode exposes the same Meet and Jump capability keys", () => {
  const capabilityKeys = [
    "canUseMeetJump",
    "canJumpPrevious",
    "canJumpNext",
    "canPickMeetTarget",
    "canLockMeet",
    "canCancelConstructionTool",
    "depthEditable",
    "constructionValid",
  ];
  Object.values(CUT_SESSION_MODE).forEach((mode) => {
    const view = resolveCutSession(createCutSession(mode, {
      patternId: "C1",
      region: "crown",
      draft: LAYER_DRAFT,
    }));
    capabilityKeys.forEach((key) => assert.equal(typeof view[key], "boolean", `${mode}.${key}`));
  });
});

test("Meet and Jump are available only to symmetric crown and pavilion drafts", () => {
  for (const mode of Object.values(CUT_SESSION_MODE)) {
    for (const region of ["crown", "girdle", "pavilion"]) {
      for (const patternMode of ["symmetric", "arbitrary"]) {
        let session = createCutSession(mode, {
          patternId: "C1",
          region,
          draft: { ...LAYER_DRAFT, patternMode },
        });
        if (mode === CUT_SESSION_MODE.CREATE && patternMode === "arbitrary") {
          session = cutSessionReducer(session, {
            type: CUT_SESSION_EVENT.CHANGE_DRAFT,
            patch: { patternMode },
          });
        }
        const view = resolveCutSession(session);
        const expected = (mode === CUT_SESSION_MODE.CREATE || mode === CUT_SESSION_MODE.EDIT)
          && (region === "crown" || region === "pavilion")
          && patternMode === "symmetric";
        assert.equal(view.canUseMeetJump, expected, `${mode}/${region}/${patternMode}`);
        assert.equal(view.canPickMeetTarget, expected, `${mode}/${region}/${patternMode}`);
      }
    }
  }
});

test("fixed table layers keep zero degrees and never expose Meet or Jump", () => {
  const edit = createCutSession(CUT_SESSION_MODE.EDIT, {
    patternId: "table-facet",
    region: "crown",
    lockedLayer: true,
    draft: { ...LAYER_DRAFT, industryAngle: 0 },
  });
  assert.equal(resolveCutSession(edit).canUseMeetJump, false);
  const changed = cutSessionReducer(edit, {
    type: CUT_SESSION_EVENT.CHANGE_DRAFT,
    patch: { industryAngle: 35, depth: 0.35 },
  });
  assert.equal(changed.draft.industryAngle, 0);
  assert.equal(changed.draft.depth, 0.35);
});

test("every active session cancels back to idle keeping its region", () => {
  const sessions = [
    createCutSession(CUT_SESSION_MODE.CREATE, { region: "crown" }),
    createCutSession(CUT_SESSION_MODE.EDIT, { patternId: "C1", region: "crown", draft: LAYER_DRAFT }),
    createCutSession(CUT_SESSION_MODE.GROUP, { region: "pavilion" }),
  ];
  sessions.forEach((session) => {
    const cancelled = cutSessionReducer(session, { type: CUT_SESSION_EVENT.CANCEL });
    assert.equal(cancelled.mode, CUT_SESSION_MODE.IDLE);
    assert.equal(cancelled.region, session.region);
    assert.deepEqual(cancelled, createCutSession(CUT_SESSION_MODE.IDLE, {
      region: session.region,
      baseDraft: session.draft,
    }));
  });
});

test("region defaults rebuild drafts while index preferences survive", () => {
  assert.deepEqual(defaultDraftForRegion("crown"), {
    industryAngle: 32,
    depth: 0,
    baseIndex: 36,
    repeat: 8,
    mirrorOffset: 0,
    patternMode: "symmetric",
    customIndices: "02 22 26 46 50 70 74 94",
  });
  assert.equal(defaultDraftForRegion("girdle").repeat, 16);
  assert.equal(defaultDraftForRegion("pavilion").depth, 0);

  const create = createCutSession(CUT_SESSION_MODE.CREATE, { region: "crown" });
  const tuned = cutSessionReducer(create, {
    type: CUT_SESSION_EVENT.CHANGE_DRAFT,
    patch: { baseIndex: 12, customIndices: "01 02", depth: 0.9 },
  });
  const restarted = cutSessionReducer(tuned, { type: CUT_SESSION_EVENT.CHANGE_REGION, region: "girdle" });
  assert.equal(restarted.mode, CUT_SESSION_MODE.CREATE);
  assert.equal(restarted.region, "girdle");
  assert.equal(restarted.draft.industryAngle, 90);
  assert.equal(restarted.draft.depth, 0.2);
  assert.equal(restarted.draft.repeat, 16);
  assert.equal(restarted.draft.mirrorOffset, 0);
  assert.equal(restarted.draft.baseIndex, 12);
  assert.equal(restarted.draft.customIndices, "01 02");
});

test("idle region changes retarget the filter without leaving idle", () => {
  const idle = createCutSession();
  const next = cutSessionReducer(idle, { type: CUT_SESSION_EVENT.CHANGE_REGION, region: "pavilion" });
  assert.equal(next.mode, CUT_SESSION_MODE.IDLE);
  assert.equal(next.region, "pavilion");
  assert.deepEqual(next.draft, defaultDraftForRegion("pavilion", idle.draft));
});

test("selecting a layer enters a clean edit session carrying the layer draft", () => {
  const idle = createCutSession(CUT_SESSION_MODE.IDLE, { region: "crown" });
  const edit = cutSessionReducer(idle, {
    type: CUT_SESSION_EVENT.SELECT_LAYER,
    patternId: "C1",
    region: "crown",
    draft: LAYER_DRAFT,
  });
  assert.equal(edit.mode, CUT_SESSION_MODE.EDIT);
  assert.equal(edit.dirty, false);
  assert.deepEqual(edit.draft, LAYER_DRAFT);
  assert.equal(resolveCutSession(edit).previewEnabled, false);
  assert.equal(resolveCutSession(edit).activePatternId, "C1");
});

test("selecting a layer can restore a validated Meet construction", () => {
  const idle = createCutSession();
  const edit = cutSessionReducer(idle, {
    type: CUT_SESSION_EVENT.SELECT_LAYER,
    patternId: "C2",
    region: "crown",
    draft: LAYER_DRAFT,
    construction: { tool: "none", candidate: null, meet: VALID_MEET },
  });
  assert.deepEqual(edit.construction, { tool: "none", candidate: null, meet: VALID_MEET });
  assert.equal(edit.dirty, false);
  assert.equal(resolveCutSession(edit).depthEditable, false);
  assert.equal(resolveCutSession(edit).constructionValid, true);

  const bareMeet = cutSessionReducer(idle, {
    type: CUT_SESSION_EVENT.SELECT_LAYER,
    patternId: "C3",
    region: "crown",
    draft: LAYER_DRAFT,
    construction: VALID_MEET,
  });
  assert.deepEqual(bareMeet.construction.meet, VALID_MEET);
});

test("draft changes merge patches and make edit committable without changing its identity", () => {
  const clean = createCutSession(CUT_SESSION_MODE.EDIT, { patternId: "P2", region: "pavilion", draft: LAYER_DRAFT });
  assert.equal(resolveCutSession(clean).canCommit, false);
  const dirty = cutSessionReducer(clean, {
    type: CUT_SESSION_EVENT.CHANGE_DRAFT,
    patch: { industryAngle: 40.5 },
  });
  assert.equal(dirty.draft.industryAngle, 40.5);
  assert.equal(dirty.draft.depth, LAYER_DRAFT.depth);
  assert.equal(dirty.patternId, "P2");
  assert.equal(resolveCutSession(dirty).canCommit, true);
  assert.equal(resolveCutSession(dirty).activePatternId, "P2");
});

test("ordinary draft changes clear transient candidates", () => {
  const create = createCutSession(CUT_SESSION_MODE.CREATE, { region: "crown" });
  const selected = cutSessionReducer(create, {
    type: CUT_SESSION_EVENT.SELECT_MEET_CANDIDATE,
    candidate: VALID_CANDIDATE,
  });
  assert.deepEqual(selected.construction.candidate, VALID_CANDIDATE);
  const changed = cutSessionReducer(selected, {
    type: CUT_SESSION_EVENT.CHANGE_DRAFT,
    patch: { baseIndex: 24 },
  });
  assert.equal(changed.construction.candidate, null);
  assert.equal(changed.draft.baseIndex, 24);
  assert.equal(changed.draft.depth, VALID_CANDIDATE.depth);
});

test("Meet picking is explicit and cancelling the tool preserves an existing Meet", () => {
  const edit = createCutSession(CUT_SESSION_MODE.EDIT, {
    patternId: "C1",
    region: "crown",
    draft: LAYER_DRAFT,
    construction: { meet: VALID_MEET },
  });
  const picking = cutSessionReducer(edit, { type: CUT_SESSION_EVENT.START_MEET_PICK });
  assert.equal(picking.construction.tool, "pick-vertex");
  assert.deepEqual(picking.construction.meet, VALID_MEET);
  assert.equal(resolveCutSession(picking).canCancelConstructionTool, true);
  assert.equal(picking.dirty, false);

  const cancelled = cutSessionReducer(picking, { type: CUT_SESSION_EVENT.CANCEL_CONSTRUCTION_TOOL });
  assert.equal(cancelled.construction.tool, "none");
  assert.equal(cancelled.construction.candidate, null);
  assert.deepEqual(cancelled.construction.meet, VALID_MEET);
  assert.equal(cancelled.dirty, false);
});

test("choosing a replacement target clears the old Meet only after selection", () => {
  const edit = createCutSession(CUT_SESSION_MODE.EDIT, {
    patternId: "C1",
    region: "crown",
    draft: LAYER_DRAFT,
    construction: { meet: VALID_MEET },
  });
  const picking = cutSessionReducer(edit, { type: CUT_SESSION_EVENT.START_MEET_PICK });
  assert.deepEqual(picking.construction.meet, VALID_MEET);
  const selected = cutSessionReducer(picking, {
    type: CUT_SESSION_EVENT.SELECT_MEET_CANDIDATE,
    candidate: { ...VALID_CANDIDATE, key: "replacement" },
  });
  assert.equal(selected.construction.meet, null);
  assert.equal(selected.construction.candidate.key, "replacement");
  assert.equal(resolveCutSession(selected).canLockMeet, true);
});

test("selecting, locking, and clearing a Meet updates one construction substate", () => {
  const create = createCutSession(CUT_SESSION_MODE.CREATE, { region: "pavilion" });
  const picking = cutSessionReducer(create, { type: CUT_SESSION_EVENT.START_MEET_PICK });
  const selected = cutSessionReducer(picking, {
    type: CUT_SESSION_EVENT.SELECT_MEET_CANDIDATE,
    candidate: VALID_CANDIDATE,
  });
  assert.equal(selected.construction.tool, "none");
  assert.deepEqual(selected.construction.candidate, VALID_CANDIDATE);
  assert.equal(selected.draft.depth, VALID_CANDIDATE.depth);
  assert.equal(resolveCutSession(selected).canLockMeet, true);

  const locked = cutSessionReducer(selected, {
    type: CUT_SESSION_EVENT.LOCK_MEET,
    meet: VALID_MEET,
  });
  assert.deepEqual(locked.construction, { tool: "none", candidate: null, meet: VALID_MEET });
  assert.equal(resolveCutSession(locked).depthEditable, false);
  assert.equal(resolveCutSession(locked).constructionValid, true);
  assert.equal(resolveCutSession(locked).canCommit, true);

  const cleared = cutSessionReducer(locked, { type: CUT_SESSION_EVENT.CLEAR_MEET });
  assert.deepEqual(cleared.construction, { tool: "none", candidate: null, meet: null });
  assert.equal(resolveCutSession(cleared).depthEditable, true);
});

test("destructive candidates stay committable for the shared impact confirmation", () => {
  const create = createCutSession(CUT_SESSION_MODE.CREATE, { region: "crown" });
  const selected = cutSessionReducer(create, {
    type: CUT_SESSION_EVENT.SELECT_MEET_CANDIDATE,
    candidate: { ...VALID_CANDIDATE, classification: "destructive", threats: ["C1"] },
  });
  assert.equal(resolveCutSession(selected).canLockMeet, true);
  assert.equal(resolveCutSession(selected).constructionValid, true);
  assert.equal(resolveCutSession(selected).canCommit, true);

  const locked = cutSessionReducer(selected, { type: CUT_SESSION_EVENT.LOCK_MEET });
  assert.equal(locked.construction.meet.status, "destructive");
  assert.equal(resolveCutSession(locked).canCommit, true);
});

test("unreachable candidates preserve the last valid depth and cannot be locked", () => {
  const create = createCutSession(CUT_SESSION_MODE.CREATE, { region: "crown" });
  const selected = cutSessionReducer(create, {
    type: CUT_SESSION_EVENT.SELECT_MEET_CANDIDATE,
    candidate: { ...VALID_CANDIDATE, depth: -0.25, status: "unreachable" },
  });
  assert.equal(selected.draft.depth, create.draft.depth);
  assert.equal(resolveCutSession(selected).constructionValid, false);
  assert.equal(resolveCutSession(selected).canLockMeet, false);
  assert.equal(resolveCutSession(selected).canCommit, false);
});

test("locked Meet draft changes atomically merge solver depth and result", () => {
  const edit = createCutSession(CUT_SESSION_MODE.EDIT, {
    patternId: "C1",
    region: "crown",
    draft: LAYER_DRAFT,
    construction: { meet: VALID_MEET, candidate: VALID_CANDIDATE },
  });
  const recomputedMeet = { ...VALID_MEET, requiredDepth: 0.64, residual: 1e-10 };
  const changed = cutSessionReducer(edit, {
    type: CUT_SESSION_EVENT.CHANGE_DRAFT,
    patch: { industryAngle: 40.8, depth: 0.64 },
    constructionResult: { meet: recomputedMeet },
  });
  assert.equal(changed.draft.industryAngle, 40.8);
  assert.equal(changed.draft.depth, 0.64);
  assert.equal(changed.construction.candidate, null);
  assert.deepEqual(changed.construction.meet, recomputedMeet);
  assert.equal(resolveCutSession(changed).constructionValid, true);
  assert.equal(resolveCutSession(changed).canCommit, true);
});

test("locked Meet changes without a solver result become stale", () => {
  const edit = createCutSession(CUT_SESSION_MODE.EDIT, {
    patternId: "C1",
    region: "crown",
    draft: LAYER_DRAFT,
    construction: { meet: VALID_MEET },
  });
  const changed = cutSessionReducer(edit, {
    type: CUT_SESSION_EVENT.CHANGE_DRAFT,
    patch: { baseIndex: 9 },
  });
  assert.equal(changed.construction.meet.status, "stale");
  assert.equal(resolveCutSession(changed).constructionValid, false);
  assert.equal(resolveCutSession(changed).canCommit, false);
  assert.equal(resolveCutSession(changed).depthEditable, false);
});

test("unreachable and stale Meet statuses block draft commits", () => {
  for (const status of ["unreachable", "stale"]) {
    const create = createCutSession(CUT_SESSION_MODE.CREATE, {
      region: "crown",
      construction: { meet: { ...VALID_MEET, status } },
    });
    const view = resolveCutSession(create);
    assert.equal(view.constructionValid, false, status);
    assert.equal(view.canCommit, false, status);
  }
});

test("girdle sessions force the industry angle back to 90 degrees on any patch", () => {
  const edit = createCutSession(CUT_SESSION_MODE.EDIT, {
    patternId: "G1",
    region: "girdle",
    draft: { ...LAYER_DRAFT, industryAngle: 90 },
  });
  const edited = cutSessionReducer(edit, {
    type: CUT_SESSION_EVENT.CHANGE_DRAFT,
    patch: { industryAngle: 88.5 },
  });
  assert.equal(edited.draft.industryAngle, 90);
  assert.equal(edited.dirty, true);

  const create = createCutSession(CUT_SESSION_MODE.CREATE, { region: "girdle" });
  const created = cutSessionReducer(create, {
    type: CUT_SESSION_EVENT.CHANGE_DRAFT,
    patch: { industryAngle: 45 },
  });
  assert.equal(created.draft.industryAngle, 90);

  const combined = cutSessionReducer(edit, {
    type: CUT_SESSION_EVENT.CHANGE_DRAFT,
    patch: { industryAngle: 30, depth: 0.3 },
  });
  assert.equal(combined.draft.industryAngle, 90);
  assert.equal(combined.draft.depth, 0.3);
});

test("group changes merge patches and derive the dirty flag from group values", () => {
  const clean = createCutSession(CUT_SESSION_MODE.GROUP, { region: "crown" });
  assert.equal(resolveCutSession(clean).active, true);
  assert.equal(resolveCutSession(clean).canCommit, false);
  assert.deepEqual(clean.group, { deltaZ: 0, scale: 1, rotationTeeth: 0 });

  const moved = cutSessionReducer(clean, { type: CUT_SESSION_EVENT.CHANGE_GROUP, patch: { deltaZ: 0.1 } });
  assert.equal(moved.dirty, true);
  assert.equal(resolveCutSession(moved).canCommit, true);
  assert.equal(resolveCutSession(moved).groupRegion, "crown");

  const scaled = cutSessionReducer(clean, { type: CUT_SESSION_EVENT.CHANGE_GROUP, patch: { scale: 1 + 1e-8 } });
  assert.equal(scaled.dirty, true);
  const negligible = cutSessionReducer(clean, { type: CUT_SESSION_EVENT.CHANGE_GROUP, patch: { scale: 1 + 1e-10 } });
  assert.equal(negligible.dirty, false);

  const reset = cutSessionReducer(moved, { type: CUT_SESSION_EVENT.CHANGE_GROUP, patch: { deltaZ: 0 } });
  assert.equal(reset.dirty, false);
  assert.equal(resolveCutSession(reset).canCommit, false);
});

test("document and commit events choose explicit terminal states", () => {
  const edit = createCutSession(CUT_SESSION_MODE.EDIT, { patternId: "C1", region: "crown", draft: LAYER_DRAFT });
  assert.equal(cutSessionReducer(edit, { type: CUT_SESSION_EVENT.COMMIT_SUCCESS }).mode, CUT_SESSION_MODE.IDLE);
  assert.equal(cutSessionReducer(edit, { type: CUT_SESSION_EVENT.DOCUMENT_IMPORT }).mode, CUT_SESSION_MODE.IDLE);
  const created = cutSessionReducer(edit, { type: CUT_SESSION_EVENT.DOCUMENT_CREATE, region: "crown" });
  assert.equal(created.mode, CUT_SESSION_MODE.CREATE);
  assert.equal(created.draft.baseIndex, 36);
  assert.equal(created.draft.customIndices, LAYER_DRAFT.customIndices);
});

test("only idle mode can select layers, mutate the stack, or start a group", () => {
  Object.values(CUT_SESSION_MODE).forEach((mode) => {
    const view = resolveCutSession(createCutSession(mode, { patternId: "C1", region: "crown" }));
    const idle = mode === CUT_SESSION_MODE.IDLE;
    assert.equal(view.canPickLayer, idle);
    assert.equal(view.canMutateStack, idle);
    assert.equal(view.canStartGroup, idle);
  });
});

test("the reducer rejects cross-mode layer and group entry events", () => {
  const create = createCutSession(CUT_SESSION_MODE.CREATE, { region: "crown" });
  const group = createCutSession(CUT_SESSION_MODE.GROUP, { region: "pavilion" });
  assert.equal(cutSessionReducer(create, { type: CUT_SESSION_EVENT.SELECT_LAYER, patternId: "C1" }), create);
  assert.equal(cutSessionReducer(create, { type: CUT_SESSION_EVENT.START_GROUP, region: "crown" }), create);
  assert.equal(cutSessionReducer(group, { type: CUT_SESSION_EVENT.CHANGE_REGION, region: "crown" }), group);
});

test("Jump capabilities respect candidate boundaries and locked Meet", () => {
  let session = createCutSession(CUT_SESSION_MODE.CREATE, { region: "crown" });
  const jumpCandidates = [
    { ...VALID_CANDIDATE, key: "first", depth: 0.2 },
    { ...VALID_CANDIDATE, key: "last", depth: 0.4 },
  ];
  let capabilities = resolveCutSession(session, { jumpCandidates });
  assert.equal(capabilities.canJumpPrevious, false);
  assert.equal(capabilities.canJumpNext, true);
  session = cutSessionReducer(session, { type: CUT_SESSION_EVENT.SELECT_MEET_CANDIDATE, candidate: jumpCandidates[1] });
  capabilities = resolveCutSession(session, { jumpCandidates });
  assert.equal(capabilities.canJumpPrevious, true);
  assert.equal(capabilities.canJumpNext, false);
  session = cutSessionReducer(session, { type: CUT_SESSION_EVENT.LOCK_MEET });
  capabilities = resolveCutSession(session, { jumpCandidates });
  assert.equal(capabilities.canJumpPrevious, false);
  assert.equal(capabilities.canJumpNext, false);
  session = cutSessionReducer(session, { type: CUT_SESSION_EVENT.CLEAR_MEET });
  assert.equal(resolveCutSession(session, { jumpCandidates }).canJumpPrevious, true);
  assert.equal(resolveCutSession(session).canJumpNext, false);
  assert.equal(resolveCutSession(createCutSession(), { jumpCandidates }).canJumpNext, false);
});
