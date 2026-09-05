import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { IconChevronLeft, IconChevronRight, IconHistory } from "@tabler/icons-react";
import { Header } from "./components/Header.jsx";
import { GemViewport } from "./components/GemViewport.jsx";
import { OpticsViewport } from "./components/OpticsViewport.jsx";
import { OpticsInspector } from "./components/OpticsInspector.jsx";
import { MastControl } from "./components/MastControl.jsx";
import { CutComposer } from "./components/CutComposer.jsx";
import { CutStack } from "./components/CutStack.jsx";
import { FacetLedger } from "./components/FacetLedger.jsx";
import { HistoryPanel } from "./components/HistoryPanel.jsx";
import { AscTransferDialog } from "./components/AscTransferDialog.jsx";
import { PresetLibraryDialog } from "./components/PresetLibraryDialog.jsx";
import { HelpCenterDialog } from "./components/HelpCenterDialog.jsx";
import { Modal } from "./components/Modal.jsx";
import { RecoveryDialog } from "./components/RecoveryDialog.jsx";
import { useLocalRecovery } from "./components/useLocalRecovery.js";
import { downloadBlob } from "./utils/download.js";
import {
  CUT_SESSION_EVENT,
  CUT_SESSION_MODE,
  createCutSession,
  cutSessionReducer,
  resolveCutSession,
} from "./domain/cutSession.js";
import {
  VALID_REPEAT_COUNTS,
  FACET_REGION_LABELS,
  FACET_REGION_PREFIXES,
  canRedo,
  canUndo,
  createAddFacetsCommand,
  createCommandHistory,
  createRemoveFacetsCommand,
  createReplacePatternCommand,
  createReplaceDocumentCommand,
  displayIndex,
  executeFacetingCommand,
  exportFacetingJSON,
  facetNormal,
  importFacetingJSON,
  industryAngleToBetaDeg,
  normalizeIndex,
  redoFacetingCommand,
  replacePatternFacets,
  rotateFacetsByTeeth,
  scaleFacetsAlongZ,
  translateFacetsAlongZ,
  undoFacetingCommand,
} from "./domain/faceting.js";
import {
  clipPolyhedronByPlanes,
  createCenteredCube,
  measurePolyhedron,
} from "./domain/geometry.js";
import {
  MEET_STATUS,
  adjacentJumpCandidateIndex,
  enumerateTopologyVertices,
  enumerateTopologyEdges,
  createEdgeMeetTarget,
  generateDualJumpCandidates,
  evaluateDraftImpact,
  classifyJumpCandidate,
  generateJumpCandidates,
  resolveDraftCommitPolicy,
  resolvePersistedMeetTarget,
  summarizeEffectiveFacets,
} from "./domain/meetJump.js";
import { DEFAULT_OPTICS_SETTINGS, createDocumentOpticsCommand, resolveOpticsSettings } from "./domain/optics.js";
import { inspectGemCadAsc, serializeGemCadAsc } from "./domain/gemcadAsc.js";
import { createPresetLibrary, createStaticPresetProvider } from "./domain/presetLibrary.js";
import { createWorkbenchDocument, ensureTableFacet } from "./domain/document.js";
import { parseCustomIndices, planeEntry, resolveDraftGeometry, solveDraftConstruction, snapshotMeetTarget } from "./domain/cutConstruction.js";
import { buildConstructionStages } from "./domain/constructionHistory.js";
import { ConstructionAssistantDialog } from "./components/ConstructionAssistantDialog.jsx";
import { downloadFacetReport } from "./report/pdfReport.js";

function normalizeDepthValue(value) {
  return Math.max(0, Number(value) || 0);
}

function safeFileStem(value, fallback = "facet-96") {
  return value.replace(/[^\p{L}\p{N}-]+/gu, "-").replace(/^-+|-+$/g, "") || fallback;
}

function commandPatternId(command) {
  if (command.type === "pattern/replace") return command.payload?.patternId;
  if (command.type === "facets/add") return command.payload?.facets?.[0]?.patternId;
  return undefined;
}

