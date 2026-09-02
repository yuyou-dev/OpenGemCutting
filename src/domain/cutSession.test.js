import assert from "node:assert/strict";
import test from "node:test";
import {
  CUT_SESSION_EVENT,
  CUT_SESSION_MODE,
  CUT_SESSION_TABLE,
  createCutSession,
  cutSessionReducer,
  resolveCutSession,
} from "./cutSession.js";

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

test("every active session cancels back to the same idle state", () => {
  const sessions = [
    createCutSession(CUT_SESSION_MODE.CREATE, { region: "crown" }),
    createCutSession(CUT_SESSION_MODE.EDIT, { patternId: "C1" }),
    createCutSession(CUT_SESSION_MODE.GROUP, { region: "pavilion" }),
  ];
  sessions.forEach((session) => {
    assert.deepEqual(
      cutSessionReducer(session, { type: CUT_SESSION_EVENT.CANCEL }),
      createCutSession(),
    );
  });
});

test("meet picking is accepted only while creating or editing", () => {
  const target = { kind: "vertex", point: [1, 2, 3] };
  const idle = createCutSession();
  const group = createCutSession(CUT_SESSION_MODE.GROUP, { region: "crown" });
  assert.equal(cutSessionReducer(idle, { type: CUT_SESSION_EVENT.PICK_MEET, target }), idle);
  assert.equal(cutSessionReducer(group, { type: CUT_SESSION_EVENT.PICK_MEET, target }), group);

  const create = cutSessionReducer(
    createCutSession(CUT_SESSION_MODE.CREATE, { region: "crown" }),
    { type: CUT_SESSION_EVENT.PICK_MEET, target },
  );
  assert.deepEqual(create.meetTarget, target);
  assert.equal(create.dirty, true);
});

test("draft changes make edit committable without changing its identity", () => {
  const clean = createCutSession(CUT_SESSION_MODE.EDIT, { patternId: "P2" });
  assert.equal(resolveCutSession(clean).canCommit, false);
  const dirty = cutSessionReducer(clean, { type: CUT_SESSION_EVENT.CHANGE_DRAFT });
  assert.equal(resolveCutSession(dirty).canCommit, true);
  assert.equal(resolveCutSession(dirty).activePatternId, "P2");
});

test("group changes are active and derive commit permission from one dirty flag", () => {
  const clean = createCutSession(CUT_SESSION_MODE.GROUP, { region: "crown" });
  assert.equal(resolveCutSession(clean).active, true);
  assert.equal(resolveCutSession(clean).canCommit, false);

  const dirty = cutSessionReducer(clean, { type: CUT_SESSION_EVENT.CHANGE_GROUP, dirty: true });
  assert.equal(resolveCutSession(dirty).canCommit, true);
  assert.equal(resolveCutSession(dirty).groupRegion, "crown");

  const reset = cutSessionReducer(dirty, { type: CUT_SESSION_EVENT.CHANGE_GROUP, dirty: false });
  assert.equal(resolveCutSession(reset).canCommit, false);
});

test("idle region changes never create a draft", () => {
  const idle = createCutSession();
  assert.equal(
    cutSessionReducer(idle, { type: CUT_SESSION_EVENT.CHANGE_REGION, region: "pavilion" }),
    idle,
  );
});

test("document and commit events choose explicit terminal states", () => {
  const edit = createCutSession(CUT_SESSION_MODE.EDIT, { patternId: "C1" });
  assert.equal(cutSessionReducer(edit, { type: CUT_SESSION_EVENT.COMMIT_SUCCESS }).mode, CUT_SESSION_MODE.IDLE);
  assert.equal(cutSessionReducer(edit, { type: CUT_SESSION_EVENT.DOCUMENT_IMPORT }).mode, CUT_SESSION_MODE.IDLE);
  assert.equal(cutSessionReducer(edit, { type: CUT_SESSION_EVENT.DOCUMENT_CREATE, region: "crown" }).mode, CUT_SESSION_MODE.CREATE);
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
