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
  CHANGE_EDGE_RATIO: "change-edge-ratio",
  FINISH_EDGE_EDIT: "finish-edge-edit",
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
      tool: ["pick-vertex", "pick-edge", "edit-edge"].includes(construction.tool) ? construction.tool : "none",
      candidate: construction.candidate ?? null,
      meet: construction.meet ?? null,
      ...(construction.returnDraft ? { returnDraft: construction.returnDraft, returnDirty: construction.returnDirty } : {}),
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
    preform: false,
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
    angleEditable: false,
    canLockSecondMeet: false,
    canClearMeetA: false,
    canClearMeetB: false,
    canEditEdgeRatio: false,
    canMarkPreform: false,
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
    angleEditable: false,
    canLockSecondMeet: false,
    canClearMeetA: false,
    canClearMeetB: false,
    canEditEdgeRatio: false,
    canMarkPreform: false,
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
    angleEditable: false,
    canLockSecondMeet: false,
    canClearMeetA: false,
    canClearMeetB: false,
    canEditEdgeRatio: false,
    canMarkPreform: false,
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
    angleEditable: false,
    canLockSecondMeet: false,
    canClearMeetA: false,
    canClearMeetB: false,
    canEditEdgeRatio: false,
    canMarkPreform: false,
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
      draft: {
        ...(payload.draft ?? defaultDraftForRegion(region)),
        preform: region !== "girdle" && !payload.lockedLayer && Boolean(payload.draft?.preform),
      },
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

function hasCustomPrimary(draft) {
  if (draft.patternMode !== "arbitrary") return true;
  const indices = String(draft.customIndices ?? "").trim().split(/[\s,，;；]+/).map(Number);
  return indices.every((index) => Number.isInteger(index) && index >= 1 && index <= 96)
    && indices.some((index) => index % 96 === draft.baseIndex % 96);
}

function usableCandidate(candidate) {
  return Number.isFinite(candidate?.depth) && candidate.depth >= 0
    && !["unreachable", "stale"].includes(candidate.status);
}

