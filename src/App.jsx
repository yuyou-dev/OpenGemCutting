import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { IconChevronLeft, IconChevronRight, IconHistory } from "@tabler/icons-react";
import { Header } from "./components/Header.jsx";
import { GemViewport } from "./components/GemViewport.jsx";
import { MastControl } from "./components/MastControl.jsx";
import { CutComposer } from "./components/CutComposer.jsx";
import { CutStack } from "./components/CutStack.jsx";
import { FacetLedger } from "./components/FacetLedger.jsx";
import { HistoryPanel } from "./components/HistoryPanel.jsx";
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
  createFacetingDocument,
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
  resolveFacet,
  resolveFacetPattern,
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
  depthForEdge,
  depthForVertex,
} from "./domain/meet.js";
import { downloadFacetReport } from "./report/pdfReport.js";

const REGION_LABELS = FACET_REGION_LABELS;
const REGION_PREFIX = FACET_REGION_PREFIXES;

const DEFAULT_ANGLES = {
  crown: 32,
  girdle: 90,
  pavilion: 41,
};

const DEFAULT_DEPTHS = {
  crown: 0.42,
  girdle: 0.2,
  pavilion: 0.42,
};

function normalizeDepthValue(value) {
  return Math.max(0, Number(value) || 0);
}

const TABLE_PATTERN_ID = "table-facet";

function tableFacets(stock) {
  return resolveFacetPattern({
    patternId: TABLE_PATTERN_ID,
    label: "T1 台面",
    region: "crown",
    baseIndex: 0,
    repeat: 1,
    mirror: 0,
    industryAngleDeg: 0,
    depth: 0.2,
    metadata: {
      operationType: "table",
      fixedAngle: true,
      patternMode: "symmetric",
    },
  }, { stock });
}

function ensureTableFacet(document) {
  if (document.facets.some((facet) => facet.patternId === TABLE_PATTERN_ID || facet.metadata?.operationType === "table")) {
    return document;
  }
  return { ...document, facets: [...tableFacets(document.stock), ...document.facets] };
}

/** Default 32-fold girdle preform: turns the cube stock into a prism blank. */
function girdlePreformFacets(stock) {
  return resolveFacetPattern({
    patternId: "girdle-preform",
    label: "G1 腰部",
    region: "girdle",
    baseIndex: 0,
    repeat: 32,
    mirror: 0,
    industryAngleDeg: 90,
    depth: 0.2,
    metadata: { patternMode: "symmetric" },
  }, { stock });
}

function createWorkbenchDocument(name) {
  const withTable = ensureTableFacet(createFacetingDocument({ name }));
  return { ...withTable, facets: [...withTable.facets, ...girdlePreformFacets(withTable.stock)] };
}

function parseCustomIndices(value) {
  const tokens = value.trim() ? value.trim().split(/[\s,，;；]+/) : [];
  if (tokens.length === 0) return { indices: [], error: "请输入至少一个 1–96 整数索引。" };

  const values = [];
  for (const token of tokens) {
    const number = Number(token);
    if (!Number.isInteger(number) || number < 1 || number > 96) {
      return { indices: [], error: `“${token}” 不是 1–96 范围内的整数索引。` };
    }
    values.push(normalizeIndex(number));
  }

  const indices = [...new Set(values)].sort((left, right) => displayIndex(left) - displayIndex(right));
  return { indices, error: "" };
}

function planeEntry(facet) {
  return {
    ...facet.plane,
    operationId: facet.patternId,
    faceId: facet.id,
    region: facet.region,
  };
}

function commandPatternId(command) {
  if (command.type === "pattern/add") return command.payload?.pattern?.patternId;
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
  if (command.type === "pattern/add") {
    const pattern = command.payload?.pattern ?? {};
    const count = resolveFacetPattern(pattern).length;
    return `切割 ${count} 个${REGION_LABELS[pattern.region] ?? ""}面`;
  }
  if (command.type === "facets/add") {
    const facets = command.payload?.facets ?? [];
    return `新增 ${facets.length} 个预切割面`;
  }
  if (command.type === "pattern/replace") return "更新解析切割动作";
  if (command.type === "document/replace") return "导入并替换设计文档";
  return "更新切磨参数";
}

function Modal({ title, children, confirmLabel, onConfirm, onClose, destructive = false }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2>{title}</h2>
        {children}
        <div className="modal-actions">
          <button type="button" className="secondary-button modal-button" onClick={onClose}>取消</button>
          {onConfirm ? (
            <button
              type="button"
              className={destructive ? "primary-action modal-button is-destructive" : "primary-action modal-button"}
              onClick={onConfirm}
            >
              {confirmLabel}
            </button>
          ) : (
            <button type="button" className="primary-action modal-button" onClick={onClose}>知道了</button>
          )}
        </div>
      </section>
    </div>
  );
}

