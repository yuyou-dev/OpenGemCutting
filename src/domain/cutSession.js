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
  CANCEL: "cancel",
  COMMIT_SUCCESS: "commit-success",
  DOCUMENT_CREATE: "document-create",
  DOCUMENT_IMPORT: "document-import",
  ACTIVE_LAYER_REMOVED: "active-layer-removed",
});

export const DEFAULT_DRAFT_ANGLES = Object.freeze({
  crown: 32,
  girdle: 90,
  pavilion: 41,
});

export const DEFAULT_DRAFT_DEPTHS = Object.freeze({
  crown: 0.42,
  girdle: 0.2,
  pavilion: 0.42,
});

const DEFAULT_BASE_INDEX = 36;
const DEFAULT_CUSTOM_INDICES = "02 22 26 46 50 70 74 94";

// Region defaults rebuild a draft; baseIndex and customIndices are index
// preferences that survive region switches and new actions.
export function defaultDraftForRegion(region, previous = null) {
  return {
    industryAngle: DEFAULT_DRAFT_ANGLES[region] ?? DEFAULT_DRAFT_ANGLES.crown,
    depth: DEFAULT_DRAFT_DEPTHS[region] ?? DEFAULT_DRAFT_DEPTHS.crown,
    baseIndex: previous?.baseIndex ?? DEFAULT_BASE_INDEX,
    repeat: region === "girdle" ? 16 : 8,
    mirrorOffset: 0,
    patternMode: "symmetric",
    customIndices: previous?.customIndices ?? DEFAULT_CUSTOM_INDICES,
  };
}

export const CUT_SESSION_TABLE = Object.freeze({
  [CUT_SESSION_MODE.IDLE]: Object.freeze({
    controlsEnabled: false,
    showGizmo: false,
    showCutPlane: false,
    showNewButton: true,
    highlightActiveLayer: false,
    canCancel: false,
    canPickLayer: true,
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
    canChangeRegion: false,
    canMutateStack: false,
    canStartGroup: false,
    exitLabel: "取消变换",
  }),
});

export function createCutSession(mode = CUT_SESSION_MODE.IDLE, payload = {}) {
  if (mode === CUT_SESSION_MODE.CREATE) {
    const region = payload.region ?? "crown";
    return { mode, region, dirty: true, draft: defaultDraftForRegion(region, payload.baseDraft) };
  }
  if (mode === CUT_SESSION_MODE.EDIT) {
    const region = payload.region ?? "crown";
    return {
      mode,
      region,
      patternId: payload.patternId,
      dirty: false,
      draft: payload.draft ?? defaultDraftForRegion(region),
    };
  }
  if (mode === CUT_SESSION_MODE.GROUP) {
    const region = payload.region ?? "crown";
    return {
      mode,
      region,
      dirty: false,
      draft: payload.draft ?? defaultDraftForRegion(region),
      group: { deltaZ: 0, scale: 1, rotationTeeth: 0 },
    };
  }
  const region = payload.region ?? "crown";
  return {
    mode: CUT_SESSION_MODE.IDLE,
    region,
    dirty: false,
    draft: defaultDraftForRegion(region, payload.baseDraft),
  };
}

function groupIsDirty(group) {
  return Boolean(Number(group.deltaZ))
    || Math.abs(Number(group.scale) - 1) > 1e-9
    || Boolean(Number(group.rotationTeeth));
}

export function cutSessionReducer(session, event) {
  switch (event.type) {
    case CUT_SESSION_EVENT.START_CREATE:
      return CUT_SESSION_TABLE[session.mode].showNewButton
        ? createCutSession(CUT_SESSION_MODE.CREATE, { region: event.region, baseDraft: session.draft })
        : session;
    case CUT_SESSION_EVENT.CHANGE_REGION:
      if (!CUT_SESSION_TABLE[session.mode].canChangeRegion) return session;
      // Idle retargets the stack filter; create/edit restart the draft with
      // the new region's defaults.
      return createCutSession(
        session.mode === CUT_SESSION_MODE.IDLE ? CUT_SESSION_MODE.IDLE : CUT_SESSION_MODE.CREATE,
        { region: event.region, baseDraft: session.draft },
      );
    case CUT_SESSION_EVENT.DOCUMENT_CREATE:
      return createCutSession(CUT_SESSION_MODE.CREATE, {
        region: event.region,
        baseDraft: { customIndices: session.draft?.customIndices },
      });
    case CUT_SESSION_EVENT.SELECT_LAYER:
      return CUT_SESSION_TABLE[session.mode].canPickLayer
        ? createCutSession(CUT_SESSION_MODE.EDIT, {
          patternId: event.patternId,
          region: event.region,
          draft: event.draft,
        })
        : session;
    case CUT_SESSION_EVENT.START_GROUP:
      return CUT_SESSION_TABLE[session.mode].canStartGroup
        ? createCutSession(CUT_SESSION_MODE.GROUP, { region: event.region, draft: session.draft })
        : session;
    case CUT_SESSION_EVENT.CHANGE_DRAFT: {
      if (session.mode !== CUT_SESSION_MODE.CREATE && session.mode !== CUT_SESSION_MODE.EDIT) return session;
      const patch = { ...event.patch };
      if (session.region === "girdle" && "industryAngle" in patch) patch.industryAngle = 90;
      return { ...session, dirty: true, draft: { ...session.draft, ...patch } };
    }
    case CUT_SESSION_EVENT.CHANGE_GROUP: {
      if (session.mode !== CUT_SESSION_MODE.GROUP) return session;
      const group = { ...session.group, ...event.patch };
      return { ...session, group, dirty: groupIsDirty(group) };
    }
    case CUT_SESSION_EVENT.ACTIVE_LAYER_REMOVED:
      return session.mode === CUT_SESSION_MODE.EDIT && session.patternId === event.patternId
        ? createCutSession(CUT_SESSION_MODE.IDLE, { region: session.region, baseDraft: session.draft })
        : session;
    case CUT_SESSION_EVENT.CANCEL:
    case CUT_SESSION_EVENT.COMMIT_SUCCESS:
    case CUT_SESSION_EVENT.DOCUMENT_IMPORT:
      return createCutSession(CUT_SESSION_MODE.IDLE, { region: session.region, baseDraft: session.draft });
    default:
      return session;
  }
}

export function resolveCutSession(session) {
  const config = CUT_SESSION_TABLE[session.mode];
  const editing = session.mode === CUT_SESSION_MODE.EDIT;
  const creating = session.mode === CUT_SESSION_MODE.CREATE;
  const grouping = session.mode === CUT_SESSION_MODE.GROUP;

  return {
    ...session,
    ...config,
    active: session.mode !== CUT_SESSION_MODE.IDLE,
    draft: session.draft ?? null,
    group: grouping ? session.group : null,
    previewEnabled: creating || (editing && session.dirty),
    canCommit: creating || ((editing || grouping) && session.dirty),
    activePatternId: editing && config.highlightActiveLayer ? session.patternId : null,
    groupRegion: grouping ? session.region : null,
  };
}
