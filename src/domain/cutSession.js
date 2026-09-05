import { adjacentJumpCandidateIndex } from "./meetJump.js";

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
  START_MEET_PICK: "start-meet-pick",
  CANCEL_CONSTRUCTION_TOOL: "cancel-construction-tool",
  SELECT_MEET_CANDIDATE: "select-meet-candidate",
  LOCK_MEET: "lock-meet",
  CLEAR_MEET: "clear-meet",
  CANCEL: "cancel",
  COMMIT_SUCCESS: "commit-success",
  DOCUMENT_CREATE: "document-create",
  DOCUMENT_IMPORT: "document-import",
});

export const DEFAULT_DRAFT_ANGLES = Object.freeze({
  crown: 32,
  girdle: 90,
  pavilion: 41,
});

export const DEFAULT_DRAFT_DEPTHS = Object.freeze({
  crown: 0,
  girdle: 0.2,
  pavilion: 0,
});

const DEFAULT_BASE_INDEX = 36;
const DEFAULT_CUSTOM_INDICES = "02 22 26 46 50 70 74 94";

function emptyConstruction() {
  return { tool: "none", candidate: null, meet: null };
}

function normalizeConstruction(construction) {
  if (!construction) return emptyConstruction();
  if ("tool" in construction || "candidate" in construction || "meet" in construction) {
    return {
      tool: construction.tool === "pick-vertex" ? "pick-vertex" : "none",
      candidate: construction.candidate ?? null,
      meet: construction.meet ?? null,
    };
  }
  return { ...emptyConstruction(), meet: construction };
}

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
    canUseMeetJump: false,
    canJumpPrevious: false,
    canJumpNext: false,
    canPickMeetTarget: false,
    canLockMeet: false,
    canCancelConstructionTool: false,
    depthEditable: false,
    constructionValid: true,
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
    canUseMeetJump: false,
    canJumpPrevious: false,
    canJumpNext: false,
    canPickMeetTarget: false,
    canLockMeet: false,
    canCancelConstructionTool: false,
    depthEditable: false,
    constructionValid: true,
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
    canUseMeetJump: false,
    canJumpPrevious: false,
    canJumpNext: false,
    canPickMeetTarget: false,
    canLockMeet: false,
    canCancelConstructionTool: false,
    depthEditable: false,
    constructionValid: true,
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
    canUseMeetJump: false,
    canJumpPrevious: false,
    canJumpNext: false,
    canPickMeetTarget: false,
    canLockMeet: false,
    canCancelConstructionTool: false,
    depthEditable: false,
    constructionValid: true,
    exitLabel: "取消变换",
  }),
});