export function App() {
  const [history, setHistory] = useState(() => createCommandHistory(createWorkbenchDocument("未命名切型 01")));
  const [region, setRegion] = useState("crown");
  const [industryAngle, setIndustryAngle] = useState(32);
  const [depth, setDepth] = useState(0.42);
  const [baseIndex, setBaseIndex] = useState(36);
  const [repeatCount, setRepeatCount] = useState(8);
  const [mirrorOffset, setMirrorOffset] = useState(0);
  const [patternMode, setPatternMode] = useState("symmetric");
  const [customIndices, setCustomIndices] = useState("02 22 26 46 50 70 74 94");
  const [sessionState, dispatchCutSession] = useReducer(
    cutSessionReducer,
    null,
    () => createCutSession(CUT_SESSION_MODE.CREATE, { region: "crown" }),
  );
  const [viewMode, setViewMode] = useState("perspective");
  const [renderMode, setRenderMode] = useState("solid");
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [cutStackOpen, setCutStackOpen] = useState(true);
  const [resetSignal, setResetSignal] = useState(0);
  const [groupDeltaZ, setGroupDeltaZ] = useState(0);
  const [groupScale, setGroupScale] = useState(1);
  const [groupRotationTeeth, setGroupRotationTeeth] = useState(0);
  const [hoveredPatternId, setHoveredPatternId] = useState(null);
  const [hiddenPatternIds, setHiddenPatternIds] = useState(() => new Set());
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState("");
  const [reportIncludeGirdle, setReportIncludeGirdle] = useState(false);
  const importRef = useRef(null);
  const toastTimerRef = useRef(null);
  const operationSequence = useRef(0);
  const projectSequence = useRef(1);

  const document = history.present;
  const cutSession = resolveCutSession(sessionState);
  const cutMode = cutSession.mode;
  const previewEnabled = cutSession.previewEnabled;
  const editingPatternId = cutSession.activePatternId;
  const groupEditRegion = cutSession.groupRegion;
  const meetTarget = cutSession.meetTarget;
  const signedBeta = industryAngleToBetaDeg(region, industryAngle);

  const notify = useCallback((message) => {
    setToast(message);
    window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(""), 2600);
  }, []);

  useEffect(() => () => window.clearTimeout(toastTimerRef.current), []);

  const draft = useMemo(() => {
    try {
      if (patternMode === "symmetric") {
        const facets = resolveFacetPattern({
          patternId: "draft-symmetric",
          region,
          baseIndex,
          repeat: repeatCount,
          mirror: mirrorOffset,
          industryAngleDeg: industryAngle,
          depth,
        }, { stock: document.stock });
        return { facets, error: "" };
      }

      const parsed = parseCustomIndices(customIndices);
      if (parsed.error) return { facets: [], error: parsed.error };
      const facets = parsed.indices.map((index, ordinal) => resolveFacet({
        id: `draft-arbitrary:${displayIndex(index)}`,
        patternId: "draft-arbitrary",
        ordinal,
        region,
        baseIndex: index,
        repeat: 1,
        mirror: 0,
        index,
        industryAngleDeg: industryAngle,
        depth,
      }, { stock: document.stock }));
      return { facets, error: "" };
    } catch (error) {
      return { facets: [], error: error.message };
    }
  }, [baseIndex, customIndices, depth, document.stock, industryAngle, mirrorOffset, patternMode, region, repeatCount]);

  const stockSolid = useMemo(() => createCenteredCube(document.stock.size, {
    center: document.stock.center,
    sourceOperationId: "rough-cube",
    region: "rough",
  }), [document.stock]);

  const savedSolid = useMemo(
    () => clipPolyhedronByPlanes(stockSolid, document.facets.map(planeEntry)),
    [document.facets, stockSolid],
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
  const reportSolid = savedSolid;
  const reportMetrics = useMemo(() => measurePolyhedron(reportSolid), [reportSolid]);

  const previewSolid = useMemo(() => {
    if (!previewEnabled || draft.facets.length === 0 || (editingPatternId && hiddenPatternIds.has(editingPatternId))) return committedSolid;
    const draftFacets = editingPatternId
      ? draft.facets.map((facet) => ({ ...facet, patternId: editingPatternId }))
      : draft.facets;
    const sequence = editingPatternId
      ? replacePatternFacets(visibleFacets, editingPatternId, draftFacets)
      : [...visibleFacets, ...draftFacets];
    return clipPolyhedronByPlanes(stockSolid, sequence.map(planeEntry));
  }, [committedSolid, draft.facets, editingPatternId, hiddenPatternIds, previewEnabled, stockSolid, visibleFacets]);

  const previewWouldEraseStock = previewEnabled && draft.facets.length > 0 && previewSolid.vertices.length === 0;
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
  const validationMessage = draft.error || (previewWouldEraseStock ? "当前深度会移除全部材料，请减小切入深度。" : "");
  const generatedIndices = draft.facets.map((facet) => facet.index);
  const primaryDraftFacet = useMemo(() => {
    if (!draft.facets.length) return null;
    if (patternMode !== "symmetric") return draft.facets[0];
    const activeIndex = normalizeIndex(baseIndex);
    return draft.facets.find((facet) => normalizeIndex(facet.index) === activeIndex) ?? draft.facets[0];
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
      if (!locked) regionCounts[first.region] += 1;
      return {
        id,
        label: first.label || `${REGION_PREFIX[first.region]}${regionCounts[first.region]} ${REGION_LABELS[first.region]}`,
        region: first.region,
        industryAngleDeg: first.industryAngleDeg,
        signedBeta: first.betaDeg,
        depth: first.depth,
        indices: facets.map((facet) => facet.index),
        baseIndex: first.baseIndex,
        repeat: first.repeat,
        mirror: first.mirror,
        patternMode: first.metadata?.patternMode || (first.repeat === 1 && facets.length > 1 ? "arbitrary" : "symmetric"),
        facets,
        locked,
        visible: !hiddenPatternIds.has(id),
        status: hiddenPatternIds.has(id) ? "显示隐藏" : "参与解析",
      };
    });
  }, [document.facets, hiddenPatternIds]);
  const editingOperation = operations.find((operation) => operation.id === editingPatternId) ?? null;
  const previewPlanes = cutSession.showCutPlane && !(editingPatternId && hiddenPatternIds.has(editingPatternId))
    ? draft.facets.map((facet) => ({ ...facet.plane, index: facet.index, primary: facet === primaryDraftFacet }))
    : [];

  const instructionGroups = useMemo(() => {
    const rows = operations.map((operation) => {
      const isActive = operation.id === editingPatternId;
      const livePreview = isActive && draft.facets.length > 0;
      return {
        id: operation.id,
        prefix: operation.label.split(/\s+/)[0],
        region: operation.region,
        angle: livePreview ? industryAngle : operation.industryAngleDeg,
        indices: livePreview ? generatedIndices : operation.indices,
        active: isActive,
        locked: operation.locked,
        hidden: !operation.visible,
      };
    });

    if (!editingPatternId && !groupEditRegion && previewEnabled && draft.facets.length > 0) {
      const number = operations.filter((operation) => operation.region === region && !operation.locked).length + 1;
      rows.push({
        id: "draft-instruction",
        prefix: `${REGION_PREFIX[region]}${number}`,
        region,
        angle: industryAngle,
        indices: generatedIndices,
        active: true,
        locked: false,
        hidden: false,
      });
    }

    return {
      pavilion: rows
        .filter((row) => row.region === "pavilion"),
      girdle: rows
        .filter((row) => row.region === "girdle"),
      crown: rows
        .filter((row) => row.region === "crown")
        .sort((left, right) => Number(left.locked) - Number(right.locked)),
    };
  }, [draft.facets.length, editingPatternId, generatedIndices, groupEditRegion, industryAngle, operations, previewEnabled, region]);

  useEffect(() => {
    if (editingPatternId && !operations.some((operation) => operation.id === editingPatternId)) {
      dispatchCutSession({ type: CUT_SESSION_EVENT.ACTIVE_LAYER_REMOVED, patternId: editingPatternId });
    }
  }, [editingPatternId, operations]);

  const historyEntries = useMemo(() => history.commands.slice(0, history.cursor).map((command) => {
    const createdAt = command.payload?.pattern?.metadata?.createdAt
      ?? command.payload?.facets?.[0]?.metadata?.createdAt;
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
      label: `${REGION_PREFIX[targetRegion]}${number} ${REGION_LABELS[targetRegion]}`,
    };
  }, [operations]);

  const applyDraft = () => {
    if (!cutSession.canCommit || validationMessage || draft.facets.length === 0) return;
    const current = operations.find((operation) => operation.id === editingPatternId);

    // Commit-time destruction guard: refuse parameters that would erase
    // another committed layer's faces. Shrinking is normal (later tiers
    // share edges); erasing means the earlier tier is gone.
    const baseFacets = current
      ? visibleFacets.filter((facet) => facet.patternId !== current.id)
      : visibleFacets;
    const baseSolid = clipPolyhedronByPlanes(stockSolid, baseFacets.map(planeEntry));
    const afterSolid = clipPolyhedronByPlanes(baseSolid, draft.facets.map(planeEntry));
    const survivingIds = new Set(afterSolid.faces.map((face) => face.id));
    const destroyed = baseSolid.faces.filter(
      (face) => face.sourceOperationId && face.sourceOperationId !== "rough-cube" && !survivingIds.has(face.id),
    );
    if (destroyed.length > 0) {
      const names = [...new Set(destroyed.map((face) => face.sourceOperationId))];
      const labels = names.map((id) => operations.find((operation) => operation.id === id)?.label ?? id).join("、");
      notify(`已拒绝保存：当前参数会消除「${labels}」的面。请减小切入深度，或先删除对应图层。`);
      return;
    }

    const { patternId, label } = current
      ? { patternId: current.id, label: current.locked ? current.label : `${current.label.split(/\s+/)[0]} ${REGION_LABELS[region]}` }
      : makeOperationIdentity(region);
    const createdAt = new Date().toISOString();
    const metadata = {
      ...(current?.facets[0]?.metadata || {}),
      createdAt: current?.facets[0]?.metadata?.createdAt || createdAt,
      updatedAt: createdAt,
      integerIndexOnly: true,
      patternMode,
    };

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
      setHistory(executeFacetingCommand(history, command));
      dispatchCutSession({ type: CUT_SESSION_EVENT.COMMIT_SUCCESS });
      notify(current
        ? `已更新“${label}”并退出编辑，${draft.facets.length} 个面已重新解析。`
        : `已加入“${label}”并退出编辑；再次选择该层可继续调整。`);
    } catch (error) {
      notify(error.message);
    }
  };

  const startNewCut = () => {
    if (!cutSession.showNewButton) return;
    setGroupDeltaZ(0);
    setGroupScale(1);
    setGroupRotationTeeth(0);
    setIndustryAngle(DEFAULT_ANGLES[region]);
    setDepth(DEFAULT_DEPTHS[region]);
    setRepeatCount(region === "girdle" ? 16 : 8);
    setMirrorOffset(0);
    setPatternMode("symmetric");
    dispatchCutSession({ type: CUT_SESSION_EVENT.START_CREATE, region });
    notify("已进入新建动作；已保存图层保持不变。");
  };

  const cancelCutSession = useCallback(() => {
    if (!cutSession.canCancel) return;
    const discarded = cutMode === CUT_SESSION_MODE.CREATE || cutSession.dirty;
    if (cutMode === CUT_SESSION_MODE.EDIT && editingOperation) {
      const first = editingOperation.facets[0];
      setRegion(first.region);
      setIndustryAngle(first.industryAngleDeg);
      setDepth(first.depth);
      setBaseIndex(first.baseIndex ?? first.index);
      setRepeatCount(first.repeat || editingOperation.indices.length);
      setMirrorOffset(first.mirror || 0);
      setPatternMode(editingOperation.patternMode);
      setCustomIndices(editingOperation.indices.map((index) => displayIndex(index)).join(" "));
    } else if (cutMode === CUT_SESSION_MODE.CREATE) {
      setIndustryAngle(DEFAULT_ANGLES[region]);
      setDepth(DEFAULT_DEPTHS[region]);
      setRepeatCount(region === "girdle" ? 16 : 8);
      setMirrorOffset(0);
      setPatternMode("symmetric");
    }
    setGroupDeltaZ(0);
    setGroupScale(1);
    setGroupRotationTeeth(0);
    dispatchCutSession({ type: CUT_SESSION_EVENT.CANCEL });
    notify(cutMode === CUT_SESSION_MODE.GROUP
      ? "已取消整体变换。"
      : discarded
        ? "已放弃未保存预览并返回浏览状态。"
        : "已退出图层编辑。");
  }, [cutMode, cutSession.canCancel, cutSession.dirty, editingOperation, notify, region]);

  useEffect(() => {
    if (!cutSession.canCancel || modal) return undefined;
    const handleEscape = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      cancelCutSession();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [cancelCutSession, cutSession.canCancel, modal]);

  const selectCut = (id) => {
    if (id === "rough-cube") return;
    if (!cutSession.canPickLayer) return;
    const operation = operations.find((item) => item.id === id);
    if (!operation) return;
    setGroupDeltaZ(0);
    const first = operation.facets[0];
    dispatchCutSession({ type: CUT_SESSION_EVENT.SELECT_LAYER, patternId: id });
    setRegion(first.region);
    setIndustryAngle(first.industryAngleDeg);
    setDepth(first.depth);
    setBaseIndex(first.baseIndex ?? first.index);
    setRepeatCount(first.repeat || operation.indices.length);
    setMirrorOffset(first.mirror || 0);
    setPatternMode(operation.patternMode);
    setCustomIndices(operation.indices.map((index) => displayIndex(index)).join(" "));
  };

  const removeCut = (id) => {
    if (!cutSession.canMutateStack) return;
    const operation = operations.find((item) => item.id === id);
    if (!operation) return;
    if (operation.locked) {
      notify("台面是固定结构层，只能调整深度，不能删除。");
      return;
    }
    setHistory(executeFacetingCommand(history, createRemoveFacetsCommand(operation.facets.map((facet) => facet.id))));
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
    setHistory(executeFacetingCommand(history, createReplacePatternCommand(id, facets)));
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
    setHistory(executeFacetingCommand(history, createReplaceDocumentCommand({ ...document, facets })));
    notify(`已调整布尔顺序：“${moved.label}”移至第 ${toIndex + 1} 位。`);
  };

  // Inline layer editing drives the same draft state as the drawer controls.
  const inlineEdit = (field, value) => {
    if (!editingPatternId) return;
    if (field === "angle") {
      const angle = Math.min(90, Math.max(0, value));
      setIndustryAngle(angle);
      if (meetTarget?.kind === "vertex" && region !== "girdle" && draft.facets[0]) {
        const normal = facetNormal(baseIndex, industryAngleToBetaDeg(region, angle));
        const solved = depthForVertex(normal, meetTarget.point, document.stock);
        setDepth(normalizeDepthValue(solved));
      }
    } else if (field === "depth") {
      setDepth(normalizeDepthValue(value));
    }
    dispatchCutSession({ type: CUT_SESSION_EVENT.CHANGE_DRAFT });
  };

  const changeRegion = (nextRegion) => {
    if (nextRegion === region) return;
    if (!cutSession.canChangeRegion) return;
    setGroupDeltaZ(0);
    // Region switching is a new-action gesture: a selected layer stays
    // untouched and the draft restarts with the new region's defaults.
    setGroupScale(1);
    setGroupRotationTeeth(0);
    setRegion(nextRegion);
    setIndustryAngle(DEFAULT_ANGLES[nextRegion]);
    setDepth(DEFAULT_DEPTHS[nextRegion]);
    setRepeatCount(nextRegion === "girdle" ? 16 : 8);
    setMirrorOffset(0);
    setPatternMode("symmetric");
    dispatchCutSession({ type: CUT_SESSION_EVENT.CHANGE_REGION, region: nextRegion });
  };

  const startGroupEdit = (targetRegion) => {
    if (targetRegion === "girdle" || !cutSession.canStartGroup) return;
    setRegion(targetRegion);
    setGroupDeltaZ(0);
    setGroupScale(1);
    setGroupRotationTeeth(0);
    dispatchCutSession({ type: CUT_SESSION_EVENT.START_GROUP, region: targetRegion });
  };

  const groupIsDirty = (nextDelta, nextScale, nextRotation) => (
    Boolean(Number(nextDelta))
    || Math.abs(Number(nextScale) - 1) > 1e-9
    || Boolean(Number(nextRotation))
  );

  const changeGroupDelta = (value) => {
    setGroupDeltaZ(value);
    dispatchCutSession({
      type: CUT_SESSION_EVENT.CHANGE_GROUP,
      dirty: groupIsDirty(value, groupScale, groupRotationTeeth),
    });
  };

  const changeGroupScale = (value) => {
    setGroupScale(value);
    dispatchCutSession({
      type: CUT_SESSION_EVENT.CHANGE_GROUP,
      dirty: groupIsDirty(groupDeltaZ, value, groupRotationTeeth),
    });
  };

  const changeGroupRotation = (value) => {
    const normalized = normalizeIndex(Math.round(Number(value) || 0));
    const teeth = normalized > 48 ? normalized - 96 : normalized;
    setGroupRotationTeeth(teeth);
    dispatchCutSession({
      type: CUT_SESSION_EVENT.CHANGE_GROUP,
      dirty: groupIsDirty(groupDeltaZ, groupScale, teeth),
    });
  };

  const applyGroupEdit = () => {
    const shift = Number(groupDeltaZ);
    const scale = Number(groupScale);
    const rotation = Math.round(Number(groupRotationTeeth) || 0);
    if (!groupEditRegion || !cutSession.canCommit || groupPreview.error) return;

    const beforeSolid = clipPolyhedronByPlanes(
      stockSolid,
      document.facets.filter((facet) => !hiddenPatternIds.has(facet.patternId)).map(planeEntry),
    );
    const afterSolid = clipPolyhedronByPlanes(stockSolid, visibleFacets.map(planeEntry));
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
    setHistory(executeFacetingCommand(history, createReplaceDocumentCommand(nextDocument, { description })));
    setGroupDeltaZ(0);
    setGroupScale(1);
    setGroupRotationTeeth(0);
    dispatchCutSession({ type: CUT_SESSION_EVENT.COMMIT_SUCCESS });
    notify(`已应用${groupLabel}整体变换；可一步撤销。`);
  };

  const applyMeetTarget = (target) => {
    const facet = draft.facets[0];
    if (!target || !facet) return;
    const solved = target.kind === "vertex"
      ? depthForVertex(facet.plane.normal, target.point, document.stock)
      : depthForEdge(facet.plane.normal, { a: target.a, b: target.b }, document.stock);
    const nextDepth = normalizeDepthValue(solved);
    setDepth(nextDepth);
    notify(`相遇目标已设定：切割面贴合所选${target.kind === "vertex" ? "顶点" : "棱"}，深度 ${nextDepth.toFixed(3)}。`);
  };

  const handleMeetPick = (target) => {
    if (!cutSession.canPickMeet) return;
    if (!target) {
      dispatchCutSession({ type: CUT_SESSION_EVENT.CLEAR_MEET });
      return;
    }
    if (target.kind === "face" || target.kind === "handle") return;
    const picked = target.kind === "vertex"
      ? { kind: "vertex", point: target.point }
      : { kind: "edge", a: target.a, b: target.b };
    dispatchCutSession({ type: CUT_SESSION_EVENT.PICK_MEET, target: picked });
    applyMeetTarget(picked);
  };

  const handleFacePick = (operationId) => {
    if (!cutSession.canPickLayer) return;
    selectCut(operationId);
  };

  const handleDepthDrag = (rawDepth) => {
    setDepth(normalizeDepthValue(rawDepth));
    dispatchCutSession({ type: CUT_SESSION_EVENT.CHANGE_DRAFT });
  };

  const handleAngleDragStart = () => {
    if (!meetTarget) return;
    dispatchCutSession({ type: CUT_SESSION_EVENT.CLEAR_MEET });
    notify("已解除相遇目标；角度手柄只调整行业角。");
  };

  const handleAngleDrag = (rawAngle) => {
    if (region === "girdle" || editingOperation?.locked) return;
    setIndustryAngle(Math.min(90, Math.max(0, rawAngle)));
    dispatchCutSession({ type: CUT_SESSION_EVENT.CHANGE_DRAFT });
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
      angleLocked: region === "girdle" || Boolean(editingOperation?.locked),
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
  }, [depth, document.stock.size, editingOperation?.locked, industryAngle, mirrorOffset, patternMode, primaryDraftFacet, region, repeatCount]);

  const depthControlMax = Math.max(document.stock.size * 1.5, depth * 1.25, 1);

  const resetDocument = (name) => {
    setHistory(createCommandHistory(createWorkbenchDocument(name)));
    setHiddenPatternIds(new Set());
    setRegion("crown");
    setIndustryAngle(DEFAULT_ANGLES.crown);
    setDepth(DEFAULT_DEPTHS.crown);
    setBaseIndex(36);
    setRepeatCount(8);
    setMirrorOffset(0);
    setPatternMode("symmetric");
    setGroupDeltaZ(0);
    setGroupScale(1);
    setGroupRotationTeeth(0);
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
    setHistory(executeFacetingCommand(history, command));
    notify(`切型已重命名为“${nextName}”。`);
  };

  const exportDocument = () => {
    const json = exportFacetingJSON(document);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = `${document.name.replace(/[^\p{L}\p{N}-]+/gu, "-") || "facet-96"}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    notify(`已导出 ${document.facets.length} 个面的完整 JSON 参数。`);
  };

  const exportPdfReport = async () => {
    setModal(null);
    notify("正在生成切磨数据报告…");
    try {
      await downloadFacetReport({ document, solid: reportSolid, metrics: reportMetrics, includeGirdle: reportIncludeGirdle });
      notify(reportIncludeGirdle
        ? `PDF 报告已生成：${document.facets.length} 个刻面，含腰部逐面表。`
        : `PDF 报告已生成：腰部逐面表按默认规则省略，几何视图中仍可见。`);
    } catch (error) {
      notify(`PDF 导出失败：${error.message}`);
    }
  };

  const importDocument = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const imported = ensureTableFacet(importFacetingJSON(await file.text()));
      const command = createReplaceDocumentCommand(imported);
      setHistory(executeFacetingCommand(history, command));
      setHiddenPatternIds(new Set());
      setGroupDeltaZ(0);
      setGroupScale(1);
      setGroupRotationTeeth(0);
      dispatchCutSession({ type: CUT_SESSION_EVENT.DOCUMENT_IMPORT });
      notify(`已导入“${imported.name}”，共 ${imported.facets.length} 个面。`);
    } catch (error) {
      const detail = error.errors?.[0];
      notify(detail ? `导入失败：${detail.path} ${detail.message}` : `导入失败：${error.message}`);
    }
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

  const composerStatus = `实时解析 · ${metrics.faces.length} 面 · 体积 ${metrics.volume.toFixed(3)}`;
  const composerValidationMessage = groupEditRegion
    ? `正在整体变换${groupEditRegion === "crown" ? "冠部与台面" : "亭部"}；请先应用或取消。`
    : cutSession.active ? validationMessage : "";

  return (
    <main className="app-shell">
      <section className={sidebarOpen ? "editor-workspace" : "editor-workspace is-sidebar-collapsed"}>
        <aside className="control-sidebar" aria-label="切磨参数侧栏">
          <div className="workspace-brand">
            <img
              className="brand-logo"
              src={`${import.meta.env.BASE_URL}brand/logo-header.webp`}
              alt="苏哇品牌标志"
            />
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
              <summary><span>切割参数 CUT</span><small>{editingOperation ? `编辑 ${editingOperation.label}` : REGION_LABELS[region]}</small></summary>
              <MastControl
                region={region}
                industryAngle={industryAngle}
                signedBeta={signedBeta}
                depth={depth}
                disabled={!cutSession.controlsEnabled}
                onAngleChange={(value) => {
                  setIndustryAngle(value);
                  // With a vertex meet target pinned, keep the plane glued to it.
                  if (meetTarget?.kind === "vertex" && region !== "girdle" && draft.facets[0]) {
                    const normal = facetNormal(baseIndex, industryAngleToBetaDeg(region, value));
                    const solved = depthForVertex(normal, meetTarget.point, document.stock);
                    setDepth(normalizeDepthValue(solved));
                  }
                  dispatchCutSession({ type: CUT_SESSION_EVENT.CHANGE_DRAFT });
                }}
                onDepthChange={(value) => {
                  setDepth(normalizeDepthValue(value));
                  dispatchCutSession({ type: CUT_SESSION_EVENT.CHANGE_DRAFT });
                }}
                depthMax={depthControlMax}
                angleLocked={Boolean(editingOperation?.locked)}
                meetTarget={meetTarget}
                onClearMeetTarget={() => dispatchCutSession({ type: CUT_SESSION_EVENT.CLEAR_MEET })}
              />
              <CutComposer
                patternMode={patternMode}
                onPatternModeChange={(value) => {
                  setPatternMode(value);
                  dispatchCutSession({ type: CUT_SESSION_EVENT.CHANGE_DRAFT });
                }}
                baseIndex={baseIndex}
                onBaseIndexChange={(value) => {
                  setBaseIndex(normalizeIndex(value));
                  dispatchCutSession({ type: CUT_SESSION_EVENT.CHANGE_DRAFT });
                }}
                repeatCount={repeatCount}
                repeatOptions={VALID_REPEAT_COUNTS}
                onRepeatChange={(value) => {
                  setRepeatCount(value);
                  dispatchCutSession({ type: CUT_SESSION_EVENT.CHANGE_DRAFT });
                }}
                mirrorOffset={mirrorOffset}
                onMirrorChange={(value) => {
                  setMirrorOffset(Math.min(48, Math.max(0, Math.round(value))));
                  dispatchCutSession({ type: CUT_SESSION_EVENT.CHANGE_DRAFT });
                }}
                customIndices={customIndices}
                onCustomIndicesChange={(value) => {
                  setCustomIndices(value);
                  dispatchCutSession({ type: CUT_SESSION_EVENT.CHANGE_DRAFT });
                }}
                generatedCount={draft.facets.length}
                instructionGroups={instructionGroups}
                onApply={applyDraft}
                mode={cutMode}
                editingLabel={editingOperation?.label}
                previewEnabled={previewEnabled}
                lockedPattern={Boolean(editingOperation?.locked)}
                validationMessage={composerValidationMessage}
                status={composerStatus}
              />
            </details>
          </div>
        </aside>

        <div className="viewport-column">
          {!sidebarOpen ? (
            <button type="button" className="sidebar-reopen" onClick={() => setSidebarOpen(true)} aria-label="展开参数侧栏">
              <IconChevronRight size={18} stroke={1.8} />
            </button>
          ) : null}

          <Header
            projectName={document.name}
            onProjectNameChange={renameProject}
            facetCount={operations.reduce((sum, item) => sum + item.indices.length, 0)}
            onNew={() => setModal("new")}
            onImport={() => importRef.current?.click()}
            onExport={exportDocument}
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
            viewMode={viewMode}
            onViewMode={setViewMode}
            displayMode={renderMode}
            onDisplayMode={setRenderMode}
          />

          <CutStack
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
            sessionLabel={editingOperation?.label ?? ""}
            sessionExitLabel={cutMode === CUT_SESSION_MODE.EDIT && cutSession.dirty
              ? "放弃修改并退出编辑"
              : cutSession.exitLabel}
            onCancelSession={cancelCutSession}
            floating
            collapsed={!cutStackOpen}
            onToggle={() => setCutStackOpen((value) => !value)}
          />

          <GemViewport
            polyhedron={displaySolid}
            previewPlanes={previewPlanes}
            selectedIndex={baseIndex}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            renderMode={renderMode}
            resetSignal={resetSignal}
            highlightOperationId={hoveredPatternId}
            activeOperationId={cutSession.activePatternId}
            previewOperationId={cutMode === "create" ? `draft-${patternMode}` : null}
            pickingEnabled
            meetTarget={meetTarget}
            cutGizmo={cutSession.showGizmo ? cutGizmo : null}
            groupGizmo={groupGizmo}
            onMeetPick={handleMeetPick}
            onFacePick={handleFacePick}
            onDepthDrag={handleDepthDrag}
            onAngleDragStart={handleAngleDragStart}
            onAngleDrag={handleAngleDrag}
            onIndexDrag={(value) => {
              if (editingOperation?.locked) return;
              setBaseIndex(normalizeIndex(value));
              dispatchCutSession({ type: CUT_SESSION_EVENT.CHANGE_DRAFT });
            }}
            onMirrorDrag={(value) => {
              if (editingOperation?.locked) return;
              setMirrorOffset(Math.min(48, Math.max(0, Math.round(value))));
              dispatchCutSession({ type: CUT_SESSION_EVENT.CHANGE_DRAFT });
            }}
            onGroupDeltaDrag={(value) => changeGroupDelta(value.toFixed(6))}
            onGroupScaleDrag={(value) => changeGroupScale(Number(value.toFixed(6)))}
            onGroupRotationDrag={changeGroupRotation}
          />

          {historyOpen ? (
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

      {ledgerOpen ? (
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
      {toast ? <div className="toast" role="status" aria-live="polite">{toast}</div> : null}

      {modal === "new" ? (
        <Modal title="新建设计" confirmLabel="创建新设计" onClose={() => setModal(null)} onConfirm={startNewDocument}>
          <p>当前设计会从工作区移除。新文件将从边长 2.000 的立方体开始，并恢复固定台面 T1 与默认 32 面腰部 G1。</p>
        </Modal>
      ) : null}

      {modal === "pdf" ? (
        <Modal title="导出 PDF 技术报告" confirmLabel="生成报告" onClose={() => setModal(null)} onConfirm={exportPdfReport}>
          <p>报告包含封面五视图（含台面宽 T 标注）与分区逐面参数表。腰部是辅助面，逐面表默认不导出。</p>
          <label className="modal-check">
            <input
              type="checkbox"
              checked={reportIncludeGirdle}
              onChange={(event) => setReportIncludeGirdle(event.target.checked)}
            />
            <span>包含腰部逐面参数表（{operations.filter((item) => item.region === "girdle").reduce((sum, item) => sum + item.indices.length, 0)} 面）</span>
          </label>
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
        <Modal title="切磨工作台帮助" onClose={() => setModal(null)}>
          <ul>
            <li>水平自由度使用 1–96 整数索引，96 与内部索引 0 同位。</li>
            <li>垂直自由度由行业角控制；深度决定裁切平面离毛坯表面的距离。</li>
            <li>重复围绕同一轴心等距复制；N 次重复对应半圈内均布的 N 条无方向镜像轴。</li>
            <li>选择图层只读取已保存参数；修改参数后才显示未保存预览，保存时在原序号替换。</li>
            <li>JSON 保存可重放参数；PDF 报告汇总截面、尺寸、区域统计与全部逐面数据。</li>
          </ul>
        </Modal>
      ) : null}
    </main>
  );
}
