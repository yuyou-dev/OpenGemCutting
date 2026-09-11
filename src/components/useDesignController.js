import { useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import {
  DESIGN_API_VERSION,
  validateTool,
} from '../application/designContract.js';
import {
  designError,
  inspectDesign,
  solveDocument,
  constructionPrefix,
  topologyOf,
  lookupTarget,
  planDesign,
} from '../application/designOperations.js';
import { measurePolyhedron } from '../domain/geometry.js';
import {
  createReplaceDocumentCommand,
  executeFacetingCommand,
  undoFacetingCommand,
  redoFacetingCommand,
  canUndo,
  canRedo,
  exportFacetingJSON,
} from '../domain/faceting.js';
import {
  CUT_SESSION_EVENT,
  resolveCutSession,
  defaultDraftForRegion,
} from '../domain/cutSession.js';
import { resolveDraftGeometry } from '../domain/cutConstruction.js';
import {
  generateJumpCandidates,
  generateDualJumpCandidates,
} from '../domain/meetJump.js';
import { auditProjection } from '../domain/projectionAudit.js';
import { inspectTopology } from '../domain/referenceTopology.js';
import { technicalPreviewSvg } from '../domain/technicalPreview.js';
import { serializeGemCadAsc } from '../domain/gemcadAsc.js';

async function renderPng(solid, view) {
  const svg = technicalPreviewSvg(solid, view, {
    width: 1000,
    height: 800,
    padding: 48,
  });
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = globalThis.document.createElement('canvas');
    canvas.width = 1000;
    canvas.height = 800;
    canvas.getContext('2d').drawImage(image, 0, 0);
    return {
      mimeType: 'image/png',
      data: canvas.toDataURL('image/png').split(',')[1],
      view,
      svg,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function useDesignController({
  controllerRef,
  projectId,
  document,
  history,
  setHistory,
  sessionState,
  dispatchCutSession,
  hiddenPatternIds,
  setHiddenPatternIds,
  blocked,
  projectStatus,
  notify,
}) {
  const identity = useRef(null);
  const plans = useRef(new Map());
  const last = identity.current;
  if (
    !last ||
    last.document !== document ||
    last.sessionState !== sessionState ||
    last.hiddenPatternIds !== hiddenPatternIds ||
    last.blocked !== blocked
  ) {
    identity.current = {
      document,
      sessionState,
      hiddenPatternIds,
      blocked,
      revision: crypto.randomUUID(),
    };
    plans.current.clear();
  }
  const revision = identity.current.revision;
  const session = resolveCutSession(sessionState);
  const reason =
    blocked ||
    (session.canCancel
      ? '当前有手动 CUT 会话，请在网页保存或放弃后重试。'
      : '') ||
    (hiddenPatternIds.size ? '请恢复全部隐藏层后执行自动构造。' : '') ||
    (['conflict', 'error'].includes(projectStatus.state)
      ? '请先处理项目保存失败或冲突。'
      : '');
  const read = () => ({
    apiVersion: DESIGN_API_VERSION,
    projectId,
    revision,
    name: document.name,
    canWrite: !reason,
    blockedReason: reason || null,
    sessionMode: session.mode,
    canUndo: canUndo(history),
    canRedo: canRedo(history),
    saveStatus: projectStatus,
    design: inspectDesign(document),
  });
  const assertWrite = (args) => {
    if (args.projectId !== projectId || args.revision !== revision)
      throw designError(
        'STALE_REVISION',
        '项目或版本已变化，请重新读取、规划。',
        { projectId, revision },
      );
    if (reason) throw designError('WORKSPACE_BUSY', reason);
  };
  const planDocument = (id) => {
    if (!id) return document;
    const plan = plans.current.get(id);
    if (!plan) throw designError('PLAN_EXPIRED', '方案已失效，请重新规划。');
    return plan.document;
  };
  const handle = async (name, args, request) => {
    validateTool(name, args);
    if (name === 'design_read') return read();
    if (name === 'design_plan') {
      assertWrite(args);
      const plan = planDesign(document, args.operations);
      const planId = crypto.randomUUID();
      if (plans.current.size >= 8)
        plans.current.delete(plans.current.keys().next().value);
      plans.current.set(planId, plan);
      return {
        projectId,
        revision,
        planId,
        changes: plan.changes,
        requiredConfirmations: plan.requiredConfirmations,
        design: inspectDesign(plan.document),
      };
    }
    if (name === 'design_commit') {
      assertWrite(args);
      const plan = plans.current.get(args.planId);
      if (!plan) throw designError('PLAN_EXPIRED', '方案已失效，请重新规划。');
      if (
        plan.requiredConfirmations.some(
          (id) => !args.confirmedRemovals?.includes(id),
        )
      )
        throw designError(
          'CONFIRMATION_REQUIRED',
          '以下图层的有效面将全部消失；确认该具体方案后再提交。',
          { requiredConfirmations: plan.requiredConfirmations },
        );
      flushSync(() => {
        setHistory(
          executeFacetingCommand(
            history,
            createReplaceDocumentCommand(plan.document, {
              description: `对话构造 · ${plan.changes.length} 项操作`,
            }),
          ),
        );
        dispatchCutSession({ type: CUT_SESSION_EVENT.COMMIT_SUCCESS });
        setHiddenPatternIds(new Set());
      });
      notify('对话方案已应用，可继续手动编辑或一步撤销。');
      return controllerRef.current.read();
    }
    if (name === 'design_history') {
      assertWrite(args);
      flushSync(() =>
        setHistory(
          args.direction === 'undo'
            ? undoFacetingCommand(history)
            : redoFacetingCommand(history),
        ),
      );
      return controllerRef.current.read();
    }
    if (name === 'design_topology') {
      const solid = constructionPrefix(document, args.beforePatternId);
      const { vertices, edges } = topologyOf(solid);
      const offset = args.offset ?? 0,
        limit = args.limit ?? 100;
      return {
        projectId,
        revision,
        beforePatternId: args.beforePatternId ?? null,
        counts: {
          vertices: vertices.length,
          edges: edges.length,
          faces: solid.faces.length,
        },
        vertices: vertices.slice(offset, offset + limit),
        edges: edges.slice(offset, offset + limit),
        faces: solid.faces.slice(offset, offset + limit),
      };
    }
    if (name === 'design_jump') {
      const solid = constructionPrefix(document, args.patternId);
      const draft = { ...defaultDraftForRegion(args.region), ...args.draft };
      const geometry = resolveDraftGeometry(draft, args.region, document.stock);
      if (geometry.error) throw designError('INVALID_CUT', geometry.error);
      const primary = geometry.facets.find((f) => f.index === draft.baseIndex);
      const candidates = args.targetA
        ? generateDualJumpCandidates({
            baseSolid: solid,
            targetA: lookupTarget(solid, args.targetA),
            baseIndex: draft.baseIndex,
            region: args.region,
            stock: document.stock,
          })
        : generateJumpCandidates({
            baseSolid: solid,
            normal: primary.plane.normal,
            stock: document.stock,
          });
      return {
        projectId,
        revision,
        candidates,
        note: '候选是解析定位结果；用 design_plan 检查完整轨道与最终实体。',
      };
    }
    if (name === 'design_view')
      return {
        projectId,
        revision,
        planId: args.planId ?? null,
        ...(await renderPng(
          solveDocument(planDocument(args.planId)),
          args.view,
        )),
      };
    if (name === 'design_inspect') {
      const target = planDocument(args.planId);
      return {
        projectId,
        revision,
        ...inspectDesign(target),
        reference: inspectTopology(
          solveDocument(target),
          args.referenceTopology,
        ),
      };
    }
    if (name === 'design_projection')
      return {
        projectId,
        revision,
        ...auditProjection(
          solveDocument(planDocument(args.planId)),
          args.graph,
          args.faceMap,
          {
            view: args.view,
            scale: args.scale,
            center: args.center,
            rotation: args.rotation,
          },
        ),
      };
    if (name === 'design_export' && args.format === 'pdf') {
      const { createFacetReportPdf } = await import('../report/pdfReport.js');
      const solid = solveDocument(document);
      const blob = await createFacetReportPdf({
        document,
        solid,
        metrics: measurePolyhedron(solid),
        includeGirdle: false,
      });
      return { projectId, revision, ...(await request.exportArtifact(blob)) };
    }
    if (name === 'design_export')
      return {
        projectId,
        revision,
        ...(args.format === 'json'
          ? { format: 'json', text: exportFacetingJSON(document) }
          : serializeGemCadAsc(document)),
      };
    throw designError('UNKNOWN_TOOL', `未实现 ${name}`);
  };
  const controller = { handle, read, assertWrite };
  if (controllerRef) controllerRef.current = controller;
  useEffect(() => {
    if (controllerRef) controllerRef.current = controller;
    return () => {
      if (controllerRef?.current === controller) controllerRef.current = null;
    };
  }, [controllerRef, controller]);
}
