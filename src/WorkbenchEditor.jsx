import { facetMetadataAfterParameterEdit, facetSurfaceState } from './domain/facetSurface.js';
import { receiveConcaveUpdate } from './application/concaveEvaluation.js';
import { createConcavePreviewScheduler } from './components/concavePreviewScheduler.js';
import { resolveGroupReference } from './domain/groupReference.js';
import { getLocale } from './i18n/locale.js';
import { t } from './i18n/locale.js';
import { LanguageSelector } from './components/LanguageSelector.jsx';
import { APP_VERSION } from "./version.js";
import { preparePatternCommit, transformGroup, planDesign, prepareParameterGroupReplacement, exportParameterGroup, prepareConcaveTool } from './application/designOperations.js';
import { useDesignController } from './components/useDesignController.js';
import { assertFileBudget, assertDocumentImportBudget } from "./domain/importBudget.js";
import { assertValidDocumentGeometry, evaluatePlanarDocument, evaluateDocument, applyConcaveCuts } from "./domain/documentGeometry.js";
import { createStockSolid } from "./domain/stockGeometry.js";
import { IndexCompatibilityPanel } from "./components/IndexCompatibilityPanel.jsx";
import { ConcavePanel } from "./components/ConcavePanel.jsx";
import { indexExportSummary } from "./domain/indexing.js";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { IconChevronLeft, IconChevronRight, IconHistory, IconHome, IconFlask } from "@tabler/icons-react";
import { RepositoryLink } from "./components/RepositoryLink.jsx";
import { OrthographicPreviews } from "./components/OrthographicPreviews.jsx";
import { Header } from "./components/Header.jsx";
import { GemViewport } from "./components/GemViewport.jsx";
import { OpticsViewSwitch } from "./components/OpticsViewSwitch.jsx";
import { ViewportModeSwitch } from "./components/ViewportModeSwitch.jsx";
import { CuttingAssistantBar, CuttingAssistantPlayer, CuttingAssistantInspector } from "./components/CuttingAssistantBar.jsx";
import { OpticsViewport } from "./components/OpticsViewport.jsx";
import { OpticsInspector } from "./components/OpticsInspector.jsx";
import { MastControl } from "./components/MastControl.jsx";
import { CutComposer } from "./components/CutComposer.jsx";
import { CutStack } from "./components/CutStack.jsx";
import { FacetLedger } from "./components/FacetLedger.jsx";
import { HistoryPanel } from "./components/HistoryPanel.jsx";
import { AscTransferDialog } from "./components/AscTransferDialog.jsx";
import { HelpCenterDialog } from "./components/HelpCenterDialog.jsx";
import { Modal } from "./components/Modal.jsx";
import { RecoveryDialog } from "./components/RecoveryDialog.jsx";
import { useLocalRecovery } from "./components/useLocalRecovery.js";
import { downloadBlob } from "./utils/download.js";
import { safeFileStem } from "./utils/format.js";
import {
  CUT_SESSION_EVENT,
  CUT_SESSION_MODE,
  createCutSession,
  cutSessionReducer,
  resolveCutSession,
} from "./domain/cutSession.js";
import {
  FACET_REGION_LABELS,
  FACET_REGION_PREFIXES,
  canRedo,
  canUndo,
  createFacetingDocument,
  getCuttingReference,
  createCommandHistory,
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
  clipPolyhedronPreview,
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
import { createWorkbenchDocument, ensureTableFacet } from "./domain/document.js";
import { parseCustomIndices, planeEntry, resolveDraftGeometry, solveDraftConstruction, snapshotMeetTarget } from "./domain/cutConstruction.js";
import { buildConstructionStages } from "./domain/constructionHistory.js";
import { useCuttingPlayback } from "./components/useCuttingPlayback.js";
import { createCuttingReplay } from "./domain/cuttingAssistant.js";
import { ConstructionAssistantDialog } from "./components/ConstructionAssistantDialog.jsx";

function normalizeDepthValue(value) {
  return Math.max(0, Number(value) || 0);
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

export function WorkbenchEditor({ initialDocument, designControllerRef, projectId, startWithDraft = false, visible = true, interactionPaused = false, onDocumentChange, onPreviewChange, onHome, onLab, onNewProject, onOpenDocument, onImportCrystal, projectStatus }) {
  const [history, setHistory] = useState(() => createCommandHistory(initialDocument));
  const [sessionState, dispatchCutSession] = useReducer(
    cutSessionReducer,
    null,
    () => createCutSession(startWithDraft ? CUT_SESSION_MODE.CREATE : CUT_SESSION_MODE.IDLE, { region: "crown", indexTeeth: initialDocument.indexGear.teeth }),
  );
  const [viewMode, setViewMode] = useState("perspective");
  const [opticsViewMode, setOpticsViewMode] = useState("perspective");
  const [renderMode, setRenderMode] = useState("solid");
  const [viewportMode, setViewportMode] = useState("edit");
  const [cuttingMethod, setCuttingMethod] = useState("planar");
  const concaveActive = cuttingMethod === "concave" && viewportMode === "edit";
  const opticsActive = viewportMode === "optics";
  const cuttingAssistantActive = viewportMode === "assistant";
  const [assistantPosition, setAssistantPosition] = useState(0);
  const [assistantFollow, setAssistantFollow] = useState(true);
  const [assistantDuration, setAssistantDuration] = useState(600);
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
  const [toast, setToast] = useState("");
  const [reportIncludeGirdle, setReportIncludeGirdle] = useState(false);
  const [reportSurfaceFinish, setReportSurfaceFinish] = useState("polished");
  const [ascTransfer, setAscTransfer] = useState(null);
  const importRef = useRef(null);
  const ascImportRef = useRef(null);
  const toastTimerRef = useRef(null);
  const operationSequence = useRef(0);

  const document = history.present;
  const machineStock = getCuttingReference(document);
  const [concavePreview, setConcavePreview] = useState(null);
  const [concaveCommitting, setConcaveCommitting] = useState(false);
  const concaveCallbacks = useRef({});
  const concaveScheduler = useMemo(() => createConcavePreviewScheduler({
    createWorker: () => new Worker(new URL('./workers/concave.worker.js', import.meta.url), { type: 'module' }),
    onPreview: (...args) => concaveCallbacks.current.preview(...args),
    onCommit: (...args) => concaveCallbacks.current.commit(...args),
    onError: error => concaveCallbacks.current.error(error),
  }), []);
  useEffect(() => () => concaveScheduler.destroy(), [concaveScheduler]);
  useEffect(() => { if (concaveActive) concaveScheduler.warmup(); }, [concaveActive, concaveScheduler]);
  useEffect(() => { concaveScheduler.cancel(); setConcaveCommitting(false); }, [document, cuttingMethod, viewportMode, concaveScheduler]);

  const [selectedConcaveId, setSelectedConcaveId] = useState(null);
  const equipment = useMemo(() => indexExportSummary(document), [document]);
  const equipmentNotice = [
    equipment.selectedTeeth !== 96 ? t('本文件按 {0} 分度输出，不能直接按 96 分度读数加工。', [equipment.selectedTeeth]) : '',
    !equipment.compatibleWith96 ? t('本设计不兼容 96 整齿加工，请核对设备后再切磨。') : '',
  ].filter(Boolean).join(' ');
  const localRecovery = useLocalRecovery();
  const [recoveryOpen, setRecoveryOpen] = useState(false);
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
  const hasUnsavedPreview = cutSession.previewEnabled || Boolean(cutSession.group && cutSession.dirty) || Boolean(concavePreview?.base === document);
  const activeGear = document.indexGear.teeth;
  const indexTeeth = cutSession.draft.indexTeeth ?? activeGear;
  useEffect(() => {
    // Import, undo/redo and returning from an old layer all restore the idle
    // authoring wheel from the document. Active CUTs retain their own wheel.
    if (cutMode === CUT_SESSION_MODE.IDLE && indexTeeth !== activeGear) {
      dispatchCutSession({ type: CUT_SESSION_EVENT.CHANGE_INDEX_GEAR, indexTeeth: activeGear });
    }
  }, [activeGear, cutMode, indexTeeth]);
  // The mount-time document is the same snapshot App already saved as baseline;
  // re-emitting the cloned history head would schedule a write that bumps the
  // project revision without any user edit.
  const didEmitDocument = useRef(false);
  useEffect(() => {
    if (!didEmitDocument.current) { didEmitDocument.current = true; return; }
    onDocumentChange(document);
  }, [document, onDocumentChange]);
  useEffect(() => { onPreviewChange(hasUnsavedPreview); }, [hasUnsavedPreview, onPreviewChange]);
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
  useEffect(() => () => window.clearTimeout(toastTimerRef.current), []);

  const changeViewportMode = useCallback((nextMode) => {
    if (nextMode === viewportMode) return;
    if (nextMode === "optics") {
      setOpticsViewMode(viewMode);
      setOpticsInspectorOpen(true);
    }
    if (nextMode === "assistant") { setAssistantPosition(0); setAssistantFollow(true); }
    setConcavePreview(null);
    setViewportMode(nextMode);
    if (nextMode === "assistant") notify("已进入切割助手；CUT 会话已原样挂起。");
    else if (nextMode === "optics") notify("已进入纯光学仿真；CUT 会话已原样挂起。");
    else notify(viewportMode === "assistant"
      ? "已退出切割助手并恢复原编辑现场。"
      : "已退出光学仿真并恢复原编辑现场。");
  }, [notify, viewMode, viewportMode]);

  // Cutting assistant replay is derived from the committed document plus the
  // hidden-layer set; it stays read-only for the whole focused session.
  const cuttingReplay = useMemo(
    () => (cuttingAssistantActive
      ? createCuttingReplay(document, { hiddenPatternIds: [...hiddenPatternIds] })
      : null),
    [cuttingAssistantActive, document, hiddenPatternIds],
  );
  const replayPosition = cuttingReplay
    ? Math.max(0, Math.min(cuttingReplay.total, assistantPosition))
    : 0;
  const replayStep = cuttingReplay && replayPosition < cuttingReplay.total
    ? cuttingReplay.steps[replayPosition]
    : null;
  const playback = useCuttingPlayback({ active: cuttingAssistantActive && visible && !interactionPaused, position: replayPosition, total: cuttingReplay?.total ?? 0, follow: assistantFollow, duration: assistantDuration, onPositionChange: setAssistantPosition });
  const cameraStep = playback.phase === "hold" ? null : replayStep;
  const assistantView = useMemo(() => cuttingAssistantActive ? { step: cameraStep, follow: assistantFollow, duration: assistantDuration, onSettled: playback.onSettled } : null, [cuttingAssistantActive, cameraStep, assistantFollow, assistantDuration, playback.onSettled]);
  const interruptAssistantView = () => { playback.setPlaying(false); setAssistantFollow(false); };
  const assistantSolid = useMemo(
    () => (cuttingReplay ? cuttingReplay.solidAt(replayPosition) : null),
    [cuttingReplay, replayPosition],
  );
  const assistantPreviewPlanes = useMemo(
    () => (replayStep && playback.phase === "ready" ? [{ ...replayStep.plane, index: replayStep.index, primary: true }] : []),
    [replayStep, playback.phase],
  );

  const draft = useMemo(() => resolveDraftGeometry(cutSession.draft, region, machineStock), [cutSession.draft, machineStock, region]);
  const draftFacets = draft.facets;

  const stockSolid = useMemo(() => createStockSolid(document.stock), [document.stock]);
  const savedPlanarSolid = useMemo(() => evaluatePlanarDocument(document), [document.stock, document.facets]);
  const [showConcaveInPlanar, setShowConcaveInPlanar] = useState(true);

  const savedSolid = useMemo(
    () => evaluateDocument(document),
    [document.facets, document.concaveCuts, machineStock, stockSolid],
  );
  const savedEffectiveFacets = useMemo(() => summarizeEffectiveFacets(savedSolid), [savedSolid]);
  const savedFrostedFacetCount = useMemo(() => {
    const effective = new Set(savedEffectiveFacets.effectiveFacetIds);
    return document.facets.filter((facet) => effective.has(facet.id) && facetSurfaceState(facet) === "frosted").length;
  }, [document.facets, savedEffectiveFacets]);
  const savedEffectiveFacetIds = useMemo(
    () => new Set(savedEffectiveFacets.effectiveFacetIds),
    [savedEffectiveFacets],
  );
  const girdleBoundary = useMemo(() => resolveGroupReference(document), [document.facets, machineStock]);
  const groupSafeRange = useMemo(() => ({ min: -Infinity, max: Infinity }), []);
  const groupBaseHeight = groupEditRegion === "crown" ? girdleBoundary.crownHeight
    : groupEditRegion === "pavilion" ? girdleBoundary.pavilionHeight : 0;

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
      const rotation = Number(groupRotationTeeth) || 0;
      if (!Number.isFinite(factor) || factor < 0.02) {
        return { facets: document.facets, error: "高度比例不能低于 2%，请把控制面拖回腰线以上。" };
      }
      if (Math.abs(factor - 1) > 1e-9) {
        if (groupBaseHeight <= 1e-6) {
          return { facets: document.facets, error: "当前分组还没有可调整的高度，请先完成一个切割层。" };
        }
        const baseZ = groupEditRegion === "crown" ? girdleBoundary.top : girdleBoundary.bottom;
        transformed = scaleFacetsAlongZ(transformed, factor, baseZ, { stock: machineStock });
      }
      if (shift) {
        transformed = translateFacetsAlongZ(transformed, shift, { stock: machineStock });
      }
      if (rotation) {
        const rotatable = transformed.filter((facet) => facet.metadata?.operationType !== "table");
        const rotatedById = new Map(
          rotateFacetsByTeeth(rotatable, rotation, { stock: machineStock, indexTeeth: activeGear }).map((facet) => [facet.id, facet]),
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
  }, [document.facets, document.stock, machineStock, activeGear, girdleBoundary, groupBaseHeight, groupDeltaZ, groupEditRegion, groupRotationTeeth, groupSafeRange, groupScale]);

  const visibleFacets = useMemo(() => groupPreview.facets.filter((facet) => !hiddenPatternIds.has(facet.patternId)), [groupPreview.facets, hiddenPatternIds]);
  const committedResult = useMemo(() => {
    try { return { solid: !groupEditRegion && hiddenPatternIds.size === 0
      ? savedPlanarSolid
      : (groupEditRegion ? clipPolyhedronPreview : clipPolyhedronByPlanes)(stockSolid, visibleFacets.map(planeEntry)), error: "" }; }
    catch (error) { return { solid: savedPlanarSolid, error: `当前变换无法生成封闭晶体，请调整参数。${error.message}` }; }
  }, [groupEditRegion, hiddenPatternIds, savedPlanarSolid, stockSolid, visibleFacets]);
  const committedSolid = committedResult.solid;
  const constructionStages = useMemo(() => buildConstructionStages(document, { hiddenPatternIds }), [document, hiddenPatternIds]);
  const diagnosticsById = useMemo(() => Object.fromEntries(constructionStages.filter((stage) => stage.construction).map((stage) => [stage.id, stage.construction])), [constructionStages]);
  const constructionBaseSolid = editingPatternId
    ? constructionStages.find((stage) => stage.id === editingPatternId)?.beforeSolid ?? stockSolid
    : committedSolid;
  const impactBaseResult = useMemo(() => {
    if (!editingPatternId) return { solid: savedPlanarSolid, error: "" };
    try { return { solid: clipPolyhedronByPlanes(stockSolid,
      document.facets.filter(facet => facet.patternId !== editingPatternId).map(planeEntry)), error: "" }; }
    catch { return { solid: savedPlanarSolid, error: "暂时移除此层后，后续切面经过无法封闭的交点；请先调整后续图层。" }; }
  }, [document.facets, editingPatternId, savedPlanarSolid, stockSolid]);
  const impactBaseSolid = impactBaseResult.solid;
  const meetTargets = useMemo(() => enumerateTopologyVertices(constructionBaseSolid), [constructionBaseSolid]);
  const meetEdges = useMemo(() => enumerateTopologyEdges(constructionBaseSolid, { targets: meetTargets }), [constructionBaseSolid, meetTargets]);
  const reportSolid = savedSolid;
  const reportMetrics = useMemo(() => measurePolyhedron(reportSolid), [reportSolid]);

  const constructionBlocksPreview = [cutSession.construction.meet, cutSession.construction.candidate]
    .some((entry) => [MEET_STATUS.UNREACHABLE, MEET_STATUS.STALE].includes(entry?.status));
  const draftImpact = useMemo(() => {
    if (!previewEnabled || constructionBlocksPreview || draftFacets.length === 0) return null;
    return evaluateDraftImpact({
      baseSolid: impactBaseSolid,
      preview: true,
      planes: draftFacets.map(planeEntry),
    });
  }, [constructionBlocksPreview, draftFacets, impactBaseSolid, previewEnabled]);
  const previewResult = useMemo(() => {
    if (!previewEnabled || constructionBlocksPreview || draftFacets.length === 0 || (editingPatternId && hiddenPatternIds.has(editingPatternId))) return { solid: committedSolid, error: "" };
    try {
      // Mesh impact and preview use the same scale-aware solver tolerance.
      // Reuse only an identical source/plane sequence; cube keeps its old gate.
      if (!editingPatternId && committedSolid.kind === "mesh" && committedSolid === impactBaseSolid && draftImpact) {
        return { solid: draftImpact.resultSolid, error: draftImpact.error ?? "" };
      }
      if (!editingPatternId) return { solid: clipPolyhedronPreview(committedSolid, draftFacets.map(planeEntry)), error: "" };
      const editedFacets = draftFacets.map((facet) => ({ ...facet, patternId: editingPatternId }));
      const sequence = replacePatternFacets(visibleFacets, editingPatternId, editedFacets);
      return { solid: clipPolyhedronPreview(stockSolid, sequence.map(planeEntry)), error: "" };
    } catch { return { solid: committedSolid, error: "当前切面经过无法封闭的交点，请微调角度或深度。" }; }
  }, [committedSolid, constructionBlocksPreview, draftFacets, draftImpact, editingPatternId, hiddenPatternIds, impactBaseSolid, previewEnabled, stockSolid, visibleFacets]);
  const previewSolid = previewResult.solid;

  const previewWouldEraseStock = Boolean(draftImpact?.solidErased)
    || (previewEnabled && draftFacets.length > 0 && previewSolid.vertices.length === 0);
  const currentConcavePreview = concavePreview?.base === document && cutSession.canEditParameterGroups ? concavePreview : null;
  const toolDocument = currentConcavePreview?.document ?? document;
  const activeConcaveTool = toolDocument.concaveCuts?.find(cut => cut.id === selectedConcaveId) ?? toolDocument.concaveCuts?.at(-1);
  const planarDisplaySolid = concaveActive || previewWouldEraseStock ? committedSolid : previewSolid;
  const combinedResult = useMemo(() => {
    try { return { solid: planarDisplaySolid === savedPlanarSolid ? savedSolid : applyConcaveCuts(document, planarDisplaySolid), error: "" }; }
    catch (error) { return { solid: savedSolid, error: `平切与凹切组合无法保留有效实体，请调整参数。${error.message}` }; }
  }, [document, planarDisplaySolid, savedPlanarSolid, savedSolid]);
  const displaySolid = currentConcavePreview?.solid ?? (viewportMode === "edit" && !concaveActive && !showConcaveInPlanar
    ? planarDisplaySolid : combinedResult.solid);
  const metrics = useMemo(() => measurePolyhedron(displaySolid), [displaySolid]);
  const groupGizmo = useMemo(() => {
    if (!groupEditRegion) return null;
    const center = machineStock.center ?? [0, 0, 0];
    const baseZ = groupEditRegion === "crown" ? girdleBoundary.top : girdleBoundary.bottom;
    const scaleValue = Number.isFinite(Number(groupScale)) ? Number(groupScale) : 1;
    const shiftValue = Number(groupDeltaZ) || 0;
    const direction = groupEditRegion === "crown" ? 1 : -1;
    return {
      region: groupEditRegion,
      indexTeeth: activeGear,
      center: [Number(center[0]) || 0, Number(center[1]) || 0],
      baseZ,
      shiftZ: baseZ + shiftValue,
      scaleZ: baseZ + shiftValue + direction * groupBaseHeight * scaleValue,
      delta: shiftValue,
      scale: scaleValue,
      rotationTeeth: Number(groupRotationTeeth) || 0,
      baseHeight: groupBaseHeight,
      minScale: 0.02,
      radius: Math.max(Number(machineStock.size) * 0.62, 0.8),
      axisLength: Math.max(Number(machineStock.size) * 0.34, 0.45),
      minDelta: groupSafeRange.min,
      maxDelta: groupSafeRange.max,
    };
  }, [activeGear, document.stock, machineStock, girdleBoundary, groupBaseHeight, groupDeltaZ, groupEditRegion, groupRotationTeeth, groupSafeRange, groupScale]);
  const constructionMeet = cutSession.construction.meet;
  const constructionDiagnostic = constructionBlocksPreview
    ? (cutSession.construction.candidate?.message || constructionMeet?.message || "Meet 来源失效或目标不可达；请调整自由参数或解除约束。") : "";
  const draftCommitPolicy = draftImpact ? resolveDraftCommitPolicy(draftImpact, { allowNoOp: Boolean(editingPatternId) }) : "allow";
  const impactValidationMessage = previewWouldEraseStock
    ? "当前深度会移除全部材料，请减小切入深度。"
    : draftCommitPolicy === "block" && draftImpact?.noOp
      ? "当前切面尚未形成任何有效面；可继续 Jump 或选择顶点，但不能作为空切保存。"
      : draftCommitPolicy === "block"
        ? "当前参数无法生成有效实体；请检查切割参数。"
        : "";
  const impactWarningMessage = ["warn", "confirm"].includes(draftCommitPolicy)
    ? `当前切割将覆盖 ${draftImpact.removedFaceCount} 个已有有效面；覆盖工序仍保留在历史中，可撤销恢复。`
    : "";
  const validationMessage = draft.error || previewResult.error || combinedResult.error || draftImpact?.error || impactBaseResult.error || committedResult.error || constructionDiagnostic || impactValidationMessage;
  const primaryDraftFacet = useMemo(() => {
    if (!draft.facets.length) return null;
    const activeIndex = normalizeIndex(baseIndex, indexTeeth);
    return draft.facets.find((facet) => normalizeIndex(facet.index, facet.indexTeeth ?? 96) === activeIndex) ?? null;
  }, [baseIndex, indexTeeth, draft.facets, patternMode]);
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
        indexTeeth: first.indexTeeth ?? 96,
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
      .filter((id) => !["rough-cube", "rough-mesh"].includes(id))
      .map((id) => operations.find((operation) => operation.id === id)?.label?.split(/\s+/)[0] ?? id);
    return labels.length ? labels.join(" × ") : "毛坯";
  }, [operations]);

  const primaryFacetForDraft = useCallback((draftState) => {
    const resolved = resolveDraftGeometry(draftState, region, machineStock);
    if (resolved.error || resolved.facets.length === 0) return { facet: null, resolved };
    const wanted = normalizeIndex(draftState.baseIndex, draftState.indexTeeth ?? 96);
    return {
      facet: resolved.facets.find((facet) => normalizeIndex(facet.index, facet.indexTeeth ?? 96) === wanted) ?? null,
      resolved,
    };
  }, [document.stock, machineStock, region]);

  const jumpCandidates = useMemo(() => {
    if (!visible || interactionPaused || !cutSession.canUseMeetJump || cutSession.construction.meet?.secondTarget) return [];
    if (cutSession.construction.meet) {
      if ([MEET_STATUS.STALE, MEET_STATUS.UNREACHABLE].includes(cutSession.construction.meet.status)) return [];
      const source = resolvePersistedMeetTarget(cutSession.construction.meet.target, constructionBaseSolid);
      if (source.status !== MEET_STATUS.VALID) return [];
      return generateDualJumpCandidates({ baseSolid: constructionBaseSolid, targetA: source.target, baseIndex, indexTeeth, region, stock: machineStock, targets: meetTargets });
    }
    const jumpDraft = {
      indexTeeth,
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
      stock: machineStock,
      targets: meetTargets,
    });
  }, [baseIndex, indexTeeth, constructionBaseSolid, customIndices, cutSession.canUseMeetJump, cutSession.construction.meet, document.stock, machineStock, industryAngle, interactionPaused, meetTargets, mirrorOffset, patternMode, primaryFacetForDraft, region, repeatCount, visible]);

  const evaluateJumpCandidate = useCallback((candidate) => {
    const jumpDraft = { indexTeeth, industryAngle: candidate.industryAngleDeg ?? industryAngle, baseIndex, repeat: repeatCount, mirrorOffset, patternMode, customIndices, depth: 0 };
    const { facet } = primaryFacetForDraft(jumpDraft);
    return classifyJumpCandidate({
      candidate,
      preview: true,
      baseSolid: impactBaseSolid,
      normal: facet.plane.normal,
      stock: machineStock,
      planesForDepth: (depth) => resolveDraftGeometry({ ...jumpDraft, depth }, region, machineStock).facets.map(planeEntry),
    });
  }, [baseIndex, indexTeeth, impactBaseSolid, customIndices, document.stock, machineStock, industryAngle, mirrorOffset, patternMode, primaryFacetForDraft, region, repeatCount]);

  const jumpSession = resolveCutSession(sessionState, { jumpCandidates });

  const nextJumpTarget = useMemo(() => {
    const index = adjacentJumpCandidateIndex({
      candidates: jumpCandidates,
      currentDepth: Number(cutSession.draft.depth),
      currentAngle: cutSession.construction.meet ? cutSession.draft.industryAngle : undefined,
      currentKey: cutSession.construction.candidate?.key,
    });
    return jumpCandidates[index] ?? null;
  }, [cutSession.construction.candidate?.key, cutSession.construction.meet, cutSession.draft.depth, cutSession.draft.industryAngle, jumpCandidates]);

  const nextJumpCandidate = useMemo(() => {
    if (!nextJumpTarget) return null;
    const candidate = evaluateJumpCandidate(nextJumpTarget);
    return {
      ...candidate,
      position: `${jumpCandidates.indexOf(nextJumpTarget) + 1}/${jumpCandidates.length}`,
      sourceLabel: sourceLabelForTarget(candidate.target),
    };
  }, [evaluateJumpCandidate, jumpCandidates, nextJumpTarget, sourceLabelForTarget]);

  const candidateFromTarget = useCallback((target, source = "manual") => {
    const meet = cutSession.construction.meet
      ? { ...cutSession.construction.meet, secondTarget: target }
      : { target };
    const result = solveDraftConstruction({ draft: cutSession.draft, region, stock: machineStock, meet, baseSolid: constructionBaseSolid });
    const valid = result.meet.status === MEET_STATUS.VALID;
    const resolved = valid ? resolveDraftGeometry(result.draft, region, machineStock) : null;
    const impact = resolved ? evaluateDraftImpact({ baseSolid: impactBaseSolid, planes: resolved.facets.map(planeEntry) }) : null;
    return {
      source, key: target.topologyKey, target,
      depth: valid ? result.draft.depth : null,
      industryAngleDeg: cutSession.construction.meet && valid ? result.draft.industryAngle : undefined,
      requiredDepth: result.meet.requiredDepth, residual: result.meet.residual,
      status: valid ? impact.status : result.meet.status,
      message: impact?.error ?? result.meet.message, reason: impact?.reason ?? result.meet.reason,
      classification: impact?.classification ?? "contact-only", threats: impact?.threats ?? [],
      sourceLabel: sourceLabelForTarget(target),
    };
  }, [constructionBaseSolid, impactBaseSolid, cutSession.construction.meet, cutSession.draft, document.stock, machineStock, region, sourceLabelForTarget]);

  const changeDraftWithConstruction = useCallback((patch) => {
    if (Object.keys(patch).every((key) => key === "preform")) {
      dispatchCutSession({ type: CUT_SESSION_EVENT.CHANGE_DRAFT, patch });
      return;
    }
    const lockedMeet = cutSession.construction.meet;
    const nextDraft = { ...(cutSession.construction.returnDraft ?? cutSession.draft), ...patch };
    if (lockedMeet && nextDraft.patternMode === "arbitrary" && !parseCustomIndices(nextDraft.customIndices, nextDraft.indexTeeth ?? 96).indices.includes(normalizeIndex(nextDraft.baseIndex, nextDraft.indexTeeth ?? 96))) {
      notify("主切面必须保留在自定义索引集合中；请先解除 Meet 或保留该索引。");
      return;
    }
    if (!lockedMeet) {
      dispatchCutSession({ type: CUT_SESSION_EVENT.CHANGE_DRAFT, patch });
      return;
    }
    if (!cutSession.depthEditable) nextDraft.depth = (cutSession.construction.returnDraft ?? cutSession.draft).depth;
    if (!cutSession.angleEditable) nextDraft.industryAngle = (cutSession.construction.returnDraft ?? cutSession.draft).industryAngle;
    const result = solveDraftConstruction({ draft: nextDraft, region, stock: machineStock, meet: lockedMeet, baseSolid: constructionBaseSolid });
    dispatchCutSession({ type: CUT_SESSION_EVENT.CHANGE_DRAFT, patch: result.draft, constructionResult: { meet: result.meet, returnDraft: null, tool: "none" } });
  }, [constructionBaseSolid, cutSession, document.stock, machineStock, notify, region]);
  const previewPlanes = cutSession.showCutPlane
    && !constructionBlocksPreview
    && !(editingPatternId && hiddenPatternIds.has(editingPatternId))
    ? draft.facets.map((facet) => ({ ...facet.plane, index: facet.index, primary: facet === primaryDraftFacet }))
    : [];

  const draftEffectiveIds = useMemo(
    () => new Set(draftImpact?.resultSolid.faces.map((face) => face.facetId ?? face.id) ?? []),
    [draftImpact],
  );
  const activeEffectiveIndices = useMemo(() => previewEnabled
    ? draftFacets.filter((facet) => draftEffectiveIds.has(facet.id)).map((facet) => facet.index)
    : editingOperation?.effectiveIndices ?? [],
  [draftFacets, draftEffectiveIds, editingOperation?.effectiveIndices, previewEnabled]);

  const instructionGroups = useMemo(() => {
    const rows = operations.map((operation) => {
      const isActive = operation.id === editingPatternId;
      const livePreview = isActive && draftFacets.length > 0;
      return {
        id: operation.id,
        prefix: operation.label.split(/\s+/)[0],
        region: operation.region,
        indexTeeth: livePreview ? indexTeeth : operation.indexTeeth,
        angle: livePreview ? industryAngle : operation.industryAngleDeg,
        indices: livePreview ? activeEffectiveIndices : operation.effectiveIndices,
        active: isActive,
        locked: operation.locked,
        hidden: !operation.visible,
      };
    });

    if (!editingPatternId && !groupEditRegion && previewEnabled && draftFacets.length > 0) {
      const number = operations.filter((operation) => operation.region === region && !operation.locked).length + 1;
      rows.push({
        id: "draft-instruction",
        indexTeeth,
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
  }, [indexTeeth, activeEffectiveIndices, draftFacets.length, editingPatternId, groupEditRegion, industryAngle, operations, previewEnabled, region]);

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

  const applyDraft = () => {
    if (!cutSession.canCommit || validationMessage || draft.facets.length === 0) return;
    const current = operations.find((operation) => operation.id === editingPatternId);

    const baseFacets = current
      ? document.facets.filter((facet) => facet.patternId !== current.id)
      : document.facets;
    let impact;
    try {
      const baseSolid = clipPolyhedronByPlanes(stockSolid, baseFacets.map(planeEntry));
      impact = evaluateDraftImpact({ baseSolid, planes: draft.facets.map(planeEntry) });
    } catch (error) { notify(`无法保存当前切割：${error.message}`); return; }
    if (impact.error) { notify(impact.error); return; }
    const policy = resolveDraftCommitPolicy(impact, { allowNoOp: Boolean(current) });
    if (policy === "block") {
      notify(impact.solidErased
        ? "已拒绝保存：当前参数会移除全部材料，请减小切入深度。"
        : impact.noOp
          ? "已拒绝空切：当前切面没有形成任何有效面。"
          : "已拒绝保存：当前参数无法生成有效实体。");
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
    metadata.primaryIndex = normalizeIndex(baseIndex, indexTeeth);
    if (cutSession.canMarkPreform) metadata.preform = Boolean(cutSession.draft.preform);
    else delete metadata.preform;
    const lockedMeet = cutSession.construction.meet;
    if (lockedMeet && [MEET_STATUS.VALID, MEET_STATUS.DESTRUCTIVE].includes(lockedMeet.status)) {
      metadata.construction = {
        type: lockedMeet.secondTarget ? "dual-meet" : lockedMeet.target.kind === "edge-point" ? "edge-meet" : "vertex-meet",
        solverVersion: 2, primaryIndex: normalizeIndex(baseIndex, indexTeeth),
        target: snapshotMeetTarget(lockedMeet.target),
        ...(lockedMeet.secondTarget ? { secondTarget: snapshotMeetTarget(lockedMeet.secondTarget) } : {}),
      };
    } else delete metadata.construction;

    try {
      const facets = draft.facets.map((facet) => ({
          ...facet,
          id: `${patternId}:${displayIndex(facet.index, facet.indexTeeth ?? 96)}`,
          patternId,
          label,
          metadata: facetMetadataAfterParameterEdit(facet, current?.facets ?? [], metadata),
        }));
      if (document.stock.kind === "mesh") {
        const sequence = current ? replacePatternFacets(document.facets, current.id, facets) : [...document.facets, ...facets];
        clipPolyhedronByPlanes(stockSolid, sequence.map(planeEntry));
      }
      const { command } = preparePatternCommit(document, facets, current?.id ?? null);
      setHistory((currentHistory) => executeFacetingCommand(currentHistory, command));
      dispatchCutSession({ type: CUT_SESSION_EVENT.COMMIT_SUCCESS });
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
    dispatchCutSession({ type: CUT_SESSION_EVENT.START_CREATE, region, indexTeeth: activeGear });
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
    if (!visible || interactionPaused || !cutSession.canCancel || modal || ascTransfer || viewportMode !== "edit" || concaveActive || ledgerOpen || recoveryOpen || assistantOpen) return undefined;
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
  }, [visible, interactionPaused, ascTransfer, cancelCutSession, cutSession.canCancel, cutSession.canCancelConstructionTool, ledgerOpen, modal, notify, viewportMode, concaveActive, recoveryOpen, assistantOpen]);

  useEffect(() => {
    if (!visible || interactionPaused || !opticsActive || modal || ascTransfer) return undefined;
    const handleOpticsEscape = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setViewportMode("edit");
      notify("已退出光学仿真并恢复原编辑现场。");
    };
    window.addEventListener("keydown", handleOpticsEscape);
    return () => window.removeEventListener("keydown", handleOpticsEscape);
  }, [visible, interactionPaused, ascTransfer, modal, notify, opticsActive]);

  useEffect(() => {
    if (!visible || interactionPaused || !cuttingAssistantActive || modal || ascTransfer) return undefined;
    const handleAssistantEscape = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setViewportMode("edit");
      notify("已退出切割助手并恢复原编辑现场。");
    };
    window.addEventListener("keydown", handleAssistantEscape);
    return () => window.removeEventListener("keydown", handleAssistantEscape);
  }, [visible, interactionPaused, ascTransfer, modal, notify, cuttingAssistantActive]);

  const selectCut = (id) => {
    if (["rough-cube", "rough-mesh"].includes(id)) return;
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
        indexTeeth: operation.indexTeeth,
        customIndices: operation.indices.map((index) => displayIndex(index, operation.indexTeeth)).join(" "),
      },
      construction,
      lockedLayer: operation.locked,
    });
  };

  const validateMeshSequence = (facets, hidden = hiddenPatternIds, sourceDocument = document) => {
    if (sourceDocument.stock.kind !== "mesh" && !sourceDocument.concaveCuts?.some(cut => cut.enabled)) return true;
    const source = sourceDocument === document ? stockSolid : createStockSolid(sourceDocument.stock);
    try {
      clipPolyhedronByPlanes(source, facets.map(planeEntry));
      if (hidden.size) clipPolyhedronByPlanes(source, facets.filter(f => !hidden.has(f.patternId)).map(planeEntry));
      return true;
    } catch { notify("此次调整会使后续切面经过无法封闭的交点；请先微调关联层的角度或深度。"); return false; }
  };

  const removeCut = (id) => {
    if (!cutSession.canMutateStack) return;
    const operation = operations.find((item) => item.id === id);
    if (!operation) return;
    if (operation.locked) {
      notify("台面是固定结构层，只能调整深度，不能删除。");
      return;
    }
    if (!validateMeshSequence(document.facets.filter(f => f.patternId !== id))) return;
    let nextDocument;
    try { nextDocument = planDesign(document, [{ kind: 'remove', patternId: id }]).document; }
    catch (error) { notify(error.message); return; }
    const command = createReplaceDocumentCommand(nextDocument, { description: `删除 ${operation.label}` });
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
    if (!validateMeshSequence(facets)) return;
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
    dispatchCutSession({ type: CUT_SESSION_EVENT.CHANGE_REGION, region: nextRegion, indexTeeth: activeGear });
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
    const normalized = normalizeIndex(Number(value) || 0, activeGear);
    const teeth = normalized > activeGear / 2 ? normalized - activeGear : normalized;
    dispatchCutSession({ type: CUT_SESSION_EVENT.CHANGE_GROUP, patch: { rotationTeeth: teeth } });
  };

  const applyGroupEdit = () => {
    const shift = Number(groupDeltaZ);
    const scale = Number(groupScale);
    const rotation = Number(groupRotationTeeth) || 0;
    if (!groupEditRegion || !cutSession.canCommit || groupPreview.error || committedResult.error || combinedResult.error) return;

    let nextDocument;
    try { nextDocument = transformGroup(document, groupEditRegion, { deltaZ: shift, scale, rotationTeeth: rotation, indexTeeth: activeGear }); }
    catch (error) { notify(error.message); return; }
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
      status: raw.status ?? (raw.classification === "destructive" ? MEET_STATUS.DESTRUCTIVE : MEET_STATUS.VALID),
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
    const result = remaining ? solveDraftConstruction({ draft: draftState, region, stock: machineStock, meet: { target: remaining }, baseSolid: constructionBaseSolid }) : null;
    dispatchCutSession({ type: CUT_SESSION_EVENT.CLEAR_MEET, slot, ...(result ? { meet: { ...result.meet, sourceLabel: sourceLabelForTarget(remaining) }, patch: result.draft } : {}) });
  };
  useEffect(() => {
    if (!visible || interactionPaused || !cutSession.canUseMeetJump || modal || ascTransfer || viewportMode !== "edit" || concaveActive || ledgerOpen || recoveryOpen || assistantOpen) return undefined;
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
  }, [visible, interactionPaused, ascTransfer, cutSession, handleJump, ledgerOpen, lockMeet, modal, viewportMode, concaveActive, recoveryOpen, assistantOpen, startMeetPick]);

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
    const primaryIndex = normalizeIndex(primaryDraftFacet.index, indexTeeth);
    const radial = facetNormal(primaryIndex, 0, indexTeeth);
    const indexRadius = machineStock.size * 1.08;
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
        indexTeeth,
        center: [0, 0, 0],
        outerRadius: indexRadius,
        innerRadius: machineStock.size * 0.82,
        baseIndex,
        repeat: repeatCount,
        mirror: mirrorOffset,
        locked: Boolean(editingOperation?.locked),
      } : null,
    };
  }, [indexTeeth, baseIndex, cutSession.angleEditable, cutSession.depthEditable, depth, machineStock.size, editingOperation?.locked, industryAngle, mirrorOffset, patternMode, primaryDraftFacet, region, repeatCount]);

  const depthControlMax = Math.max(machineStock.size * 1.5, depth * 1.25, 1);

  const replaceParameterGroup = (parameterGroup) => {
    if (!cutSession.canEditParameterGroups) return false;
    try {
      const { command } = prepareParameterGroupReplacement(document, parameterGroup);
      setHistory(current => executeFacetingCommand(current, command));
      setHiddenPatternIds(new Set());
      notify(parameterGroup.group === "concave" ? "凹切已更新，可撤销。" : "参数组已应用；可使用撤销恢复。");
      return true;
    } catch (error) { notify(error.message); return false; }
  };

  const acceptConcaveResult = (base, result, commit) => {
    if (base !== document || !concaveActive || !cutSession.canEditParameterGroups || interactionPaused) return;
    const prepared = receiveConcaveUpdate(base, result);
    if (commit) {
      setConcaveCommitting(false);
      setConcavePreview(null);
      setHistory(current => current.present === base ? executeFacetingCommand(current, prepared.command) : current);
    } else setConcavePreview({ base, ...prepared });
  };
  concaveCallbacks.current = {
    preview: (base, result) => acceptConcaveResult(base, result, false),
    commit: (base, result) => acceptConcaveResult(base, result, true),
    error: message => { setConcaveCommitting(false); setConcavePreview(null); notify(message); },
  };
  const changeConcaveTool = (operation, preview = false) => {
    if (!cutSession.canEditParameterGroups || interactionPaused) return false;
    try {
      if (preview) { concaveScheduler.preview(document, operation); return true; }
      if ([operation.toolDepth, operation.phaseDeg, operation.width, operation.tipAngle, operation.length].some(value => value !== undefined)) { setConcaveCommitting(true); concaveScheduler.finish(document, operation); return true; }
      concaveScheduler.cancel();
      const prepared = prepareConcaveTool(document, operation);
      setConcavePreview(null);
      setHistory(current => executeFacetingCommand(current, prepared.command));
      return true;
    } catch (error) { setConcavePreview(null); notify(error.message); return false; }
  };

  const changeIndexGear = teeth => {
    if (!cutSession.canEditParameterGroups) return;
    const next = createFacetingDocument({ ...document, indexGear: { teeth } });
    setHistory(current => executeFacetingCommand(current, createReplaceDocumentCommand(next, { description: `设计分度盘 · ${teeth} 齿` })));
    dispatchCutSession({ type: CUT_SESSION_EVENT.CHANGE_INDEX_GEAR, indexTeeth: teeth });
    notify("分度盘已切换；已有切面方向保持不变。");
  };

  const resetDocument = name => {
    const facets = document.stock.kind === "mesh" ? [] : createWorkbenchDocument(name, activeGear).facets;
    replaceParameterGroup({ kind: 'facet-parameter-group', schemaVersion: 1, group: 'planar', facets });
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
    downloadBlob(blob, `${safeFileStem(document.name)}.json`);
    notify(equipmentNotice || `已导出 ${document.facets.length} 个面的完整 JSON 参数。`);
  };

  const exportPdfReport = async () => {
    setModal(null);
    notify("正在生成切磨数据报告…");
    try {
      // pdf-lib and the embedded fonts load only when a report is requested.
      const { downloadFacetReport } = await import("./report/pdfReport.js");
      await downloadFacetReport({ locale: getLocale(),
        document,
        solid: reportSolid,
        metrics: reportMetrics,
        includeGirdle: reportIncludeGirdle,
        surfaceFinish: savedFrostedFacetCount ? reportSurfaceFinish : "polished",
        hiddenPatternIds: [...hiddenPatternIds],
      });
      const summary = t(reportIncludeGirdle
        ? `PDF 报告已生成：${savedEffectiveFacets.effectiveFacetIds.length} 个最终有效面，含腰部逐面表。`
        : `PDF 报告已生成：腰部逐面表按默认规则省略，几何视图中仍可见。`);
      notify(savedFrostedFacetCount && reportSurfaceFinish === "annotated"
        ? `${summary}${t("已标注 {0} 个磨砂面。", [savedFrostedFacetCount])}` : summary);
    } catch (error) {
      notify(`PDF 导出失败：${error.message}`);
    }
  };

  const applyImportedDocument = (imported) => {
    try {
      assertValidDocumentGeometry(imported);
    } catch (error) {
      notify(`导入失败：${error.message}`);
      return false;
    }
    setConcavePreview(null);
    onOpenDocument(imported);
    return true;
  };

  const importDocument = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    let imported;
    try {
      assertFileBudget(file);
      const text = await file.text();
      assertDocumentImportBudget(JSON.parse(text));
      imported = ensureTableFacet(importFacetingJSON(text));
      assertValidDocumentGeometry(imported);
    } catch (error) {
      const detail = error.errors?.[0];
      notify(detail ? `导入失败：${detail.path} ${detail.message}` : `导入失败：${error.message}`);
      return;
    }
    // App creates a separate project and owns the pending-preview switch guard.
    if (!applyImportedDocument(imported)) return;
    notify(indexExportSummary(imported).notice || `已导入“${imported.name}”，共 ${imported.facets.length} 个面。`);
  };

  const inspectAscFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      assertFileBudget(file);
      const result = inspectGemCadAsc(await file.text(), { fileName: file.name });
      if (result.document) assertDocumentImportBudget(result.document);
      setAscTransfer({ mode: "import", fileName: file.name, result });
    } catch (error) { notify(`ASC 导入失败：${error.message}`); }
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
      if (!applyImportedDocument(imported, {
        description: `导入 GemCad ASC · ${ascTransfer.fileName}`,
      })) return;
      setAscTransfer(null);
      notify(`已导入“${imported.name}”：${ascTransfer.result.summary.tierCount} 层 / ${imported.facets.length} 面；已创建独立项目，原项目保留。`);
      return;
    }

    const blob = new Blob([ascTransfer.result.text], { type: "text/plain;charset=utf-8" });
    downloadBlob(blob, ascTransfer.fileName);
    setAscTransfer(null);
    notify(`已导出 ${ascTransfer.result.summary.tierCount} 个 ASC tier；JSON 完整主文件未受影响。`);
  };

  const toggleVisibility = (id) => {
    if (!cutSession.canMutateStack) return;
    if (["rough-cube", "rough-mesh"].includes(id)) return;
    const operation = operations.find((item) => item.id === id);
    if (operation?.locked) {
      notify("台面是固定结构层，始终参与布尔序列。");
      return;
    }
    const next = new Set(hiddenPatternIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    if (!validateMeshSequence(document.facets, next)) return;
    setHiddenPatternIds(next);
  };

  const inspectHistoryEntry = (commandId) => {
    if (!cutSession.canEditParameterGroups) return;
    const target = history.commands.findIndex(command => command.id === commandId) + 1;
    if (target < 1) return;
    let next = history;
    while (next.cursor > target) next = undoFacetingCommand(next);
    while (next.cursor < target) next = redoFacetingCommand(next);
    if (!validateMeshSequence(next.present.facets, new Set(), next.present)) return;
    setHistory(next);
    setHiddenPatternIds(new Set());
    notify("已回到所选步骤；可重做后续操作。");
  };

  useDesignController({
    controllerRef: designControllerRef, projectId, document, history, setHistory,
    sessionState, dispatchCutSession, hiddenPatternIds, setHiddenPatternIds,
    blocked: !visible ? '请返回切型编辑页面。' : interactionPaused || modal || ledgerOpen || ascTransfer || recoveryOpen || assistantOpen ? '请先结束当前弹窗操作。' : viewportMode !== 'edit' ? '请先退出光学或切割助手。' : currentConcavePreview ? '请先完成凹切深度调整。' : '',
    projectStatus, notify,
  });

  const compatibilityFacets = useMemo(() => {
    if (groupEditRegion) return groupPreview.facets;
    if (!previewEnabled) return document.facets;
    return editingPatternId ? replacePatternFacets(document.facets, editingPatternId, draftFacets) : [...document.facets, ...draftFacets];
  }, [document.facets, draftFacets, editingPatternId, groupEditRegion, groupPreview.facets, previewEnabled]);
  const visibleEffectiveCount = useMemo(() => summarizeEffectiveFacets(displaySolid).effectiveFacetIds.length, [displaySolid]);
  const composerStatus = t("有效刻面 {0} · {1} {2} · 体积 {3}", [visibleEffectiveCount, t(document.stock.kind === "mesh" ? "原石面片" : "毛坯面"), displaySolid.faces.filter(face => face.region === "rough").length, metrics.volume.toFixed(3)]);
  const composerValidationMessage = groupEditRegion
    ? `正在整体变换${groupEditRegion === "crown" ? "冠部与台面" : "亭部"}；请先应用或取消。`
    : cutSession.active ? validationMessage : "";

  return (
    <main className={`app-shell workspace-editor${opticsActive ? " is-optics-active" : ""}`} hidden={!visible} aria-hidden={!visible} inert={!visible || interactionPaused}>
      <div className="workbench-topbar">
        <button className="workbench-brand" onClick={onHome} aria-label={t("切磨工作台 · 返回项目主页")}>
          <img src={`${import.meta.env.BASE_URL}brand/logo-header.webp`} alt="" />
          <span><strong>{t("切磨工作台")} <em>{APP_VERSION}</em></strong><small>SUVA · FACET 96</small></span>
        </button>
        <div className="workbench-links">
          <nav className="workbench-navigation" aria-label={t("工作台页面")}>
            <button onClick={onHome}><IconHome size={15} stroke={1.6} /><span>{t("项目主页")}</span></button>
            <button onClick={onLab}><IconFlask size={15} stroke={1.6} /><span>{t("实验室")}</span></button>
          </nav>
          <LanguageSelector /><RepositoryLink />
        </div>
          {cuttingAssistantActive && cuttingReplay ? (
            <CuttingAssistantBar name={document.name} onExit={() => changeViewportMode("edit")} />
          ) : (
          <Header
            projectName={document.name}
            onProjectNameChange={renameProject}
            facetCount={operations.reduce((sum, item) => sum + item.effectiveCount, 0)}
            onNew={onNewProject}
            onImport={() => importRef.current?.click()}
            onImportCrystal={onImportCrystal}
            onImportAsc={() => ascImportRef.current?.click()}
            onExport={() => hasUnsavedPreview || equipment.notice ? setModal("json-export") : exportDocument()}
            hasPhysicalStock={document.stock.kind === "mesh"}
            onExportGroup={group => downloadBlob(new Blob([JSON.stringify(exportParameterGroup(document, group), null, 2)], { type: 'application/json' }), `${safeFileStem(document.name)}-${group}.json`)}
            backupStatus={projectStatus}
            onOpenRecovery={() => {
              localRecovery.refresh();
              setRecoveryOpen(true);
            }}
            onExportAsc={openAscExport}
            onExportPdf={() => setModal("pdf")}
            onUndo={() => {
              const next = undoFacetingCommand(history);
              if (validateMeshSequence(next.present.facets, hiddenPatternIds, next.present)) setHistory(next);
            }}
            onRedo={() => {
              const next = redoFacetingCommand(history);
              if (validateMeshSequence(next.present.facets, hiddenPatternIds, next.present)) setHistory(next);
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
            onEnterOptics={() => changeViewportMode("optics")}
            onOpenOpticsInspector={() => setOpticsInspectorOpen(true)}
            onExitOptics={() => changeViewportMode("edit")}
          />
          )}
      </div>
      <section className={`${sidebarOpen ? "editor-workspace" : "editor-workspace is-sidebar-collapsed"}${opticsActive ? " is-optics-focus" : ""}${cuttingAssistantActive ? " is-assistant-focus" : ""}${concaveActive ? " is-concave-focus" : ""}`}>
        {viewportMode === "edit" && !concaveActive ? <aside className="control-sidebar" aria-label={t("切磨参数侧栏")} aria-hidden={!sidebarOpen} inert={!sidebarOpen}>
          <div className="parameter-rail-title">
            <span>CUT PARAMETERS</span>
            <button type="button" className="collapse-sidebar" onClick={() => setSidebarOpen(false)} aria-label={t("收起参数侧栏")}><IconChevronLeft size={16} stroke={1.7} /></button>
          </div>

          <div className="sidebar-sections">
            <IndexCompatibilityPanel document={document} facets={compatibilityFacets} error={draft.error || previewResult.error} canChangeGear={cutSession.canEditParameterGroups} onGearChange={changeIndexGear} />
            <details className="control-section" open>
              <summary><span>{t("切割参数 CUT")}</span><small>{t(FACET_REGION_LABELS[region])}</small></summary>
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
                indexTeeth={indexTeeth}
                patternMode={patternMode}
                onPatternModeChange={(value) => {
                  changeDraftWithConstruction({ patternMode: value });
                }}
                baseIndex={baseIndex}
                onBaseIndexChange={(value) => {
                  changeDraftWithConstruction({ baseIndex: normalizeIndex(value, indexTeeth) });
                }}
                repeatCount={repeatCount}
                onRepeatChange={(value) => {
                  changeDraftWithConstruction({ repeat: value });
                }}
                mirrorOffset={mirrorOffset}
                onMirrorChange={(value) => {
                  changeDraftWithConstruction({ mirrorOffset: Math.min(indexTeeth / 2, Math.max(0, value)) });
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
                primaryIndices={parseCustomIndices(customIndices, indexTeeth).indices}
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
          {viewportMode === "edit" && !concaveActive && !sidebarOpen ? (
            <button type="button" className="sidebar-reopen" onClick={() => setSidebarOpen(true)} aria-label={t("展开参数侧栏")}>
              <IconChevronRight size={18} stroke={1.8} />
            </button>
          ) : null}



          {assistantOpen ? <ConstructionAssistantDialog
            stages={constructionStages.map((stage) => ({ ...stage, label: operations.find((operation) => operation.id === stage.id)?.label ?? stage.id }))}
            currentStageIndex={Math.min(assistantStageIndex, Math.max(0, constructionStages.length - 1))}
            onStageChange={setAssistantStageIndex}
            phase={assistantPhase}
            onPhaseChange={setAssistantPhase}
            onClose={() => setAssistantOpen(false)}
            renderStage={(stage, phase) => <GemViewport polyhedron={phase === "before" ? stage.beforeSolid : stage.afterSolid} viewMode="perspective" renderMode="solid" pickingEnabled={false} />}
          /> : null}


          {!cutSession.active && viewportMode === "edit" && constructionStages.some((stage) => stage.construction?.status === "stale") ? (
            <button type="button" className="construction-stale-notice" onClick={() => {
              setAssistantStageIndex(constructionStages.findIndex((stage) => stage.construction?.status === "stale"));
              setAssistantOpen(true);
            }}>{t("Meet 来源失效 ·")} {t(constructionStages.filter((stage) => stage.construction?.status === "stale").length)} {t("层 · 检查施工顺序")}</button>
          ) : null}
          <GemViewport
            indexTeeth={cuttingAssistantActive ? (replayStep?.indexTeeth ?? activeGear) : indexTeeth}
            polyhedron={cuttingAssistantActive && assistantSolid ? assistantSolid : displaySolid}
            concaveTool={concaveActive && cutSession.canEditParameterGroups && activeConcaveTool?.enabled ? activeConcaveTool : null}
            concaveCenter={machineStock.center}
            meetPolyhedron={cuttingAssistantActive ? null : constructionBaseSolid}
            previewPlanes={cuttingAssistantActive ? assistantPreviewPlanes : concaveActive ? [] : previewPlanes}
            assistantView={assistantView}
            onCameraInteraction={cuttingAssistantActive ? interruptAssistantView : undefined}
            selectedIndex={cuttingAssistantActive ? (replayStep?.index ?? 0) : baseIndex}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            renderMode={renderMode}
            suspended={!visible || interactionPaused || opticsActive || assistantOpen}
            resetSignal={resetSignal}
            highlightOperationId={cuttingAssistantActive || concaveActive ? null : hoveredPatternId}
            activeOperationId={cuttingAssistantActive || concaveActive ? null : cutSession.activePatternId}
            previewOperationId={cuttingAssistantActive || concaveActive ? null : (cutMode === "create" ? `draft-${patternMode}` : null)}
            pickingEnabled={!cuttingAssistantActive && !concaveActive}
            cutGizmo={!cuttingAssistantActive && !concaveActive && cutSession.showGizmo && !constructionBlocksPreview ? cutGizmo : null}
            groupGizmo={cuttingAssistantActive || concaveActive ? null : groupGizmo}
            onFacePick={handleFacePick}
            meetTargets={cuttingAssistantActive || concaveActive ? [] : (cutSession.construction.tool === "pick-edge" ? meetEdges : meetTargets)}
            meetPickEnabled={["pick-vertex", "pick-edge"].includes(cutSession.construction.tool) && visible && !cuttingAssistantActive && !concaveActive && !opticsActive && !assistantOpen}
            constructionMarkers={cuttingAssistantActive || concaveActive ? [] : [
              ...(cutSession.construction.meet ? [{ point: cutSession.construction.meet.target.fallbackWorldPoint, status: cutSession.construction.meet.status, locked: true, slot: "A" }] : []),
              ...(cutSession.construction.meet?.secondTarget ? [{ point: cutSession.construction.meet.secondTarget.fallbackWorldPoint, status: cutSession.construction.meet.status, locked: true, slot: "B" }] : []),
              ...(cutSession.construction.candidate ? [{ point: cutSession.construction.candidate.target.fallbackWorldPoint, status: cutSession.construction.candidate.status, locked: false, slot: cutSession.construction.meet ? "B" : "A" }] : []),
            ]}
            nextJumpMarker={!cuttingAssistantActive && !concaveActive && nextJumpCandidate
              ? { point: nextJumpCandidate.target?.fallbackWorldPoint, position: nextJumpCandidate.position }
              : null}
            onVertexPick={handleVertexPick}
            onDepthDrag={handleDepthDrag}
            onAngleDrag={handleAngleDrag}
            onIndexDrag={(value) => {
              if (editingOperation?.locked) return;
              changeDraftWithConstruction({ baseIndex: normalizeIndex(value, indexTeeth) });
            }}
            onMirrorDrag={(value) => {
              if (editingOperation?.locked) return;
              changeDraftWithConstruction({ mirrorOffset: Math.min(indexTeeth / 2, Math.max(0, value)) });
            }}
            onGroupDeltaDrag={(value) => changeGroupDelta(value.toFixed(6))}
            onGroupScaleDrag={(value) => changeGroupScale(Number(value.toFixed(6)))}
            onGroupRotationDrag={changeGroupRotation}
          />

          {opticsActive ? (
            <OpticsViewport
                  facets={document.facets}
              polyhedron={displaySolid}
              settings={opticsSettings}
              viewMode={opticsViewMode}
              onViewModeChange={setOpticsViewMode}
              inspectorOpen={opticsInspectorOpen}
            />
          ) : null}

          {opticsActive ? (
            <OpticsViewSwitch viewMode={opticsViewMode} onViewMode={setOpticsViewMode} inspectorOpen={opticsInspectorOpen} />
          ) : null}

          <ViewportModeSwitch mode={viewportMode} onModeChange={changeViewportMode} />

          {cuttingAssistantActive && cuttingReplay ? (
            <>
            <CuttingAssistantInspector replay={cuttingReplay} position={replayPosition} solid={assistantSolid} follow={assistantFollow} onFollow={setAssistantFollow} duration={assistantDuration} onDuration={setAssistantDuration} />
            <CuttingAssistantPlayer
              replay={cuttingReplay}
              position={replayPosition}
              onPositionChange={setAssistantPosition}
              phase={playback.phase} playing={playback.playing} onPlaying={playback.setPlaying} speed={playback.speed} onSpeed={playback.setSpeed}
            />
            </>
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

          {viewportMode === "edit" && historyOpen ? (
            <aside className="floating-inspector" aria-label={t("历史记录检查器")}>
              <div className="inspector-title">
                <span><IconHistory size={17} stroke={1.7} />{t("历史记录 HISTORY")}</span>
                <button type="button" onClick={() => setHistoryOpen(false)} aria-label={t("关闭历史记录")}>×</button>
              </div>
              <HistoryPanel
                stockKind={document.stock.kind}
                entries={historyEntries}
                onInspect={inspectHistoryEntry}
                onClear={() => setModal("clear")}
                canInteract={!cutSession.active}
              />
            </aside>
          ) : null}
        </div>
        {viewportMode === "edit" ? <aside className="workbench-right-sidebar" aria-label={t("切割序列与正交预览")}>
          <div className="cutting-mode-controls">
          <div className="cutting-method-switch" role="group" aria-label={t("切割方式")}>
            {[["planar", "平切"], ["concave", "凹切"]].map(([method, label]) => <button key={method} type="button" aria-pressed={cuttingMethod === method} onClick={() => { setConcavePreview(null); setCuttingMethod(method); }}>{t(label)}</button>)}
          </div>
          {!concaveActive && document.concaveCuts?.some(cut => cut.enabled) && <button type="button" className="concave-visibility-toggle" aria-pressed={showConcaveInPlanar} onClick={() => setShowConcaveInPlanar(value => !value)}>
            {t(showConcaveInPlanar ? "凹切已显示 · 点击隐藏" : "凹切已隐藏 · 点击显示")}<small>{t("仅影响平切视图")}</small>
          </button>}
          </div>
          {concaveActive ? <ConcavePanel
            document={document} selectedId={selectedConcaveId} onSelect={setSelectedConcaveId} isCommitting={concaveCommitting}
            canEdit={cutSession.canEditParameterGroups && !interactionPaused && !modal && hiddenPatternIds.size === 0 && !concaveCommitting}
            blockedReason={!cutSession.canEditParameterGroups ? "平切草稿已保留。保存或取消平切后，可修改凹切。" : hiddenPatternIds.size ? "请先显示全部平切图层，再修改凹切。" : "请先结束当前弹窗操作。"}
            onReturnPlanar={!cutSession.canEditParameterGroups ? () => setCuttingMethod("planar") : null}
            onChange={changeConcaveTool} onReplace={replaceParameterGroup} onCancel={() => { concaveScheduler.cancel(); setConcaveCommitting(false); setConcavePreview(null); }}
          /> : <CutStack
            indexTeeth={activeGear}
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
            groupError={groupPreview.error || committedResult.error || combinedResult.error}
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
            collapsed={!cutStackOpen}
            onToggle={() => setCutStackOpen((value) => !value)}
          />}
          <OrthographicPreviews solid={displaySolid} activeOperationId={concaveActive ? null : cutSession.activePatternId} previewOperationId={!concaveActive && cutMode === "create" ? `draft-${patternMode}` : null} highlightOperationId={concaveActive ? null : hoveredPatternId} />
        </aside> : null}
      </section>

      {viewportMode === "edit" && ledgerOpen ? (
        <div className="ledger-overlay" role="presentation" onMouseDown={() => setLedgerOpen(false)}>
          <section
            className="ledger-floating-panel"
            role="dialog"
            aria-modal="true"
            aria-label={t("刻面表浮层")}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <FacetLedger
              operations={operations}
              stockKind={document.stock.kind}
              selectedId={editingPatternId ?? (document.stock.kind === "mesh" ? "rough-mesh" : "rough-cube")}
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
      {toast ? <div className="toast" role="status" aria-live="polite">{t(toast)}</div> : null}

      {ascTransfer ? (
        <AscTransferDialog
          mode={ascTransfer.mode}
          fileName={ascTransfer.fileName}
          discardingDraft={hasUnsavedPreview}
          result={ascTransfer.result}
          onClose={closeAscTransfer}
          onReselect={() => ascImportRef.current?.click()}
          onConfirm={confirmAscTransfer}
        />
      ) : null}

      {recoveryOpen ? (
        <RecoveryDialog
          records={localRecovery.records}
          unreadableCount={localRecovery.unreadableCount}
          error={localRecovery.error}
          discardingDraft={hasUnsavedPreview}
          onClose={() => setRecoveryOpen(false)}
          onRefresh={localRecovery.refresh}
          onRemove={localRecovery.remove}
          onRestore={(record) => {
            if (!applyImportedDocument(ensureTableFacet(record.document), { description: `恢复本地设计 · ${record.document.name}` })) return;
            setRecoveryOpen(false);
            setResetSignal((value) => value + 1);
            notify("已恢复文档与材质；未保存草稿、相机和旧撤销历史不包含在备份中。");
          }}
        />
      ) : null}

      {modal === "json-export" ? (
        <Modal eyebrow="JSON · EXPORT" title={t("导出已提交的 JSON")} confirmLabel={t("导出已提交文档")} onClose={() => setModal(null)} onConfirm={() => { setModal(null); exportDocument(); }}>
          <p>{t("分度盘")}：{equipment.selectedTeeth} · {t("兼容分度盘")}：{equipment.supportedTeeth.join(" / ") || t("无")}</p>
          {equipment.notice && <p className="export-equipment-notice">{equipmentNotice}</p>}
          {hasUnsavedPreview && <p>{t("当前还有未保存的预览，本次导出只包含已保存的参数。")}</p>}
          <p>{t("JSON 保留已提交的完整 CUT STACK（含被覆盖工序）、Meet 快照和光学材质。需要导出当前预览时，请先取消此窗口并保存切割。")}</p>
        </Modal>
      ) : null}

      {modal === "pdf" ? (
        <Modal eyebrow="PDF · REPORT" title={t("导出 PDF 技术报告")} confirmLabel={t("生成报告")} onClose={() => setModal(null)} onConfirm={exportPdfReport}>
          <p>{t("分度盘")}：{equipment.selectedTeeth} · {t("兼容分度盘")}：{equipment.supportedTeeth.join(" / ") || t("无")}</p>
          {equipment.notice && <p className="export-equipment-notice">{equipmentNotice}</p>}
          <p>{t("本次报告只包含已提交文档的")} {savedEffectiveFacets.effectiveFacetIds.length} {t("个最终有效刻面；")}{hasUnsavedPreview ? t("当前未保存 CUT / 整体变换预览不包含在内。") : t("不包含毛坯面。")}</p>
          <p>{t("报告包含封面五视图（含台面宽 T 标注）与分区逐面参数表。腰部是辅助面，逐面表默认不导出。")}</p>
          <label className="modal-check">
            <input
              type="checkbox"
              checked={reportIncludeGirdle}
              onChange={(event) => setReportIncludeGirdle(event.target.checked)}
            />
            <span>{t("包含腰部逐面参数表（")}{t(operations.filter((item) => item.region === "girdle").reduce((sum, item) => sum + item.effectiveCount, 0))} {t("面）")}</span>
          </label>
          {savedFrostedFacetCount > 0 && (
            <fieldset className="modal-choice">
              <legend>{t("表面处理")}</legend>
              <p>{t("设计中有 {0} 个最终有效面标注为磨砂。", [savedFrostedFacetCount])}</p>
              {[
                ["polished", "按全抛光导出（默认）", "逐面表不区分表面，适合常规全抛光加工。"],
                ["annotated", "标注磨砂面", "视图以灰色标出磨砂面，逐面表增加“表面”列并注明粗糙度。"],
              ].map(([value, label, hint]) => (
                <label key={value} className="modal-check">
                  <input type="radio" name="report-surface-finish" value={value} checked={reportSurfaceFinish === value} onChange={() => setReportSurfaceFinish(value)} />
                  <span><strong>{t(label)}</strong><small>{t(hint)}</small></span>
                </label>
              ))}
            </fieldset>
          )}
        </Modal>
      ) : null}

      {modal === "clear" ? (
        <Modal title={t("清除用户切割")} confirmLabel={document.stock.kind === "mesh" ? "恢复初始晶体" : "恢复默认预形"} destructive onClose={() => setModal(null)} onConfirm={() => {
          resetDocument(document.name);
          setModal(null);
          notify(document.stock.kind === "mesh" ? "已清除平切，原始晶体与凹切参数保留，可撤销。" : "已恢复默认平切预形，底胚与凹切参数保持原值，可撤销。");
        }}>
          <p>{document.stock.kind === "mesh" ? t("清除全部平切层，保留原始晶体与凹切参数；此操作可撤销。") : t("将平切参数恢复为固定台面 T1 与当前设备盘对应的默认腰部 G1；底胚、凹切与撤销历史保留。")}</p>
        </Modal>
      ) : null}

      {modal === "settings" ? (
        <Modal title={t("系统设置")} onClose={() => setModal(null)}>
          <ul>
            <li>{document.stock.kind === "mesh" ? t("初始晶体：导入多面体，最长边归一为 2.000，中心位于机台原点") : t("毛坯：中心立方体，边长 2.000")}</li>
            <li>{t("设计分度盘：{0} 齿，每齿 {1}°；96 作为兼容基准。", [activeGear, (360 / activeGear).toFixed(6)])}</li>
            <li>{t("切割保留平面内侧的材料，凹部与孔洞保持真实形状")}</li>
            <li>{t("几何轴：+Z 指向冠部；几何 β 冠部为正、腰部为 0、亭部为负")}</li>
          </ul>
        </Modal>
      ) : null}

      {modal === "help" ? (
        <HelpCenterDialog onClose={() => setModal(null)} />
      ) : null}
    </main>
  );
}
