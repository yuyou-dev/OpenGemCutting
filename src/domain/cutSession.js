export const CUT_SESSION_MODE = Object.freeze({
  IDLE: "idle",
  CREATE: "create",
  EDIT: "edit",
  GROUP: "group",
});

export const CUT_SESSION_EVENT = Object.freeze({
  START_CREATE: "start-create",
  CHANGE_REGION: "change-region",
  SELECT_LAYER: "select-layer",
  START_GROUP: "start-group",
  CHANGE_DRAFT: "change-draft",
  CHANGE_GROUP: "change-group",
  PICK_MEET: "pick-meet",
  CLEAR_MEET: "clear-meet",
  CANCEL: "cancel",
  COMMIT_SUCCESS: "commit-success",
  DOCUMENT_CREATE: "document-create",
  DOCUMENT_IMPORT: "document-import",
  ACTIVE_LAYER_REMOVED: "active-layer-removed",
});

export const CUT_SESSION_TABLE = Object.freeze({
  [CUT_SESSION_MODE.IDLE]: Object.freeze({
    controlsEnabled: false,
    showGizmo: false,
    showCutPlane: false,
    showNewButton: true,
    highlightActiveLayer: false,
    canCancel: false,
    canPickLayer: true,
    canPickMeet: false,
    canChangeRegion: true,
    canMutateStack: true,
    canStartGroup: true,
    exitLabel: null,
  }),
  [CUT_SESSION_MODE.CREATE]: Object.freeze({
    controlsEnabled: true,
    showGizmo: true,
    showCutPlane: true,
    showNewButton: false,
    highlightActiveLayer: false,
    canCancel: true,
    canPickLayer: false,
    canPickMeet: true,
    canChangeRegion: true,
    canMutateStack: false,
    canStartGroup: false,
    exitLabel: "取消新建",
  }),
  [CUT_SESSION_MODE.EDIT]: Object.freeze({
    controlsEnabled: true,
    showGizmo: true,
    showCutPlane: true,
    showNewButton: false,
    highlightActiveLayer: true,
    canCancel: true,
    canPickLayer: false,
    canPickMeet: true,
    canChangeRegion: true,
    canMutateStack: false,
    canStartGroup: false,
    exitLabel: "退出编辑",
  }),
  [CUT_SESSION_MODE.GROUP]: Object.freeze({
    controlsEnabled: false,
    showGizmo: false,
    showCutPlane: false,
    showNewButton: false,
    highlightActiveLayer: false,
    canCancel: true,
    canPickLayer: false,
    canPickMeet: false,
    canChangeRegion: false,
    canMutateStack: false,
    canStartGroup: false,
    exitLabel: "取消变换",
  }),
});

export function createCutSession(mode = CUT_SESSION_MODE.IDLE, payload = {}) {
  if (mode === CUT_SESSION_MODE.CREATE) {
    return { mode, region: payload.region ?? "crown", dirty: true, meetTarget: null };
  }
  if (mode === CUT_SESSION_MODE.EDIT) {
    return { mode, patternId: payload.patternId, dirty: false, meetTarget: null };
  }
  if (mode === CUT_SESSION_MODE.GROUP) {
    return { mode, region: payload.region, dirty: false, meetTarget: null };
  }
  return { mode: CUT_SESSION_MODE.IDLE, dirty: false, meetTarget: null };
}

export function cutSessionReducer(session, event) {
  switch (event.type) {
    case CUT_SESSION_EVENT.START_CREATE:
      return CUT_SESSION_TABLE[session.mode].showNewButton
        ? createCutSession(CUT_SESSION_MODE.CREATE, { region: event.region })
        : session;
    case CUT_SESSION_EVENT.CHANGE_REGION:
      return CUT_SESSION_TABLE[session.mode].canChangeRegion && session.mode !== CUT_SESSION_MODE.IDLE
        ? createCutSession(CUT_SESSION_MODE.CREATE, { region: event.region })
        : session;
    case CUT_SESSION_EVENT.DOCUMENT_CREATE:
      return createCutSession(CUT_SESSION_MODE.CREATE, { region: event.region });
    case CUT_SESSION_EVENT.SELECT_LAYER:
      return CUT_SESSION_TABLE[session.mode].canPickLayer
        ? createCutSession(CUT_SESSION_MODE.EDIT, { patternId: event.patternId })
        : session;
    case CUT_SESSION_EVENT.START_GROUP:
      return CUT_SESSION_TABLE[session.mode].canStartGroup
        ? createCutSession(CUT_SESSION_MODE.GROUP, { region: event.region })
        : session;
    case CUT_SESSION_EVENT.CHANGE_DRAFT:
      return session.mode === CUT_SESSION_MODE.CREATE || session.mode === CUT_SESSION_MODE.EDIT
        ? { ...session, dirty: true }
        : session;
    case CUT_SESSION_EVENT.CHANGE_GROUP:
      return session.mode === CUT_SESSION_MODE.GROUP
        ? { ...session, dirty: Boolean(event.dirty) }
        : session;
    case CUT_SESSION_EVENT.PICK_MEET:
      return CUT_SESSION_TABLE[session.mode].canPickMeet
        ? { ...session, dirty: true, meetTarget: event.target }
        : session;
    case CUT_SESSION_EVENT.CLEAR_MEET:
      return CUT_SESSION_TABLE[session.mode].canPickMeet
        ? { ...session, meetTarget: null }
        : session;
    case CUT_SESSION_EVENT.ACTIVE_LAYER_REMOVED:
      return session.mode === CUT_SESSION_MODE.EDIT && session.patternId === event.patternId
        ? createCutSession()
        : session;
    case CUT_SESSION_EVENT.CANCEL:
    case CUT_SESSION_EVENT.COMMIT_SUCCESS:
    case CUT_SESSION_EVENT.DOCUMENT_IMPORT:
      return createCutSession();
    default:
      return session;
  }
}

export function resolveCutSession(session) {
  const config = CUT_SESSION_TABLE[session.mode];
  const editing = session.mode === CUT_SESSION_MODE.EDIT;
  const creating = session.mode === CUT_SESSION_MODE.CREATE;

  return {
    ...session,
    ...config,
    active: session.mode !== CUT_SESSION_MODE.IDLE,
    previewEnabled: creating || (editing && session.dirty),
    canCommit: creating || ((editing || session.mode === CUT_SESSION_MODE.GROUP) && session.dirty),
    activePatternId: editing && config.highlightActiveLayer ? session.patternId : null,
    groupRegion: session.mode === CUT_SESSION_MODE.GROUP ? session.region : null,
  };
}
