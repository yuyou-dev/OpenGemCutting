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

  const create = resolveCutSession(createCutSession(CUT_SESSION_MODE.CREATE, { region: "crown" }));
  assert.equal(create.dirty, true);
  assert.equal(create.previewEnabled, true);
  assert.equal(create.canCommit, true);

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
    depth: 0.42,
    baseIndex: 36,
    repeat: 8,
    mirrorOffset: 0,
    patternMode: "symmetric",
    customIndices: "02 22 26 46 50 70 74 94",
  });
  assert.equal(defaultDraftForRegion("girdle").repeat, 16);

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