function selectMeetCandidate(session, event) {
  const capabilities = resolveCutSession(session);
  if (!capabilities.canPickMeetTarget || !event.candidate) return session;
  const candidate = event.candidate;
  const hasAngle = Number.isFinite(candidate.industryAngleDeg)
    && candidate.industryAngleDeg >= 0 && candidate.industryAngleDeg <= 90;
  const usable = usableCandidate(candidate) && (!session.construction.meet || hasAngle);
  const isSecondPreview = Boolean(session.construction.meet);
  return {
    ...session,
    dirty: usable ? true : session.dirty,
    draft: usable ? {
      ...session.draft,
      depth: candidate.depth,
      ...(hasAngle ? { industryAngle: candidate.industryAngleDeg } : {}),
    } : session.draft,
    construction: {
      ...session.construction,
      tool: candidate.edge || candidate.target?.kind === "edge-point" ? "edit-edge" : "none",
      candidate,
      ...(isSecondPreview ? {
        returnDraft: session.construction.returnDraft ?? session.draft,
        returnDirty: session.construction.returnDirty ?? session.dirty,
      } : {}),
    },
  };
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
      if (!resolveCutSession(session).canMarkPreform) delete patch.preform;
      if (session.construction.meet) {
        if (!hasCustomPrimary({ ...session.draft, ...patch })) return session;
        if (!event.constructionResult) {
          delete patch.depth;
          if (session.construction.meet.secondTarget) delete patch.industryAngle;
        } else if (["unreachable", "stale"].includes(event.constructionResult.meet?.status)) {
          delete patch.depth;
          if (session.construction.meet.secondTarget) delete patch.industryAngle;
        }
      }
      if (Object.keys(patch).length === 0 && !event.constructionResult) return session;
      if (!event.constructionResult && Object.keys(patch).every((key) => key === "preform")) {
        return {
          ...session,
          dirty: true,
          draft: { ...session.draft, ...patch },
          construction: session.construction.returnDraft ? {
            ...session.construction,
            returnDraft: { ...session.construction.returnDraft, ...patch },
            returnDirty: true,
          } : session.construction,
        };
      }
      const construction = {
        ...session.construction,
        candidate: null,
        ...(event.constructionResult ?? {}),
      };
      delete construction.returnDraft;
      delete construction.returnDirty;
      if (construction.tool === "edit-edge") construction.tool = "none";
      if (session.construction.meet && !event.constructionResult
        && Object.keys(patch).some((key) => key !== "preform")) {
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
        construction: {
          ...session.construction,
          tool: event.tool === "pick-edge" ? "pick-edge" : "pick-vertex",
        },
      };
    }
    case CUT_SESSION_EVENT.CANCEL_CONSTRUCTION_TOOL: {
      const construction = session.construction;
      if (construction?.tool !== "none") {
        return { ...session, construction: { ...construction, tool: "none" } };
      }
      if (!construction?.returnDraft) return session;
      return {
        ...session,
        draft: construction.returnDraft,
        dirty: construction.returnDirty ?? session.dirty,
        construction: { tool: "none", candidate: null, meet: construction.meet },
      };
    }
    case CUT_SESSION_EVENT.SELECT_MEET_CANDIDATE:
      return selectMeetCandidate(session, event);
    case CUT_SESSION_EVENT.CHANGE_EDGE_RATIO:
      return resolveCutSession(session).canEditEdgeRatio
        ? selectMeetCandidate(session, event) : session;
    case CUT_SESSION_EVENT.FINISH_EDGE_EDIT:
      return session.construction?.tool === "edit-edge"
        ? { ...session, construction: { ...session.construction, tool: "none" } } : session;
    case CUT_SESSION_EVENT.LOCK_MEET: {
      if (!resolveCutSession(session).canLockMeet) return session;
      const candidate = session.construction.candidate;
      const meet = event.meet ?? {
        target: session.construction.meet?.target ?? candidate.target,
        ...(session.construction.meet ? { secondTarget: candidate.target } : {}),
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
    case CUT_SESSION_EVENT.CLEAR_MEET: {
      if (!session.construction?.meet) return session;
      const { meet, returnDraft } = session.construction;
      const slot = event.slot ?? "all";
      const target = slot === "A" ? meet.secondTarget : slot === "B" ? meet.target : null;
      const remaining = target ? (event.meet ?? {
        target, status: "valid", requiredDepth: (returnDraft ?? session.draft).depth,
        residual: 0, threats: [],
      }) : null;
      return {
        ...session,
        dirty: true,
        draft: {
          ...(returnDraft ?? session.draft),
          ...(!remaining || ["unreachable", "stale"].includes(remaining.status) ? {} : event.patch),
        },
        construction: { ...emptyConstruction(), meet: remaining },
      };
    }
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
    && ["symmetric", "arbitrary"].includes(session.draft?.patternMode)
    && hasCustomPrimary(session.draft);
  const invalidStatuses = new Set(["unreachable", "stale"]);
  const meetValid = !construction.meet || !invalidStatuses.has(construction.meet.status);
  const candidateStatus = construction.candidate?.status ?? construction.candidate?.classification;
  const secondAngle = construction.candidate?.industryAngleDeg;
  const candidateValid = !construction.candidate || (usableCandidate(construction.candidate)
    && !invalidStatuses.has(candidateStatus)
    && (!construction.meet || (Number.isFinite(secondAngle) && secondAngle >= 0 && secondAngle <= 90)));
  const constructionValid = meetValid && candidateValid && (!construction.meet || canUseMeetJump);
  const candidateLockable = candidateValid;
  const draftCanCommit = creating || (editing && session.dirty);

  const jumpOptions = {
    candidates: jumpCandidates,
    currentDepth: session.draft?.depth ?? 0,
    ...(construction.meet ? { currentAngle: session.draft?.industryAngle ?? 0 } : {}),
    currentKey: construction.candidate?.key,
  };
  const hasDoubleMeet = Boolean(construction.meet?.secondTarget);
  const canNavigateJump = canUseMeetJump && !hasDoubleMeet && meetValid;

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
    canPickMeetTarget: canUseMeetJump && !hasDoubleMeet && meetValid,
    canLockMeet: canUseMeetJump && meetValid && !hasDoubleMeet && Boolean(construction.candidate) && candidateLockable,
    canLockSecondMeet: canUseMeetJump && meetValid && Boolean(construction.meet) && !hasDoubleMeet
      && Boolean(construction.candidate) && candidateLockable,
    canClearMeetA: inDraftSession && Boolean(construction.meet),
    canClearMeetB: inDraftSession && hasDoubleMeet,
    canEditEdgeRatio: canUseMeetJump && !hasDoubleMeet
      && Boolean(construction.candidate?.edge || construction.candidate?.target?.kind === "edge-point"),
    canMarkPreform: inDraftSession && !session.lockedLayer && session.region !== "girdle",
    canCancelConstructionTool: inDraftSession && (construction.tool !== "none" || Boolean(construction.returnDraft)),
    depthEditable: inDraftSession && !construction.meet,
    angleEditable: inDraftSession && !session.lockedLayer && session.region !== "girdle" && !hasDoubleMeet,
    constructionValid,
    activePatternId: editing && config.highlightActiveLayer ? session.patternId : null,
    groupRegion: grouping ? session.region : null,
  };
}