function formatClock(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function describeCommand(command) {
  if (command.payload?.description) return command.payload.description;
  if (command.type === "facets/add") {
    const facets = command.payload?.facets ?? [];
    return `新增 ${facets.length} 个预切割面`;
  }
  if (command.type === "pattern/replace") return "更新解析切割动作";
  if (command.type === "document/replace") return "导入并替换设计文档";
  return "更新切磨参数";
}

export function App() {
  const [history, setHistory] = useState(() => createCommandHistory(createWorkbenchDocument("未命名切型 01")));
  const [sessionState, dispatchCutSession] = useReducer(
    cutSessionReducer,
    null,
    () => createCutSession(CUT_SESSION_MODE.CREATE, { region: "crown" }),
  );
  const [viewMode, setViewMode] = useState("perspective");
  const [opticsViewMode, setOpticsViewMode] = useState("perspective");
  const [renderMode, setRenderMode] = useState("solid");
  const [opticsActive, setOpticsActive] = useState(false);
  const [opticsInspectorOpen, setOpticsInspectorOpen] = useState(true);
  const [opticsTab, setOpticsTab] = useState("material");
  const [opticsViewSettings, setOpticsViewSettings] = useState(DEFAULT_OPTICS_SETTINGS.view);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [cutStackOpen, setCutStackOpen] = useState(true);
  const [resetSignal, setResetSignal] = useState(0);
  const [hoveredPatternId, setHoveredPatternId] = useState(null);
  const [hiddenPatternIds, setHiddenPatternIds] = useState(() => new Set());
  const [modal, setModal] = useState(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantStageIndex, setAssistantStageIndex] = useState(0);
  const [assistantPhase, setAssistantPhase] = useState("after");
  const [pendingFullRemovalCommit, setPendingFullRemovalCommit] = useState(null);
  const [toast, setToast] = useState("");
  const [reportIncludeGirdle, setReportIncludeGirdle] = useState(false);
  const [ascTransfer, setAscTransfer] = useState(null);
  const [presetLibraryOpen, setPresetLibraryOpen] = useState(false);
  const importRef = useRef(null);
  const ascImportRef = useRef(null);
  const toastTimerRef = useRef(null);
  const operationSequence = useRef(0);
  const projectSequence = useRef(1);

  const [recoveryStarted, setRecoveryStarted] = useState(false);
  const document = history.present;
  const localRecovery = useLocalRecovery(document, recoveryStarted || history.commands.length > 0);
  const [recoveryOpen, setRecoveryOpen] = useState(() => localRecovery.records.length > 0 || localRecovery.unreadableCount > 0);
  const [recoveryStartup, setRecoveryStartup] = useState(true);
  const opticsSettings = useMemo(() => ({
    ...resolveOpticsSettings(document.metadata?.optics),
    view: opticsViewSettings,
  }), [document.metadata?.optics, opticsViewSettings]);
  const changeOpticsSettings = (settings) => {
    const normalized = resolveOpticsSettings(settings);
    setOpticsViewSettings(normalized.view);
    if (JSON.stringify([normalized.material, normalized.advanced])
      === JSON.stringify([opticsSettings.material, opticsSettings.advanced])) return;
    setHistory((current) => executeFacetingCommand(current, createDocumentOpticsCommand(normalized)));
  };
  const cutSession = resolveCutSession(sessionState);
  const cutMode = cutSession.mode;
  const hasUnsavedPreview = cutSession.previewEnabled || Boolean(cutSession.group && cutSession.dirty);
  const region = cutSession.region;
  const {
    industryAngle,
    depth,
    baseIndex,
    repeat: repeatCount,
    mirrorOffset,
    patternMode,
    customIndices,
  } = cutSession.draft;
  const groupDeltaZ = cutSession.group?.deltaZ ?? 0;
  const groupScale = cutSession.group?.scale ?? 1;
  const groupRotationTeeth = cutSession.group?.rotationTeeth ?? 0;
  const previewEnabled = cutSession.previewEnabled;
  const editingPatternId = cutSession.activePatternId;
  const groupEditRegion = cutSession.groupRegion;
  const signedBeta = industryAngleToBetaDeg(region, industryAngle);

  const notify = useCallback((message) => {
    setToast(message);
    window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(""), 2600);
  }, []);
  const closeAscTransfer = useCallback(() => setAscTransfer(null), []);
  const presetLibrary = useMemo(() => createPresetLibrary([
    createStaticPresetProvider({ publicBase: import.meta.env.BASE_URL }),
  ]), []);

  useEffect(() => () => window.clearTimeout(toastTimerRef.current), []);

  const draft = useMemo(() => resolveDraftGeometry(cutSession.draft, region, document.stock), [cutSession.draft, document.stock, region]);

  const stockSolid = useMemo(() => createCenteredCube(document.stock.size, {
    center: document.stock.center,
    sourceOperationId: "rough-cube",
    region: "rough",
  }), [document.stock]);

  const savedSolid = useMemo(
    () => clipPolyhedronByPlanes(stockSolid, document.facets.map(planeEntry)),
    [document.facets, stockSolid],
  );
  const savedEffectiveFacets = useMemo(() => summarizeEffectiveFacets(savedSolid), [savedSolid]);
  const savedEffectiveFacetIds = useMemo(
    () => new Set(savedEffectiveFacets.effectiveFacetIds),
    [savedEffectiveFacets],
  );
  const girdleBoundary = useMemo(() => {
    const girdlePatternIds = new Set(
      document.facets.filter((facet) => facet.region === "girdle").map((facet) => facet.patternId),
    );
    const zValues = savedSolid.faces
      .filter((face) => girdlePatternIds.has(face.sourceOperationId))
      .flatMap((face) => face.vertexIndices.map((index) => {
        const point = savedSolid.vertices[index];
        return Array.isArray(point) ? point[2] : point?.z;
      }))
      .filter(Number.isFinite);
    const halfSize = Number(document.stock.size) / 2;
    const centerZ = Number(document.stock.center?.[2]) || 0;
    return {
      top: zValues.length ? Math.max(...zValues) : centerZ + halfSize,
      bottom: zValues.length ? Math.min(...zValues) : centerZ - halfSize,
    };
  }, [document.facets, document.stock, savedSolid]);
  const groupSafeRange = useMemo(() => {
    const minimumWaist = Math.max(Number(document.stock.size) * 0.01, 0.01);
    return groupEditRegion === "crown"
      ? { min: girdleBoundary.bottom + minimumWaist - girdleBoundary.top, max: Infinity }
      : { min: -Infinity, max: girdleBoundary.top - minimumWaist - girdleBoundary.bottom };
  }, [document.stock.size, girdleBoundary, groupEditRegion]);

  const groupBaseHeight = useMemo(() => {
    if (!groupEditRegion || savedSolid.vertices.length === 0) return 0;
    const values = savedSolid.vertices
      .map((point) => (Array.isArray(point) ? point[2] : point?.z))
      .filter(Number.isFinite);
    if (values.length === 0) return 0;
    return groupEditRegion === "crown"
      ? Math.max(0, Math.max(...values) - girdleBoundary.top)
      : Math.max(0, girdleBoundary.bottom - Math.min(...values));
  }, [girdleBoundary, groupEditRegion, savedSolid.vertices]);

  const groupPreview = useMemo(() => {
    if (!groupEditRegion) return { facets: document.facets, error: "" };
    const targets = document.facets.filter((facet) => facet.region === groupEditRegion);
    if (targets.length === 0) {
      return { facets: document.facets, error: "当前分组没有可移动的图层。" };
    }
    try {
      let transformed = targets;
      const factor = Number(groupScale);
      const shift = Number(groupDeltaZ);
      const rotation = Math.round(Number(groupRotationTeeth) || 0);
      if (!Number.isFinite(factor) || factor < 0.02) {
        return { facets: document.facets, error: "高度比例不能低于 2%，请把控制面拖回腰线以上。" };
      }
      if (Math.abs(factor - 1) > 1e-9) {
        if (groupBaseHeight <= 1e-6) {
          return { facets: document.facets, error: "当前分组还没有可调整的高度，请先完成一个切割层。" };
        }
        const baseZ = groupEditRegion === "crown" ? girdleBoundary.top : girdleBoundary.bottom;
        transformed = scaleFacetsAlongZ(transformed, factor, baseZ, { stock: document.stock });
      }
      if (shift < groupSafeRange.min || shift > groupSafeRange.max) {
        return { facets: document.facets, error: "该位移会消除腰部，请把控制面拖回腰线范围内。" };
      }
      if (shift) {
        transformed = translateFacetsAlongZ(transformed, shift, { stock: document.stock });
      }
      if (rotation) {
        const rotatable = transformed.filter((facet) => facet.metadata?.operationType !== "table");
        const rotatedById = new Map(
          rotateFacetsByTeeth(rotatable, rotation, { stock: document.stock }).map((facet) => [facet.id, facet]),
        );
        transformed = transformed.map((facet) => rotatedById.get(facet.id) ?? facet);
      }
      const transformedById = new Map(transformed.map((facet) => [facet.id, facet]));
      return {
        facets: document.facets.map((facet) => transformedById.get(facet.id) ?? facet),
        error: "",
      };
    } catch {
      return {
        facets: document.facets,
        error: "组合变换会让至少一个切面超出毛坯范围，请减小升降或高度比例。",
      };
    }
  }, [document.facets, document.stock, girdleBoundary, groupBaseHeight, groupDeltaZ, groupEditRegion, groupRotationTeeth, groupSafeRange, groupScale]);

  const visibleFacets = useMemo(() => groupPreview.facets.filter((facet) => !hiddenPatternIds.has(facet.patternId)), [groupPreview.facets, hiddenPatternIds]);
  const committedSolid = useMemo(() => clipPolyhedronByPlanes(stockSolid, visibleFacets.map(planeEntry)), [stockSolid, visibleFacets]);
  const constructionStages = useMemo(() => buildConstructionStages(document, { hiddenPatternIds }), [document, hiddenPatternIds]);
  const diagnosticsById = useMemo(() => Object.fromEntries(constructionStages.filter((stage) => stage.construction).map((stage) => [stage.id, stage.construction])), [constructionStages]);
  const constructionBaseSolid = editingPatternId
    ? constructionStages.find((stage) => stage.id === editingPatternId)?.beforeSolid ?? stockSolid
    : committedSolid;
  const impactBaseSolid = useMemo(() => {
    const facets = editingPatternId
      ? document.facets.filter((facet) => facet.patternId !== editingPatternId)
      : document.facets;
    return clipPolyhedronByPlanes(stockSolid, facets.map(planeEntry));
  }, [document.facets, editingPatternId, stockSolid]);
  const meetTargets = useMemo(() => enumerateTopologyVertices(constructionBaseSolid), [constructionBaseSolid]);
  const meetEdges = useMemo(() => enumerateTopologyEdges(constructionBaseSolid, { targets: meetTargets }), [constructionBaseSolid, meetTargets]);
  const reportSolid = savedSolid;
  const reportMetrics = useMemo(() => measurePolyhedron(reportSolid), [reportSolid]);

  const constructionBlocksPreview = [cutSession.construction.meet, cutSession.construction.candidate]
    .some((entry) => [MEET_STATUS.UNREACHABLE, MEET_STATUS.STALE].includes(entry?.status));
  const draftImpact = useMemo(() => {
    if (!previewEnabled || constructionBlocksPreview || draft.facets.length === 0) return null;
    return evaluateDraftImpact({
      baseSolid: impactBaseSolid,
      planes: draft.facets.map(planeEntry),
    });
  }, [constructionBlocksPreview, draft.facets, impactBaseSolid, previewEnabled]);
  const previewSolid = useMemo(() => {
    if (!previewEnabled || constructionBlocksPreview || draft.facets.length === 0 || (editingPatternId && hiddenPatternIds.has(editingPatternId))) return committedSolid;
    if (!editingPatternId) return clipPolyhedronByPlanes(committedSolid, draft.facets.map(planeEntry));
    const draftFacets = draft.facets.map((facet) => ({ ...facet, patternId: editingPatternId }));
    const sequence = replacePatternFacets(visibleFacets, editingPatternId, draftFacets);
    return clipPolyhedronByPlanes(stockSolid, sequence.map(planeEntry));
  }, [committedSolid, constructionBlocksPreview, draft.facets, editingPatternId, hiddenPatternIds, previewEnabled, stockSolid, visibleFacets]);

  const previewWouldEraseStock = Boolean(draftImpact?.solidErased)
    || (previewEnabled && draft.facets.length > 0 && previewSolid.vertices.length === 0);
  const displaySolid = previewWouldEraseStock ? committedSolid : previewSolid;
  const metrics = useMemo(() => measurePolyhedron(displaySolid), [displaySolid]);
  const groupGizmo = useMemo(() => {
    if (!groupEditRegion) return null;
    const center = document.stock.center ?? [0, 0, 0];
    const baseZ = groupEditRegion === "crown" ? girdleBoundary.top : girdleBoundary.bottom;
    const scaleValue = Number.isFinite(Number(groupScale)) ? Number(groupScale) : 1;
    const shiftValue = Number(groupDeltaZ) || 0;
    const direction = groupEditRegion === "crown" ? 1 : -1;
    return {
      region: groupEditRegion,
      center: [Number(center[0]) || 0, Number(center[1]) || 0],
      baseZ,
      shiftZ: baseZ + shiftValue,
      scaleZ: baseZ + shiftValue + direction * groupBaseHeight * scaleValue,
      delta: shiftValue,
      scale: scaleValue,
      rotationTeeth: Math.round(Number(groupRotationTeeth) || 0),
      baseHeight: groupBaseHeight,
      minScale: 0.02,
      radius: Math.max(Number(document.stock.size) * 0.62, 0.8),
      axisLength: Math.max(Number(document.stock.size) * 0.34, 0.45),
      minDelta: groupSafeRange.min,
      maxDelta: groupSafeRange.max,
    };
  }, [document.stock, girdleBoundary, groupBaseHeight, groupDeltaZ, groupEditRegion, groupRotationTeeth, groupSafeRange, groupScale]);
  const constructionMeet = cutSession.construction.meet;
  const constructionDiagnostic = constructionBlocksPreview
    ? (cutSession.construction.candidate?.message || constructionMeet?.message || "Meet 来源失效或目标不可达；请调整自由参数或解除约束。") : "";
  const draftCommitPolicy = draftImpact ? resolveDraftCommitPolicy(draftImpact) : "allow";
  const impactValidationMessage = previewWouldEraseStock
    ? "当前深度会移除全部材料，请减小切入深度。"
    : draftCommitPolicy === "block" && draftImpact?.noOp
      ? "当前切面尚未形成任何有效面；可继续 Jump 或选择顶点，但不能作为空切保存。"
      : draftCommitPolicy === "block"
        ? "当前参数会让台面或腰部结构层整体失效；请减小切入深度。"
        : "";
  const impactWarningMessage = ["warn", "confirm"].includes(draftCommitPolicy)
    ? `当前切割将覆盖 ${draftImpact.removedFaceCount} 个已有有效面；普通 C/P 消面允许，整层消失时保存前会再次确认。`
    : "";
  const validationMessage = draft.error || constructionDiagnostic || impactValidationMessage;
  const primaryDraftFacet = useMemo(() => {
    if (!draft.facets.length) return null;
    const activeIndex = normalizeIndex(baseIndex);
    return draft.facets.find((facet) => normalizeIndex(facet.index) === activeIndex) ?? null;
  }, [baseIndex, draft.facets, patternMode]);
  const operations = useMemo(() => {
    const groups = new Map();
    document.facets.forEach((facet) => {
      if (!groups.has(facet.patternId)) groups.set(facet.patternId, []);
      groups.get(facet.patternId).push(facet);
    });
    const regionCounts = { crown: 0, girdle: 0, pavilion: 0 };
    return [...groups.entries()].map(([id, facets]) => {
      const first = facets[0];
      const locked = first.metadata?.operationType === "table";
      const effectiveFacets = facets.filter((facet) => savedEffectiveFacetIds.has(facet.id));
      if (!locked) regionCounts[first.region] += 1;
      return {
        id,
        label: first.label || `${FACET_REGION_PREFIXES[first.region]}${regionCounts[first.region]} ${FACET_REGION_LABELS[first.region]}`,
        region: first.region,
        industryAngleDeg: first.industryAngleDeg,
        signedBeta: first.betaDeg,
        depth: first.depth,
        indices: facets.map((facet) => facet.index),
        effectiveIndices: effectiveFacets.map((facet) => facet.index),
        effectiveCount: effectiveFacets.length,
        recordedCount: facets.length,
        baseIndex: first.metadata?.primaryIndex ?? first.metadata?.construction?.primaryIndex ?? first.baseIndex,
        preform: Boolean(first.metadata?.preform),
        repeat: first.repeat,
        mirror: first.mirror,
        patternMode: first.metadata?.patternMode || (first.repeat === 1 && facets.length > 1 ? "arbitrary" : "symmetric"),
        facets,
        locked,
        visible: !hiddenPatternIds.has(id),
        status: hiddenPatternIds.has(id)
          ? "显示隐藏"
          : effectiveFacets.length === 0
            ? "已被后续切面覆盖"
            : effectiveFacets.length < facets.length
              ? `${effectiveFacets.length}/${facets.length} 个最终有效面`
              : "参与解析",
      };
    });
  }, [document.facets, hiddenPatternIds, savedEffectiveFacetIds]);
  const editingOperation = operations.find((operation) => operation.id === editingPatternId) ?? null;
  const sourceLabelForTarget = useCallback((target) => {
    const labels = (target?.sourceOperationIds ?? [])
      .filter((id) => id !== "rough-cube")
      .map((id) => operations.find((operation) => operation.id === id)?.label?.split(/\s+/)[0] ?? id);
    return labels.length ? labels.join(" × ") : "毛坯";
  }, [operations]);

  const primaryFacetForDraft = useCallback((draftState) => {
    const resolved = resolveDraftGeometry(draftState, region, document.stock);
    if (resolved.error || resolved.facets.length === 0) return { facet: null, resolved };
    const wanted = normalizeIndex(draftState.baseIndex);
    return {
      facet: resolved.facets.find((facet) => normalizeIndex(facet.index) === wanted) ?? null,
      resolved,
    };
  }, [document.stock, region]);

  const jumpCandidates = useMemo(() => {
    if (!cutSession.canUseMeetJump || cutSession.construction.meet?.secondTarget) return [];
    if (cutSession.construction.meet) {
      if ([MEET_STATUS.STALE, MEET_STATUS.UNREACHABLE].includes(cutSession.construction.meet.status)) return [];
      const source = resolvePersistedMeetTarget(cutSession.construction.meet.target, constructionBaseSolid);
      if (source.status !== MEET_STATUS.VALID) return [];
      return generateDualJumpCandidates({ baseSolid: constructionBaseSolid, targetA: source.target, baseIndex, region, stock: document.stock, targets: meetTargets });
    }
    const jumpDraft = {
      industryAngle,
      depth: 0,
      baseIndex,
      repeat: repeatCount,
      mirrorOffset,
      patternMode,
      customIndices,
    };
    const { facet } = primaryFacetForDraft(jumpDraft);
    if (!facet) return [];
    return generateJumpCandidates({
      baseSolid: constructionBaseSolid,
      normal: facet.plane.normal,
      stock: document.stock,
      targets: meetTargets,
    });
  }, [baseIndex, constructionBaseSolid, customIndices, cutSession.canUseMeetJump, cutSession.construction.meet, document.stock, industryAngle, meetTargets, mirrorOffset, patternMode, primaryFacetForDraft, region, repeatCount]);

  const evaluateJumpCandidate = useCallback((candidate) => {
    const jumpDraft = { industryAngle: candidate.industryAngleDeg ?? industryAngle, baseIndex, repeat: repeatCount, mirrorOffset, patternMode, customIndices, depth: 0 };
    const { facet } = primaryFacetForDraft(jumpDraft);
    return classifyJumpCandidate({
      candidate,
      baseSolid: impactBaseSolid,
      normal: facet.plane.normal,
      stock: document.stock,
      planesForDepth: (depth) => resolveDraftGeometry({ ...jumpDraft, depth }, region, document.stock).facets.map(planeEntry),
    });
  }, [baseIndex, impactBaseSolid, customIndices, document.stock, industryAngle, mirrorOffset, patternMode, primaryFacetForDraft, region, repeatCount]);

  const jumpSession = resolveCutSession(sessionState, { jumpCandidates });

  const nextJumpCandidate = useMemo(() => {
    const index = adjacentJumpCandidateIndex({
      candidates: jumpCandidates,
      currentDepth: Number(cutSession.draft.depth),
      currentAngle: cutSession.construction.meet ? cutSession.draft.industryAngle : undefined,
      currentKey: cutSession.construction.candidate?.key,
    });
    if (index < 0) return null;
    const candidate = evaluateJumpCandidate(jumpCandidates[index]);
    return {
      ...candidate,
      position: `${index + 1}/${jumpCandidates.length}`,
      sourceLabel: sourceLabelForTarget(candidate.target),
    };
  }, [cutSession.construction.candidate?.key, cutSession.construction.meet, cutSession.draft.depth, cutSession.draft.industryAngle, evaluateJumpCandidate, jumpCandidates, sourceLabelForTarget]);

  const candidateFromTarget = useCallback((target, source = "manual") => {
    const meet = cutSession.construction.meet
      ? { ...cutSession.construction.meet, secondTarget: target }
      : { target };
    const result = solveDraftConstruction({ draft: cutSession.draft, region, stock: document.stock, meet, baseSolid: constructionBaseSolid });
    const valid = result.meet.status === MEET_STATUS.VALID;
    const resolved = valid ? resolveDraftGeometry(result.draft, region, document.stock) : null;
    const impact = resolved ? evaluateDraftImpact({ baseSolid: impactBaseSolid, planes: resolved.facets.map(planeEntry) }) : null;
    return {
      source, key: target.topologyKey, target,
      depth: valid ? result.draft.depth : null,
      industryAngleDeg: cutSession.construction.meet && valid ? result.draft.industryAngle : undefined,
      requiredDepth: result.meet.requiredDepth, residual: result.meet.residual,
      status: valid ? impact.status : result.meet.status,
      message: result.meet.message, reason: result.meet.reason,
      classification: impact?.classification ?? "contact-only", threats: impact?.threats ?? [],
      sourceLabel: sourceLabelForTarget(target),
    };
  }, [constructionBaseSolid, impactBaseSolid, cutSession.construction.meet, cutSession.draft, document.stock, region, sourceLabelForTarget]);

  const changeDraftWithConstruction = useCallback((patch) => {
    if (Object.keys(patch).every((key) => key === "preform")) {
      dispatchCutSession({ type: CUT_SESSION_EVENT.CHANGE_DRAFT, patch });
      return;
    }
    const lockedMeet = cutSession.construction.meet;
    const nextDraft = { ...(cutSession.construction.returnDraft ?? cutSession.draft), ...patch };
    if (lockedMeet && nextDraft.patternMode === "arbitrary" && !parseCustomIndices(nextDraft.customIndices).indices.includes(normalizeIndex(nextDraft.baseIndex))) {
      notify("主切面必须保留在自定义索引集合中；请先解除 Meet 或保留该索引。");
      return;
    }
    if (!lockedMeet) {
      dispatchCutSession({ type: CUT_SESSION_EVENT.CHANGE_DRAFT, patch });
      return;
    }
    if (!cutSession.depthEditable) nextDraft.depth = (cutSession.construction.returnDraft ?? cutSession.draft).depth;
    if (!cutSession.angleEditable) nextDraft.industryAngle = (cutSession.construction.returnDraft ?? cutSession.draft).industryAngle;
    const result = solveDraftConstruction({ draft: nextDraft, region, stock: document.stock, meet: lockedMeet, baseSolid: constructionBaseSolid });
    dispatchCutSession({ type: CUT_SESSION_EVENT.CHANGE_DRAFT, patch: result.draft, constructionResult: { meet: result.meet, returnDraft: null, tool: "none" } });
  }, [constructionBaseSolid, cutSession, document.stock, notify, region]);
  const previewPlanes = cutSession.showCutPlane
    && !constructionBlocksPreview
    && !(editingPatternId && hiddenPatternIds.has(editingPatternId))
    ? draft.facets.map((facet) => ({ ...facet.plane, index: facet.index, primary: facet === primaryDraftFacet }))
    : [];

  const draftEffectiveIds = useMemo(
    () => new Set(draftImpact?.resultSolid.faces.map((face) => face.id) ?? []),
    [draftImpact],
  );
  const activeEffectiveIndices = useMemo(() => previewEnabled
    ? draft.facets.filter((facet) => draftEffectiveIds.has(facet.id)).map((facet) => facet.index)
    : editingOperation?.effectiveIndices ?? [],
  [draft.facets, draftEffectiveIds, editingOperation?.effectiveIndices, previewEnabled]);

  const instructionGroups = useMemo(() => {
    const rows = operations.map((operation) => {
      const isActive = operation.id === editingPatternId;
      const livePreview = isActive && draft.facets.length > 0;
      return {
        id: operation.id,
        prefix: operation.label.split(/\s+/)[0],
        region: operation.region,
        angle: livePreview ? industryAngle : operation.industryAngleDeg,
        indices: livePreview ? activeEffectiveIndices : operation.effectiveIndices,
        active: isActive,
        locked: operation.locked,
        hidden: !operation.visible,
      };
    });

    if (!editingPatternId && !groupEditRegion && previewEnabled && draft.facets.length > 0) {
      const number = operations.filter((operation) => operation.region === region && !operation.locked).length + 1;
      rows.push({
        id: "draft-instruction",
        prefix: `${FACET_REGION_PREFIXES[region]}${number}`,
        region,
        angle: industryAngle,
        indices: activeEffectiveIndices,
        active: true,
        locked: false,
        hidden: false,
      });
    }

    const effectiveRows = rows.filter((row) => row.indices.length > 0);
    return {
      pavilion: effectiveRows
        .filter((row) => row.region === "pavilion"),
      girdle: effectiveRows
        .filter((row) => row.region === "girdle"),
      crown: effectiveRows
        .filter((row) => row.region === "crown")
        .sort((left, right) => Number(left.locked) - Number(right.locked)),
    };
  }, [activeEffectiveIndices, draft.facets.length, editingPatternId, groupEditRegion, industryAngle, operations, previewEnabled, region]);

  const historyEntries = useMemo(() => history.commands.slice(0, history.cursor).map((command) => {
    const createdAt = command.payload?.facets?.[0]?.metadata?.createdAt;
    return {
      id: command.id,
      patternId: commandPatternId(command),
      time: formatClock(createdAt),
      description: describeCommand(command),
    };
  }), [history.commands, history.cursor]);

  const makeOperationIdentity = useCallback((targetRegion) => {
    operationSequence.current += 1;
    const number = operations.filter((item) => item.region === targetRegion && !item.locked).length + 1;
    return {
      patternId: `cut-${Date.now()}-${operationSequence.current}`,
      label: `${FACET_REGION_PREFIXES[targetRegion]}${number} ${FACET_REGION_LABELS[targetRegion]}`,
    };
  }, [operations]);

  const applyDraft = (confirmedFullRemoval = false) => {
    if (!cutSession.canCommit || validationMessage || draft.facets.length === 0) return;
    const current = operations.find((operation) => operation.id === editingPatternId);

    const baseFacets = current
      ? document.facets.filter((facet) => facet.patternId !== current.id)
      : document.facets;
    const baseSolid = clipPolyhedronByPlanes(stockSolid, baseFacets.map(planeEntry));
    const impact = evaluateDraftImpact({ baseSolid, planes: draft.facets.map(planeEntry) });
    const policy = resolveDraftCommitPolicy(impact);
    if (policy === "block") {
      notify(impact.solidErased
        ? "已拒绝保存：当前参数会移除全部材料，请减小切入深度。"
        : impact.noOp
          ? "已拒绝空切：当前切面没有形成任何有效面。"
          : "已拒绝保存：当前参数会让台面或腰部结构层整体失效。");
      return;
    }
    const fullyRemovedOperations = impact.threats.filter((threat) => threat.fullyRemoved);
    if (policy === "confirm" && confirmedFullRemoval !== true) {
      setPendingFullRemovalCommit({
        removedFaceCount: impact.removedFaceCount,
        operations: fullyRemovedOperations.map((threat) => ({
          ...threat,
          label: operations.find((operation) => operation.id === threat.operationId)?.label ?? threat.operationId,
        })),
      });
      setModal("confirm-face-removal");
      return;
    }

    const { patternId, label } = current
      ? { patternId: current.id, label: current.label }
      : makeOperationIdentity(region);
    const createdAt = new Date().toISOString();
    const metadata = {
      ...(current?.facets[0]?.metadata || {}),
      createdAt: current?.facets[0]?.metadata?.createdAt || createdAt,
      updatedAt: createdAt,
      integerIndexOnly: true,
      patternMode,
    };
    metadata.primaryIndex = normalizeIndex(baseIndex);
    if (cutSession.canMarkPreform) metadata.preform = Boolean(cutSession.draft.preform);
    else delete metadata.preform;
    const lockedMeet = cutSession.construction.meet;
    if (lockedMeet && [MEET_STATUS.VALID, MEET_STATUS.DESTRUCTIVE].includes(lockedMeet.status)) {
      metadata.construction = {
        type: lockedMeet.secondTarget ? "dual-meet" : lockedMeet.target.kind === "edge-point" ? "edge-meet" : "vertex-meet",
        solverVersion: 2, primaryIndex: normalizeIndex(baseIndex),
        target: snapshotMeetTarget(lockedMeet.target),
        ...(lockedMeet.secondTarget ? { secondTarget: snapshotMeetTarget(lockedMeet.secondTarget) } : {}),
      };
    } else delete metadata.construction;

    try {
      const facets = draft.facets.map((facet) => ({
          ...facet,
          id: `${patternId}:${displayIndex(facet.index)}`,
          patternId,
          label,
          metadata,
        }));
      const command = current
        ? createReplacePatternCommand(patternId, facets)
        : createAddFacetsCommand(facets);
      setHistory((currentHistory) => executeFacetingCommand(currentHistory, command));
      dispatchCutSession({ type: CUT_SESSION_EVENT.COMMIT_SUCCESS });
      setPendingFullRemovalCommit(null);
      const successMessage = current
        ? `已更新“${label}”并退出编辑，${draft.facets.length} 个面已重新解析。`
        : `已加入“${label}”并退出编辑；再次选择该层可继续调整。`;
      notify(impact.removedFaceCount > 0
        ? `${successMessage} 最终实体同步移除 ${impact.removedFaceCount} 个被覆盖面。`
        : successMessage);
    } catch (error) {
      notify(error.message);
    }
  };

  const startNewCut = () => {
    if (!cutSession.showNewButton) return;
    dispatchCutSession({ type: CUT_SESSION_EVENT.START_CREATE, region });
    notify("已进入新建动作；已保存图层保持不变。");
  };

  const cancelCutSession = useCallback(() => {
    if (!cutSession.canCancel) return;
    const discarded = cutMode === CUT_SESSION_MODE.CREATE || cutSession.dirty;
    dispatchCutSession({ type: CUT_SESSION_EVENT.CANCEL });
    notify(cutMode === CUT_SESSION_MODE.GROUP
      ? "已取消整体变换。"
      : discarded
        ? "已放弃未保存预览并返回浏览状态。"
        : "已退出图层编辑。");
  }, [cutMode, cutSession.canCancel, cutSession.dirty, notify]);

  useEffect(() => {
    if (!cutSession.canCancel || modal || ascTransfer || presetLibraryOpen || opticsActive || ledgerOpen || recoveryOpen || assistantOpen) return undefined;
    const handleEscape = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (cutSession.canCancelConstructionTool) {
        dispatchCutSession({ type: CUT_SESSION_EVENT.CANCEL_CONSTRUCTION_TOOL });
        notify("已退出当前构造步骤；已锁约束保持不变。");
      } else {
        cancelCutSession();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [ascTransfer, cancelCutSession, cutSession.canCancel, cutSession.canCancelConstructionTool, ledgerOpen, modal, notify, opticsActive, presetLibraryOpen, recoveryOpen, assistantOpen]);

  useEffect(() => {
    if (!opticsActive || modal || ascTransfer || presetLibraryOpen) return undefined;
    const handleOpticsEscape = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpticsActive(false);
      notify("已退出光学仿真并恢复原编辑现场。");
    };
    window.addEventListener("keydown", handleOpticsEscape);
    return () => window.removeEventListener("keydown", handleOpticsEscape);
  }, [ascTransfer, modal, notify, opticsActive, presetLibraryOpen]);

  useEffect(() => {
    if (!presetLibraryOpen) return undefined;
    const handlePresetEscape = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setPresetLibraryOpen(false);
    };
    window.addEventListener("keydown", handlePresetEscape);
    return () => window.removeEventListener("keydown", handlePresetEscape);
  }, [presetLibraryOpen]);

  const selectCut = (id) => {
    if (id === "rough-cube") return;
    if (!cutSession.canPickLayer) return;
    const operation = operations.find((item) => item.id === id);
    if (!operation) return;
    const first = operation.facets[0];
    const persisted = first.metadata?.construction;
    let construction = null;
    if (persisted) {
      const diagnostic = diagnosticsById[id];
      construction = { meet: {
        target: persisted.target, ...(persisted.secondTarget ? { secondTarget: persisted.secondTarget } : {}),
        status: diagnostic?.status ?? MEET_STATUS.STALE,
        requiredDepth: operation.depth, residual: 0, threats: [],
        sourceLabel: sourceLabelForTarget(persisted.target),
        secondSourceLabel: persisted.secondTarget ? sourceLabelForTarget(persisted.secondTarget) : "",
        message: diagnostic?.message ?? "Meet 来源已失效。",
      } };
    }
    dispatchCutSession({
      type: CUT_SESSION_EVENT.SELECT_LAYER,
      patternId: id,
      region: first.region,
      draft: {
        industryAngle: first.industryAngleDeg,
        depth: first.depth,
        baseIndex: operation.baseIndex ?? first.index,
        preform: operation.preform,
        repeat: first.repeat || operation.indices.length,
        mirrorOffset: first.mirror || 0,
        patternMode: operation.patternMode,
        customIndices: operation.indices.map((index) => displayIndex(index)).join(" "),
      },
      construction,
      lockedLayer: operation.locked,
    });
  };

  const removeCut = (id) => {
    if (!cutSession.canMutateStack) return;
    const operation = operations.find((item) => item.id === id);
    if (!operation) return;
    if (operation.locked) {
      notify("台面是固定结构层，只能调整深度，不能删除。");
      return;
    }
    const command = createRemoveFacetsCommand(operation.facets.map((facet) => facet.id));
    setHistory((currentHistory) => executeFacetingCommand(currentHistory, command));
    setHiddenPatternIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    notify(`已从解析序列移除“${operation.label}”，可使用撤销恢复。`);
  };

  const renameCut = (id, label) => {
    if (!cutSession.canMutateStack) return;
    const operation = operations.find((item) => item.id === id);
    if (!operation || operation.locked) return;
    const facets = operation.facets.map((facet) => ({ ...facet, label }));
    const command = createReplacePatternCommand(id, facets);
    setHistory((currentHistory) => executeFacetingCommand(currentHistory, command));
    notify(`已重命名为“${label}”。`);
  };

  const reorderCut = (fromIndex, toIndex) => {
    if (!cutSession.canMutateStack) return;
    const ordered = [...operations];
    const [moved] = ordered.splice(fromIndex, 1);
    if (!moved || moved.locked) return;
    ordered.splice(toIndex, 0, moved);
    // The fixed table layer always leads the boolean sequence.
    ordered.sort((a, b) => Number(b.locked) - Number(a.locked));
    const positionById = new Map(ordered.map((item, position) => [item.id, position]));
    const facets = [...document.facets].sort(
      (a, b) => (positionById.get(a.patternId) ?? 0) - (positionById.get(b.patternId) ?? 0),
    );
    const command = createReplaceDocumentCommand({ ...document, facets });
    setHistory((currentHistory) => executeFacetingCommand(currentHistory, command));
    notify(`已调整布尔顺序：“${moved.label}”移至第 ${toIndex + 1} 位。`);
  };

  // Inline layer editing drives the same draft state as the drawer controls.
  const inlineEdit = (field, value) => {
    if (!editingPatternId) return;
    if (field === "angle") {
      changeDraftWithConstruction({ industryAngle: Math.min(90, Math.max(0, value)) });
    } else if (field === "depth") {
      if (cutSession.depthEditable) changeDraftWithConstruction({ depth: normalizeDepthValue(value) });
    }
  };

  const changeRegion = (nextRegion) => {
    if (nextRegion === region) return;
    if (!cutSession.canChangeRegion) return;
    // Region switching is a new-action gesture: a selected layer stays
    // untouched and the draft restarts with the new region's defaults.
    dispatchCutSession({ type: CUT_SESSION_EVENT.CHANGE_REGION, region: nextRegion });
  };

  const startGroupEdit = (targetRegion) => {
    if (targetRegion === "girdle" || !cutSession.canStartGroup) return;
    dispatchCutSession({ type: CUT_SESSION_EVENT.START_GROUP, region: targetRegion });
  };

  const changeGroupDelta = (value) => {
    dispatchCutSession({ type: CUT_SESSION_EVENT.CHANGE_GROUP, patch: { deltaZ: value } });
  };

  const changeGroupScale = (value) => {
    dispatchCutSession({ type: CUT_SESSION_EVENT.CHANGE_GROUP, patch: { scale: value } });
  };

  const changeGroupRotation = (value) => {
    const normalized = normalizeIndex(Math.round(Number(value) || 0));
    const teeth = normalized > 48 ? normalized - 96 : normalized;
    dispatchCutSession({ type: CUT_SESSION_EVENT.CHANGE_GROUP, patch: { rotationTeeth: teeth } });
  };

  const applyGroupEdit = () => {
    const shift = Number(groupDeltaZ);
    const scale = Number(groupScale);
    const rotation = Math.round(Number(groupRotationTeeth) || 0);
    if (!groupEditRegion || !cutSession.canCommit || groupPreview.error) return;

    const beforeSolid = savedSolid;
    const afterSolid = clipPolyhedronByPlanes(stockSolid, groupPreview.facets.map(planeEntry));
    const survivingIds = new Set(afterSolid.faces.map((face) => face.id));
    const destroyed = beforeSolid.faces.filter(
      (face) => face.sourceOperationId && face.sourceOperationId !== "rough-cube" && !survivingIds.has(face.id),
    );
    if (destroyed.length > 0) {
      const labels = [...new Set(destroyed.map((face) => (
        operations.find((operation) => operation.id === face.sourceOperationId)?.label ?? face.sourceOperationId
      )))].join("、");
      notify(`已拒绝整体变换：该调整会消除「${labels}」的面。`);
      return;
    }

    const updatedAt = new Date().toISOString();
    const nextDocument = {
      ...document,
      facets: groupPreview.facets.map((facet) => facet.region === groupEditRegion
        ? { ...facet, metadata: { ...(facet.metadata || {}), updatedAt } }
        : facet),
    };
    const groupLabel = groupEditRegion === "crown" ? "冠部与台面" : "亭部";
    const description = `${groupLabel}整体变换 · ΔZ ${shift >= 0 ? "+" : ""}${shift.toFixed(3)} · H ${(scale * 100).toFixed(1)}% · R ${rotation >= 0 ? "+" : ""}${rotation}T`;
    const command = createReplaceDocumentCommand(nextDocument, { description });
    setHistory((currentHistory) => executeFacetingCommand(currentHistory, command));
    dispatchCutSession({ type: CUT_SESSION_EVENT.COMMIT_SUCCESS });
    notify(`已应用${groupLabel}整体变换；可一步撤销。`);
  };

  const handleFacePick = (operationId) => {
    if (!cutSession.canPickLayer) return;
    selectCut(operationId);
  };

  const handleJump = useCallback((direction) => {
    if (!(direction < 0 ? jumpSession.canJumpPrevious : jumpSession.canJumpNext)) return;
    const nextIndex = adjacentJumpCandidateIndex({
      candidates: jumpCandidates,
      currentDepth: Number(cutSession.draft.depth),
      currentAngle: cutSession.construction.meet ? cutSession.draft.industryAngle : undefined,
      currentKey: cutSession.construction.candidate?.key,
      direction,
    });
    const raw = nextIndex === nextJumpCandidate?.index
      ? nextJumpCandidate
      : evaluateJumpCandidate(jumpCandidates[nextIndex]);
    const candidate = {
      ...raw,
      status: raw.classification === "destructive" ? MEET_STATUS.DESTRUCTIVE : MEET_STATUS.VALID,
      requiredDepth: raw.depth,
      residual: 0,
      position: `${nextIndex + 1}/${jumpCandidates.length}`,
      sourceLabel: sourceLabelForTarget(raw.target),
    };
    dispatchCutSession({ type: CUT_SESSION_EVENT.SELECT_MEET_CANDIDATE, candidate });
  }, [cutSession.canUseMeetJump, cutSession.construction.candidate?.key, cutSession.construction.meet, cutSession.draft.depth, evaluateJumpCandidate, jumpCandidates, jumpSession.canJumpPrevious, jumpSession.canJumpNext, nextJumpCandidate, notify, sourceLabelForTarget]);

  const handleVertexPick = useCallback((target) => {
    if (!["pick-vertex", "pick-edge"].includes(cutSession.construction.tool)) return;
    const edge = target.kind === "edge" ? target : null;
    const selected = edge ? createEdgeMeetTarget(edge, 0.5) : target;
    const candidate = candidateFromTarget(selected);
    if (candidate) dispatchCutSession({ type: CUT_SESSION_EVENT.SELECT_MEET_CANDIDATE, candidate: { ...candidate, ...(edge ? { edge, ratio: 0.5 } : {}) } });
  }, [candidateFromTarget, cutSession.construction.tool]);
  const changeEdgeRatio = (ratio) => {
    const edge = cutSession.construction.candidate?.edge;
    if (!cutSession.canEditEdgeRatio || !edge || !Number.isFinite(ratio) || ratio < 0 || ratio > 1) return;
    const candidate = candidateFromTarget(createEdgeMeetTarget(edge, ratio));
    dispatchCutSession({ type: CUT_SESSION_EVENT.CHANGE_EDGE_RATIO, candidate: { ...candidate, edge, ratio } });
  };
  const startMeetPick = useCallback(({ kind = "vertex" } = {}) => dispatchCutSession({ type: CUT_SESSION_EVENT.START_MEET_PICK, tool: kind === "edge" ? "pick-edge" : "pick-vertex" }), []);
  const lockMeet = useCallback(() => {
    const candidate = cutSession.construction.candidate;
    if (!candidate || !cutSession.canLockMeet) return;
    const prior = cutSession.construction.meet;
    dispatchCutSession({ type: CUT_SESSION_EVENT.LOCK_MEET, meet: {
      ...(prior ? { ...prior, secondTarget: candidate.target, secondSourceLabel: candidate.sourceLabel } : { target: candidate.target, sourceLabel: candidate.sourceLabel }),
      status: candidate.classification === "destructive" ? MEET_STATUS.DESTRUCTIVE : candidate.status,
      requiredDepth: candidate.requiredDepth ?? candidate.depth, residual: candidate.residual ?? 0,
      threats: candidate.threats ?? [], message: candidate.message ?? "",
    } });
  }, [cutSession.canLockMeet, cutSession.construction]);
  const clearMeet = (slot = "all") => {
    const current = cutSession.construction.meet;
    const remaining = slot === "A" ? current?.secondTarget : slot === "B" ? current?.target : null;
    const draftState = cutSession.construction.returnDraft ?? cutSession.draft;
    const result = remaining ? solveDraftConstruction({ draft: draftState, region, stock: document.stock, meet: { target: remaining }, baseSolid: constructionBaseSolid }) : null;
    dispatchCutSession({ type: CUT_SESSION_EVENT.CLEAR_MEET, slot, ...(result ? { meet: { ...result.meet, sourceLabel: sourceLabelForTarget(remaining) }, patch: result.draft } : {}) });
  };
  useEffect(() => {
    if (!cutSession.canUseMeetJump || modal || ascTransfer || presetLibraryOpen || opticsActive || ledgerOpen || recoveryOpen || assistantOpen) return undefined;
    const handleJumpKey = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (!["j", "m", "b", "v"].includes(key)) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      event.preventDefault();
      if (key === "j") handleJump(event.shiftKey ? -1 : 1);
      else if (key === "m" && !cutSession.construction.meet) lockMeet();
      else if (key === "b" && cutSession.canLockSecondMeet) lockMeet();
      else if (key === "v") {
        if (["pick-vertex", "pick-edge"].includes(cutSession.construction.tool)) dispatchCutSession({ type: CUT_SESSION_EVENT.CANCEL_CONSTRUCTION_TOOL });
        else startMeetPick();
      }
    };
    window.addEventListener("keydown", handleJumpKey);
    return () => window.removeEventListener("keydown", handleJumpKey);
  }, [ascTransfer, cutSession, handleJump, ledgerOpen, lockMeet, modal, opticsActive, presetLibraryOpen, recoveryOpen, assistantOpen, startMeetPick]);

  const handleDepthDrag = (rawDepth) => {
    if (!cutSession.depthEditable) return;
    changeDraftWithConstruction({ depth: normalizeDepthValue(rawDepth) });
  };

  const handleAngleDrag = (rawAngle) => {
    if (!cutSession.angleEditable) return;
    changeDraftWithConstruction({ industryAngle: Math.min(90, Math.max(0, rawAngle)) });
  };

  const cutGizmo = useMemo(() => {
    if (!primaryDraftFacet) return null;
    const normal = primaryDraftFacet.plane.normal;
    const offset = primaryDraftFacet.plane.offset;
    const primaryIndex = normalizeIndex(primaryDraftFacet.index);
    const radial = facetNormal(primaryIndex, 0);
    const indexRadius = document.stock.size * 1.08;
    return {
      center: [normal.x * offset, normal.y * offset, normal.z * offset],
      normal: [normal.x, normal.y, normal.z],
      radial: [radial.x, radial.y, 0],
      baseIndex: primaryIndex,
      region,
      industryAngle,
      angleLocked: !cutSession.angleEditable,
      depthLocked: !cutSession.depthEditable,
      arcRadius: indexRadius,
      bearingCenter: [0, 0, 0],
      bearingRadius: indexRadius,
      value: depth,
      indexRing: patternMode === "symmetric" ? {
        center: [0, 0, 0],
        outerRadius: indexRadius,
        innerRadius: document.stock.size * 0.82,
        baseIndex,
        repeat: repeatCount,
        mirror: mirrorOffset,
        locked: Boolean(editingOperation?.locked),
      } : null,
    };
  }, [cutSession.angleEditable, cutSession.depthEditable, depth, document.stock.size, editingOperation?.locked, industryAngle, mirrorOffset, patternMode, primaryDraftFacet, region, repeatCount]);

  const depthControlMax = Math.max(document.stock.size * 1.5, depth * 1.25, 1);

  const resetDocument = (name) => {
    setRecoveryStarted(true);
    setHistory(createCommandHistory(createWorkbenchDocument(name)));
    setOpticsViewSettings(DEFAULT_OPTICS_SETTINGS.view);
    setHiddenPatternIds(new Set());
    dispatchCutSession({ type: CUT_SESSION_EVENT.DOCUMENT_CREATE, region: "crown" });
    setResetSignal((value) => value + 1);
  };

  const startNewDocument = () => {
    projectSequence.current += 1;
    resetDocument(`未命名切型 ${String(projectSequence.current).padStart(2, "0")}`);
    setModal(null);
    notify("已创建新设计，并初始化固定台面 T1。");
  };

  const renameProject = (name) => {
    const nextName = name.trim();
    if (!nextName || nextName === document.name) return;
    const command = createReplaceDocumentCommand(
      { ...document, name: nextName },
      { description: `重命名切型 · ${nextName}` },
    );
    setHistory((currentHistory) => executeFacetingCommand(currentHistory, command));
    notify(`切型已重命名为“${nextName}”。`);
  };

  const exportDocument = () => {
    const json = exportFacetingJSON(document);
    const blob = new Blob([json], { type: "application/json" });
    downloadBlob(blob, `${document.name.replace(/[^\p{L}\p{N}-]+/gu, "-") || "facet-96"}.json`);
    notify(`已导出 ${document.facets.length} 个面的完整 JSON 参数。`);
  };

  const exportPdfReport = async () => {
    setModal(null);
    notify("正在生成切磨数据报告…");
    try {
      await downloadFacetReport({
        document,
        solid: reportSolid,
        metrics: reportMetrics,
        includeGirdle: reportIncludeGirdle,
        hiddenPatternIds: [...hiddenPatternIds],
      });
      notify(reportIncludeGirdle
        ? `PDF 报告已生成：${savedEffectiveFacets.effectiveFacetIds.length} 个最终有效面，含腰部逐面表。`
        : `PDF 报告已生成：腰部逐面表按默认规则省略，几何视图中仍可见。`);
    } catch (error) {
      notify(`PDF 导出失败：${error.message}`);
    }
  };

  const applyImportedDocument = (imported, { description } = {}) => {
    const command = createReplaceDocumentCommand(imported, description ? { description } : undefined);
    setHistory((current) => executeFacetingCommand(current, command));
    setHiddenPatternIds(new Set());
    dispatchCutSession({ type: CUT_SESSION_EVENT.DOCUMENT_IMPORT });
  };

  const importDocument = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const imported = ensureTableFacet(importFacetingJSON(await file.text()));
      applyImportedDocument(imported);
      notify(`已导入“${imported.name}”，共 ${imported.facets.length} 个面。`);
    } catch (error) {
      const detail = error.errors?.[0];
      notify(detail ? `导入失败：${detail.path} ${detail.message}` : `导入失败：${error.message}`);
    }
  };

  const inspectAscFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const result = inspectGemCadAsc(await file.text(), { fileName: file.name });
    setAscTransfer({ mode: "import", fileName: file.name, result });
  };

  const openAscExport = () => {
    const result = serializeGemCadAsc(document);
    setAscTransfer({
      mode: "export",
      fileName: `${safeFileStem(document.name)}.asc`,
      result,
    });
  };

  const confirmAscTransfer = () => {
    if (!ascTransfer || ascTransfer.result.status === "error") return;
    if (ascTransfer.mode === "import") {
      const imported = ascTransfer.result.document;
      applyImportedDocument(imported, {
        description: `导入 GemCad ASC · ${ascTransfer.fileName}`,
      });
      setAscTransfer(null);
      notify(`已导入“${imported.name}”：${ascTransfer.result.summary.tierCount} 层 / ${imported.facets.length} 面，可撤销。`);
      return;
    }

    const blob = new Blob([ascTransfer.result.text], { type: "text/plain;charset=utf-8" });
    downloadBlob(blob, ascTransfer.fileName);
    setAscTransfer(null);
    notify(`已导出 ${ascTransfer.result.summary.tierCount} 个 ASC tier；JSON 完整主文件未受影响。`);
  };

  const loadPreset = async (rawDocument, preset) => {
    const imported = ensureTableFacet(importFacetingJSON(JSON.stringify(rawDocument)));
    applyImportedDocument(imported, {
      description: `载入预设琢型 · ${preset.name}`,
    });
    setPresetLibraryOpen(false);
    setResetSignal((value) => value + 1);
    notify(`已载入预设“${preset.name}”，共 ${imported.facets.length} 个面，可撤销。`);
  };

  const toggleVisibility = (id) => {
    if (!cutSession.canMutateStack) return;
    if (id === "rough-cube") return;
    const operation = operations.find((item) => item.id === id);
    if (operation?.locked) {
      notify("台面是固定结构层，始终参与布尔序列。");
      return;
    }
    setHiddenPatternIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const inspectHistoryEntry = (commandId) => {
    const entry = historyEntries.find((item) => item.id === commandId);
    if (entry?.patternId) {
      selectCut(entry.patternId);
    }
  };

  const visibleEffectiveCount = useMemo(() => summarizeEffectiveFacets(displaySolid).effectiveFacetIds.length, [displaySolid]);
  const composerStatus = `有效刻面 ${visibleEffectiveCount} · 毛坯面 ${metrics.faces.length - visibleEffectiveCount} · 体积 ${metrics.volume.toFixed(3)}`;
  const composerValidationMessage = groupEditRegion
    ? `正在整体变换${groupEditRegion === "crown" ? "冠部与台面" : "亭部"}；请先应用或取消。`
    : cutSession.active ? validationMessage : "";

  return (
    <main className={opticsActive ? "app-shell is-optics-active" : "app-shell"}>
      <section className={`${sidebarOpen ? "editor-workspace" : "editor-workspace is-sidebar-collapsed"}${opticsActive ? " is-optics-focus" : ""}`}>
        {!opticsActive ? <aside className="control-sidebar" aria-label="切磨参数侧栏">
          <div className="workspace-brand">
            <img className="brand-logo" src={`${import.meta.env.BASE_URL}brand/logo-header.webp`} alt="苏哇品牌标志" />
            <div className="brand-copy">
              <span className="brand-title-line"><strong>切磨工作台</strong><em>Alpha</em></span>
              <span className="brand-product-line">SUVA · FACET 96 专业版</span>
            </div>
            <button
              type="button"
              className="collapse-sidebar"
              onClick={() => setSidebarOpen(false)}
              aria-label="收起参数侧栏"
              disabled={cutSession.active}
              title={cutSession.active ? "请先保存或取消当前操作" : "收起参数侧栏"}
            >
              <IconChevronLeft size={18} stroke={1.8} />
            </button>
          </div>

          <div className="sidebar-sections">
            <details className="control-section" open>
              <summary><span>切割参数 CUT</span><small>{FACET_REGION_LABELS[region]}</small></summary>
              <MastControl
                region={region}
                industryAngle={industryAngle}
                signedBeta={signedBeta}
                depth={depth}
                disabled={!cutSession.controlsEnabled}
                onAngleChange={(value) => {
                  changeDraftWithConstruction({ industryAngle: value });
                }}
                onDepthChange={(value) => {
                  if (cutSession.depthEditable) changeDraftWithConstruction({ depth: normalizeDepthValue(value) });
                }}
                depthMax={depthControlMax}
                angleLocked={!cutSession.angleEditable}
                depthEditable={cutSession.depthEditable}
                construction={cutSession.construction}
                nextJumpCandidate={nextJumpCandidate}
                canUseMeetJump={cutSession.canUseMeetJump}
                canJumpPrevious={jumpSession.canJumpPrevious}
                canJumpNext={jumpSession.canJumpNext}
                canPickMeetTarget={cutSession.canPickMeetTarget}
                canLockMeet={cutSession.canLockMeet}
                canCancelConstructionTool={cutSession.canCancelConstructionTool}
                onJump={handleJump}
                onStartMeetPick={startMeetPick}
                onCancelConstructionTool={() => dispatchCutSession({ type: CUT_SESSION_EVENT.CANCEL_CONSTRUCTION_TOOL })}
                onLockMeet={lockMeet}
                onClearMeet={() => clearMeet("all")}
                canLockSecondMeet={cutSession.canLockSecondMeet}
                canRemoveMeetA={cutSession.canClearMeetA}
                canRemoveMeetB={cutSession.canClearMeetB}
                canClearMeet={cutSession.canClearMeetA}
                canEditEdgeRatio={cutSession.canEditEdgeRatio}
                onLockSecondMeet={lockMeet}
                onRemoveMeet={clearMeet}
                onEdgeRatioChange={changeEdgeRatio}
                onFinishEdgeEdit={() => dispatchCutSession({ type: CUT_SESSION_EVENT.FINISH_EDGE_EDIT })}
              />
              <CutComposer
                patternMode={patternMode}
                onPatternModeChange={(value) => {
                  changeDraftWithConstruction({ patternMode: value });
                }}
                baseIndex={baseIndex}
                onBaseIndexChange={(value) => {
                  changeDraftWithConstruction({ baseIndex: normalizeIndex(value) });
                }}
                repeatCount={repeatCount}
                repeatOptions={VALID_REPEAT_COUNTS}
                onRepeatChange={(value) => {
                  changeDraftWithConstruction({ repeat: value });
                }}
                mirrorOffset={mirrorOffset}
                onMirrorChange={(value) => {
                  changeDraftWithConstruction({ mirrorOffset: Math.min(48, Math.max(0, Math.round(value))) });
                }}
                customIndices={customIndices}
                onCustomIndicesChange={(value) => {
                  changeDraftWithConstruction({ customIndices: value });
                }}
                generatedCount={draft.facets.length}
                instructionGroups={instructionGroups}
                mode={cutMode}
                controlsEnabled={cutSession.controlsEnabled}
                previewEnabled={previewEnabled}
                lockedPattern={Boolean(editingOperation?.locked)}
                primaryIndices={parseCustomIndices(customIndices).indices}
                primaryIndexEditable={cutSession.controlsEnabled && !editingOperation?.locked}
                preform={Boolean(cutSession.draft.preform)}
                canEditPreform={cutSession.canMarkPreform}
                onPreformChange={(preform) => changeDraftWithConstruction({ preform })}
                validationMessage={composerValidationMessage}
                warningMessage={cutSession.active ? impactWarningMessage : ""}
                status={composerStatus}
              />
            </details>
          </div>
        </aside> : null}

        <div className="viewport-column">
          {opticsActive ? (
            <div className="optics-brand-rail" aria-label="切磨工作台品牌">
              <img className="brand-logo" src={`${import.meta.env.BASE_URL}brand/logo-header.webp`} alt="苏哇品牌标志" />
              <span><strong>切磨工作台</strong><small>Alpha</small><em>SUVA · FACET 96</em></span>
            </div>
          ) : null}

          {!opticsActive && !sidebarOpen ? (
            <button type="button" className="sidebar-reopen" onClick={() => setSidebarOpen(true)} aria-label="展开参数侧栏">
              <IconChevronRight size={18} stroke={1.8} />
            </button>
          ) : null}

          <Header
            projectName={document.name}
            onProjectNameChange={renameProject}
            facetCount={operations.reduce((sum, item) => sum + item.effectiveCount, 0)}
            onNew={() => setModal("new")}
            onOpenPresets={() => setPresetLibraryOpen(true)}
            onImport={() => importRef.current?.click()}
            onImportAsc={() => ascImportRef.current?.click()}
            onExport={() => hasUnsavedPreview ? setModal("json-export") : exportDocument()}
            backupStatus={localRecovery.status}
            onOpenRecovery={() => {
              localRecovery.refresh();
              setRecoveryStartup(false);
              setRecoveryOpen(true);
            }}
            onExportAsc={openAscExport}
            onExportPdf={() => setModal("pdf")}
            onUndo={() => {
              setHistory((current) => undoFacetingCommand(current));
            }}
            onRedo={() => {
              setHistory((current) => redoFacetingCommand(current));
            }}
            canUndo={cutMode === CUT_SESSION_MODE.IDLE && canUndo(history)}
            canRedo={cutMode === CUT_SESSION_MODE.IDLE && canRedo(history)}
            onOpenHistory={() => setHistoryOpen((value) => !value)}
            onOpenLedger={() => setLedgerOpen(true)}
            onOpenSettings={() => setModal("settings")}
            onOpenHelp={() => setModal("help")}
            onOpenAssistant={() => setAssistantOpen(true)}
            viewMode={opticsActive ? opticsViewMode : viewMode}
            onViewMode={opticsActive ? setOpticsViewMode : setViewMode}
            displayMode={renderMode}
            onDisplayMode={setRenderMode}
            opticsActive={opticsActive}
            opticsInspectorOpen={opticsInspectorOpen}
            onEnterOptics={() => {
              setOpticsViewMode(viewMode);
              setOpticsInspectorOpen(true);
              setOpticsActive(true);
              notify("已进入纯光学仿真；CUT 会话已原样挂起。");
            }}
            onOpenOpticsInspector={() => setOpticsInspectorOpen(true)}
            onExitOptics={() => {
              setOpticsActive(false);
              notify("已退出光学仿真并恢复原编辑现场。");
            }}
          />

          {assistantOpen ? <ConstructionAssistantDialog
            stages={constructionStages.map((stage) => ({ ...stage, label: operations.find((operation) => operation.id === stage.id)?.label ?? stage.id }))}
            currentStageIndex={Math.min(assistantStageIndex, Math.max(0, constructionStages.length - 1))}
            onStageChange={setAssistantStageIndex}
            phase={assistantPhase}
            onPhaseChange={setAssistantPhase}
            onClose={() => setAssistantOpen(false)}
            renderStage={(stage, phase) => <GemViewport polyhedron={phase === "before" ? stage.beforeSolid : stage.afterSolid} viewMode="perspective" renderMode="solid" pickingEnabled={false} />}
          /> : null}
          {!opticsActive ? <CutStack
            operations={operations}
            selectedId={editingPatternId}
            hoveredId={hoveredPatternId}
            onSelect={selectCut}
            onHover={setHoveredPatternId}
            onNew={startNewCut}
            showNew={cutSession.showNewButton}
            canSelectLayers={cutSession.canPickLayer}
            canMutateStack={cutSession.canMutateStack}
            canChangeRegion={cutSession.canChangeRegion}
            canStartGroup={cutSession.canStartGroup}
            onToggleVisibility={toggleVisibility}
            onRemove={removeCut}
            onRename={renameCut}
            onReorder={reorderCut}
            inlineValues={{ angle: industryAngle, depth }}
            onInlineEdit={inlineEdit}
            onInlineCommit={applyDraft}
            depthEditable={cutSession.depthEditable}
            angleEditable={cutSession.angleEditable}
            diagnosticsById={diagnosticsById}
            activeRegion={region}
            onRegionChange={changeRegion}
            groupEditRegion={groupEditRegion}
            groupDeltaZ={groupDeltaZ}
            groupScale={groupScale}
            groupRotationTeeth={groupRotationTeeth}
            groupBaseHeight={groupBaseHeight}
            groupError={groupPreview.error}
            canApplyGroupEdit={cutSession.canCommit}
            groupExitLabel={cutSession.exitLabel}
            onStartGroupEdit={startGroupEdit}
            onGroupDeltaChange={changeGroupDelta}
            onGroupScaleChange={changeGroupScale}
            onGroupRotationChange={changeGroupRotation}
            onApplyGroupEdit={applyGroupEdit}
            onCancelGroupEdit={cancelCutSession}
            canCancelSession={cutSession.canCancel && cutMode !== CUT_SESSION_MODE.GROUP}
            sessionMode={cutMode}
            sessionFaceCount={draft.facets.length}
            sessionEffectiveCount={activeEffectiveIndices.length}
            sessionDirty={cutSession.dirty}
            canCommitSession={cutSession.canCommit}
            commitDisabledReason={composerValidationMessage
              || (cutMode === CUT_SESSION_MODE.EDIT && !cutSession.canCommit ? "参数未修改" : "")}
            onCommitSession={() => applyDraft()}
            onCancelSession={cancelCutSession}
            floating
            collapsed={!cutStackOpen}
            onToggle={() => setCutStackOpen((value) => !value)}
          /> : null}

          {!cutSession.active && !opticsActive && constructionStages.some((stage) => stage.construction?.status === "stale") ? (
            <button type="button" className="construction-stale-notice" onClick={() => {
              setAssistantStageIndex(constructionStages.findIndex((stage) => stage.construction?.status === "stale"));
              setAssistantOpen(true);
            }}>Meet 来源失效 · {constructionStages.filter((stage) => stage.construction?.status === "stale").length} 层 · 检查施工顺序</button>
          ) : null}
          <GemViewport
            polyhedron={displaySolid}
            meetPolyhedron={constructionBaseSolid}
            previewPlanes={previewPlanes}
            selectedIndex={baseIndex}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            renderMode={renderMode}
            suspended={opticsActive || assistantOpen}
            resetSignal={resetSignal}
            highlightOperationId={hoveredPatternId}
            activeOperationId={cutSession.activePatternId}
            previewOperationId={cutMode === "create" ? `draft-${patternMode}` : null}
            pickingEnabled
            cutGizmo={cutSession.showGizmo && !constructionBlocksPreview ? cutGizmo : null}
            groupGizmo={groupGizmo}
            onFacePick={handleFacePick}
            meetTargets={cutSession.construction.tool === "pick-edge" ? meetEdges : meetTargets}
            meetPickEnabled={["pick-vertex", "pick-edge"].includes(cutSession.construction.tool) && !opticsActive && !assistantOpen}
            constructionMarkers={[
              ...(cutSession.construction.meet ? [{ point: cutSession.construction.meet.target.fallbackWorldPoint, status: cutSession.construction.meet.status, locked: true, slot: "A" }] : []),
              ...(cutSession.construction.meet?.secondTarget ? [{ point: cutSession.construction.meet.secondTarget.fallbackWorldPoint, status: cutSession.construction.meet.status, locked: true, slot: "B" }] : []),
              ...(cutSession.construction.candidate ? [{ point: cutSession.construction.candidate.target.fallbackWorldPoint, status: cutSession.construction.candidate.status, locked: false, slot: cutSession.construction.meet ? "B" : "A" }] : []),
            ]}
            nextJumpMarker={nextJumpCandidate
              ? { point: nextJumpCandidate.target?.fallbackWorldPoint, position: nextJumpCandidate.position }
              : null}
            onVertexPick={handleVertexPick}
            onDepthDrag={handleDepthDrag}
            onAngleDrag={handleAngleDrag}
            onIndexDrag={(value) => {
              if (editingOperation?.locked) return;
              changeDraftWithConstruction({ baseIndex: normalizeIndex(value) });
            }}
            onMirrorDrag={(value) => {
              if (editingOperation?.locked) return;
              changeDraftWithConstruction({ mirrorOffset: Math.min(48, Math.max(0, Math.round(value))) });
            }}
            onGroupDeltaDrag={(value) => changeGroupDelta(value.toFixed(6))}
            onGroupScaleDrag={(value) => changeGroupScale(Number(value.toFixed(6)))}
            onGroupRotationDrag={changeGroupRotation}
          />

          {opticsActive ? (
            <OpticsViewport
              polyhedron={displaySolid}
              settings={opticsSettings}
              viewMode={opticsViewMode}
              onViewModeChange={setOpticsViewMode}
              inspectorOpen={opticsInspectorOpen}
            />
          ) : null}

          {opticsActive && opticsInspectorOpen ? (
            <OpticsInspector
              settings={opticsSettings}
              tab={opticsTab}
              onTabChange={setOpticsTab}
              onChange={changeOpticsSettings}
              onClose={() => setOpticsInspectorOpen(false)}
            />
          ) : null}

          {!opticsActive && historyOpen ? (
            <aside className="floating-inspector" aria-label="历史记录检查器">
              <div className="inspector-title">
                <span><IconHistory size={17} stroke={1.7} />历史记录 HISTORY</span>
                <button type="button" onClick={() => setHistoryOpen(false)} aria-label="关闭历史记录">×</button>
              </div>
              <HistoryPanel
                entries={historyEntries}
                onInspect={inspectHistoryEntry}
                onClear={() => setModal("clear")}
                canInteract={!cutSession.active}
              />
            </aside>
          ) : null}
        </div>
      </section>

      {!opticsActive && ledgerOpen ? (
        <div className="ledger-overlay" role="presentation" onMouseDown={() => setLedgerOpen(false)}>
          <section
            className="ledger-floating-panel"
            role="dialog"
            aria-modal="true"
            aria-label="刻面表浮层"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <FacetLedger
              operations={operations}
              selectedId={editingPatternId ?? "rough-cube"}
              hoveredId={hoveredPatternId}
              onSelect={selectCut}
              onHover={setHoveredPatternId}
              onToggleVisibility={toggleVisibility}
              canSelectLayers={cutSession.canPickLayer}
              canMutateStack={cutSession.canMutateStack}
              onClose={() => setLedgerOpen(false)}
            />
          </section>
        </div>
      ) : null}

      <input ref={importRef} type="file" accept="application/json,.json" className="sr-only" onChange={importDocument} />
      <input ref={ascImportRef} type="file" accept=".asc,text/plain" className="sr-only" onChange={inspectAscFile} />
      {toast ? <div className="toast" role="status" aria-live="polite">{toast}</div> : null}

      {ascTransfer ? (
        <AscTransferDialog
          mode={ascTransfer.mode}
          fileName={ascTransfer.fileName}
          result={ascTransfer.result}
          onClose={closeAscTransfer}
          onReselect={() => ascImportRef.current?.click()}
          onConfirm={confirmAscTransfer}
        />
      ) : null}

      {presetLibraryOpen ? (
        <PresetLibraryDialog
          library={presetLibrary}
          discardingDraft={cutSession.active}
          onClose={() => setPresetLibraryOpen(false)}
          onLoad={loadPreset}
        />
      ) : null}

      {localRecovery.status.state === "error" ? (
        <div className="backup-error" role="alert">
          <div><strong>本地备份未完成</strong><p>{localRecovery.status.message}</p></div>
          <div className="backup-error-actions">
            <button type="button" onClick={localRecovery.retry}>重试备份</button>
            <button type="button" onClick={() => hasUnsavedPreview ? setModal("json-export") : exportDocument()}>导出 JSON</button>
          </div>
        </div>
      ) : null}

      {recoveryOpen ? (
        <RecoveryDialog
          records={localRecovery.records}
          unreadableCount={localRecovery.unreadableCount}
          error={localRecovery.error}
          startup={recoveryStartup}
          discardingDraft={!recoveryStartup && hasUnsavedPreview}
          onClose={() => setRecoveryOpen(false)}
          onRefresh={localRecovery.refresh}
          onRemove={localRecovery.remove}
          onRestore={(record) => {
            applyImportedDocument(ensureTableFacet(record.document), { description: `恢复本地设计 · ${record.document.name}` });
            setRecoveryOpen(false);
            setResetSignal((value) => value + 1);
            notify("已恢复文档与材质；未保存草稿、相机和旧撤销历史不包含在备份中。");
          }}
        />
      ) : null}

      {modal === "new" ? (
        <Modal title="新建设计" confirmLabel="创建新设计" onClose={() => setModal(null)} onConfirm={startNewDocument}>
          <p>当前设计会从工作区移除。新文件将从边长 2.000 的立方体开始，并恢复固定台面 T1 与默认 32 面腰部 G1。</p>
        </Modal>
      ) : null}

      {modal === "json-export" ? (
        <Modal eyebrow="JSON · EXPORT" title="导出已提交的 JSON" confirmLabel="导出已提交文档" onClose={() => setModal(null)} onConfirm={() => { setModal(null); exportDocument(); }}>
          <p>当前还有未保存的 CUT / 整体变换预览，本次导出不包含这些修改，也不会提交或取消它们。</p>
          <p>JSON 保留已提交的完整 CUT STACK（含被覆盖工序）、Meet 快照和光学材质。需要导出当前预览时，请先取消此窗口并保存切割。</p>
        </Modal>
      ) : null}

      {modal === "pdf" ? (
        <Modal eyebrow="PDF · REPORT" title="导出 PDF 技术报告" confirmLabel="生成报告" onClose={() => setModal(null)} onConfirm={exportPdfReport}>
          <p>本次报告只包含已提交文档的 {savedEffectiveFacets.effectiveFacetIds.length} 个最终有效刻面；{hasUnsavedPreview ? "当前未保存 CUT / 整体变换预览不包含在内。" : "不包含毛坯面。"}</p>
          <p>报告包含封面五视图（含台面宽 T 标注）与分区逐面参数表。腰部是辅助面，逐面表默认不导出。</p>
          <label className="modal-check">
            <input
              type="checkbox"
              checked={reportIncludeGirdle}
              onChange={(event) => setReportIncludeGirdle(event.target.checked)}
            />
            <span>包含腰部逐面参数表（{operations.filter((item) => item.region === "girdle").reduce((sum, item) => sum + item.effectiveCount, 0)} 面）</span>
          </label>
        </Modal>
      ) : null}

      {modal === "confirm-face-removal" && pendingFullRemovalCommit ? (
        <Modal
          title="确认覆盖已有切面"
          confirmLabel="确认切割并保留历史"
          destructive
          onClose={() => {
            setPendingFullRemovalCommit(null);
            setModal(null);
          }}
          onConfirm={() => {
            setModal(null);
            applyDraft(true);
          }}
        >
          <p>新切面会让以下普通图层在最终实体中完全消失。原参数化工序仍保留在 CUT STACK 和 JSON 中；撤销或移除覆盖层后可以自动恢复。</p>
          <ul>
            {pendingFullRemovalCommit.operations.map((operation) => (
              <li key={operation.operationId}>{operation.label}：覆盖 {operation.removedCount} 个有效面</li>
            ))}
          </ul>
        </Modal>
      ) : null}

      {modal === "clear" ? (
        <Modal title="清除用户切割" confirmLabel="恢复默认预形" destructive onClose={() => setModal(null)} onConfirm={() => {
          resetDocument(document.name);
          setModal(null);
          notify("已清除用户切割并恢复固定台面 T1 与默认腰部 G1。");
        }}>
          <p>这会清除 C1、P1 等用户图层及撤销历史；固定台面 T1 与默认 32 面腰部 G1 会保留。</p>
        </Modal>
      ) : null}

      {modal === "settings" ? (
        <Modal title="系统设置" onClose={() => setModal(null)}>
          <ul>
            <li>毛坯：中心立方体，边长 2.000</li>
            <li>分度轮：固定 96 齿，每齿 3.75°</li>
            <li>半空间：保留 n · p ≤ d 的凸体</li>
            <li>几何轴：+Z 指向冠部；几何 β 冠部为正、腰部为 0、亭部为负</li>
          </ul>
        </Modal>
      ) : null}

      {modal === "help" ? (
        <HelpCenterDialog onClose={() => setModal(null)} />
      ) : null}
    </main>
  );
}