export function createCutSession(mode = CUT_SESSION_MODE.IDLE, payload = {}) {
  if (mode === CUT_SESSION_MODE.CREATE) {
    const region = payload.region ?? "crown";
    return {
      mode,
      region,
      dirty: true,
      draft: defaultDraftForRegion(region, payload.baseDraft),
      construction: normalizeConstruction(payload.construction),
    };
  }
  if (mode === CUT_SESSION_MODE.EDIT) {
    const region = payload.region ?? "crown";
    return {
      mode,
      region,
      patternId: payload.patternId,
      lockedLayer: Boolean(payload.lockedLayer),
      dirty: false,
      draft: payload.draft ?? defaultDraftForRegion(region),
      construction: normalizeConstruction(payload.construction),
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
      construction: emptyConstruction(),
    };
  }
  const region = payload.region ?? "crown";
  return {
    mode: CUT_SESSION_MODE.IDLE,
    region,
    dirty: false,
    draft: defaultDraftForRegion(region, payload.baseDraft),
    construction: emptyConstruction(),
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
          construction: event.construction,
          lockedLayer: event.lockedLayer,
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
      if (session.lockedLayer && "industryAngle" in patch) patch.industryAngle = 0;
      const construction = {
        ...session.construction,
        candidate: null,
        ...(event.constructionResult ?? {}),
      };
      if (session.construction.meet && !event.constructionResult) {
        construction.meet = { ...session.construction.meet, status: "stale" };
      }
      return {
        ...session,
        dirty: true,
        draft: { ...session.draft, ...patch },
        construction: normalizeConstruction(construction),
      };
    }
    case CUT_SESSION_EVENT.CHANGE_GROUP: {
      if (session.mode !== CUT_SESSION_MODE.GROUP) return session;
      const group = { ...session.group, ...event.patch };
      return { ...session, group, dirty: groupIsDirty(group) };
    }
    case CUT_SESSION_EVENT.START_MEET_PICK: {
      if (!resolveCutSession(session).canPickMeetTarget) return session;
      return {
        ...session,
        construction: { ...session.construction, tool: "pick-vertex", candidate: null },
      };
    }
    case CUT_SESSION_EVENT.CANCEL_CONSTRUCTION_TOOL:
      return session.construction?.tool === "pick-vertex"
        ? { ...session, construction: { ...session.construction, tool: "none", candidate: null } }
        : session;
    case CUT_SESSION_EVENT.SELECT_MEET_CANDIDATE: {
      if (!resolveCutSession(session).canUseMeetJump || !event.candidate) return session;
      const depth = Number(event.candidate.depth);
      const hasUsableDepth = Number.isFinite(depth)
        && depth >= 0
        && event.candidate.status !== "unreachable";
      return {
        ...session,
        dirty: hasUsableDepth ? true : session.dirty,
        draft: hasUsableDepth ? { ...session.draft, depth } : session.draft,
        construction: {
          ...session.construction,
          tool: "none",
          candidate: event.candidate,
          meet: null,
        },
      };
    }
    case CUT_SESSION_EVENT.LOCK_MEET: {
      if (!resolveCutSession(session).canLockMeet) return session;
      const candidate = session.construction.candidate;
      const meet = event.meet ?? {
        target: candidate.target,
        status: candidate.classification === "destructive" ? "destructive" : "valid",
        requiredDepth: candidate.depth,
        residual: candidate.residual ?? 0,
        threats: candidate.threats ?? [],
      };
      return {
        ...session,
        dirty: true,
        construction: { tool: "none", candidate: null, meet },
      };
    }
    case CUT_SESSION_EVENT.CLEAR_MEET:
      if (!session.construction?.meet) return session;
      return {
        ...session,
        dirty: true,
        construction: emptyConstruction(),
      };
    case CUT_SESSION_EVENT.CANCEL:
    case CUT_SESSION_EVENT.COMMIT_SUCCESS:
    case CUT_SESSION_EVENT.DOCUMENT_IMPORT:
      return createCutSession(CUT_SESSION_MODE.IDLE, { region: session.region, baseDraft: session.draft });
    default:
      return session;
  }
}

export function resolveCutSession(session, { jumpCandidates = [] } = {}) {
  const config = CUT_SESSION_TABLE[session.mode];
  const editing = session.mode === CUT_SESSION_MODE.EDIT;
  const creating = session.mode === CUT_SESSION_MODE.CREATE;
  const grouping = session.mode === CUT_SESSION_MODE.GROUP;
  const construction = normalizeConstruction(session.construction);
  const inDraftSession = creating || editing;
  const canUseMeetJump = inDraftSession
    && !session.lockedLayer
    && (session.region === "crown" || session.region === "pavilion")
    && session.draft?.patternMode === "symmetric";
  const invalidStatuses = new Set(["unreachable", "stale"]);
  const meetValid = !construction.meet || !invalidStatuses.has(construction.meet.status);
  const candidateStatus = construction.candidate?.status ?? construction.candidate?.classification;
  const candidateValid = !construction.candidate || !invalidStatuses.has(candidateStatus);
  const constructionValid = meetValid && candidateValid && (!construction.meet || canUseMeetJump);
  const candidateLockable = !["unreachable", "stale"].includes(candidateStatus);
  const draftCanCommit = creating || (editing && session.dirty);

  const jumpOptions = { candidates: jumpCandidates, currentDepth: session.draft?.depth ?? 0, currentKey: construction.candidate?.key };
  const canNavigateJump = canUseMeetJump && !construction.meet;

  return {
    ...session,
    ...config,
    active: session.mode !== CUT_SESSION_MODE.IDLE,
    draft: session.draft ?? null,
    group: grouping ? session.group : null,
    construction,
    previewEnabled: creating || (editing && session.dirty),
    canCommit: (grouping && session.dirty) || (draftCanCommit && constructionValid),
    canUseMeetJump,
    canJumpPrevious: canNavigateJump && adjacentJumpCandidateIndex({ ...jumpOptions, direction: -1 }) >= 0,
    canJumpNext: canNavigateJump && adjacentJumpCandidateIndex(jumpOptions) >= 0,
    canPickMeetTarget: canUseMeetJump,
    canLockMeet: canUseMeetJump && Boolean(construction.candidate) && candidateLockable,
    canCancelConstructionTool: inDraftSession && construction.tool === "pick-vertex",
    depthEditable: inDraftSession && !construction.meet,
    constructionValid,
    activePatternId: editing && config.highlightActiveLayer ? session.patternId : null,
    groupRegion: grouping ? session.region : null,
  };
}
