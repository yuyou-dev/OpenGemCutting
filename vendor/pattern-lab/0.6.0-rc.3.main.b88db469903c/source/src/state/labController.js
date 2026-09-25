import pkg from '../../package.json' with { type: 'json' };
import { importEditor96 } from '../core/application/import96.js';
import { createPattern, compilePlan, moveControl } from '../core/application/patternPlan.js';
import { groupsInPlan, setFinishMany, invertFinishMany, dissolveGroup } from '../core/application/groups.js';
import { editTargets } from '../core/application/planEdit.js';
import { createEditExecutor } from './editExecutor.js';
import { normalizeAnalyticPlan } from '../core/application/importAnalytic.js';
import { INDEX_GEARS, normalizeIndexTeeth, indexCompatibilityReport } from '../core/application/labContract.js';
import { bevelPolicy } from '../core/domain/bevel.js';
import { setFinish } from '../core/domain/finish.js';
import { planeMachine, indexNormal } from '../core/domain/machine.js';
import { solveProjectionGraph } from '../core/domain/projectionGraph.js';
import { exportEditor96, cutCSV } from '../core/application/export96.js';
import { RoughRenderer } from '../render/renderer.js';
import { createLightlabController } from './lightlabController.js';
import { physicalDimensions, scaleForWidth } from '../core/application/physicalScale.js';
import { editGuidance } from '../ui/editGuidance.js';
import { viewportFrame } from '../ui/solidView.js';
import { createViewportCamera, dragViewport, zoomViewport, resetViewport, keyViewport, advanceViewportCamera } from '../ui/viewportNavigation.js';
import { MATERIALS, materialPreset, absorptionRGB, withCustomFlip } from '../ui/materials.js';
import { planLayout, viewLayout, clampZoom } from '../ui/planView.js';
import {
  gearText,
  footerStateText,
  metricsRow,
  progressText,
  export96Title,
  selectedHelpText,
  facetRows,
} from '../ui/format.js';

/** Application state and browser-side effects, without React or view rendering.
 * Components provide canvases and consume actions plus stable snapshots. */
export const STORAGE_KEY = 'suva-facet-pattern-lab-v1';
export const LAB_VERSION = pkg.version;

/** Default single-slot autosave; the app shell can inject per-project
 * persistence with the same { load(), save(plan) } shape. */
const legacyPersistence = {
  load() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch {
      return null;
    }
  },
  save(plan) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
  },
};

export function createLabController({ editExecutor = createEditExecutor(), persistence = legacyPersistence, initialPlan, registerGlobal = true, sessionStorage } = {}) {
  let plan = null;
  let compiled = null;
  let selected = 'C2:0';
  let selectedIds = ['C2:0']; // multi-selection; holds `selected` whenever non-empty
  let multiSelectMode = false;
  let planSide = 'crown'; // 'crown' | 'pavilion'
  let view = 'structure'; // 'structure' | 'optical' | 'surface'
  // Preview-only optical material: full preset object + 色散开关; never in plan
  // JSON, undo history or localStorage (same session-only class as view/engine).
  let material = { ...materialPreset('amethyst'), spectral: false };
  let opticalEngine = 'fast'; // 'path' | 'fast' — session-only, like material/view
  let allPolished = false;
  let opticalSettings = { nee: true, denoise: true, compare: false, env: 0, rotation: 0, exposure: 0, budget: 32, traversal: 0, resolution: 256, samples: 128 };
  let opticalPaused = false;
  let opticalExpanded = false;
  let workspace = 'design';

  let renderProgress = '真实半空间几何';
  let notice = { text: '', error: false };
  let footerState = '';
  let modal = null; // {kind:'help'|'audit'|'export96'|'solve-result'}
  let solve = null; // {result, body, canReplace}
  let showHandles = true;
  let facetSearch = '';
  const cameraHome = { yaw: 0, pitch: .48 - Math.PI / 2, zoom: 1, panX: 0, panY: 0 };
  const camera = createViewportCamera(cameraHome);
  let cameraFrameId = null;
  let dragControl = null;
  let ghost = null;
  let editDrag = null; // {kind:'vertex'|'edge', key, start:[x,y]} — active handle drag
  let editGhost = null;
  let editTool = 'select';
  let editSelection = null; // stable incident-plane identity, independent of the pointer
  let editSettings = { mode: 'topology', angleLimit: 8, lockMergeHeight: true, snap: true, lockOutline: true, symmetry: false, stepMm: 0.01 };
  let editEpoch = 0, planRevision = 0, editBusy = false, editCommitRunning = false;
  let editQueue = [], pendingEdit = null;
  let editFeedback = null;
  let editPreviewCompiled = null;
  let editPreviewTimer = null;
  let mergePendingKey = null; // first vertex picked in the merge tool (pink highlight)
  let editTargetsCache = null; // {compiled, side, targets} — identity-keyed, invalidated by compile/side switch
  let facetRowsCache = null;
  let dimensionCache = null;
  let rotationDrag = null;
  let reference = null; // HTMLImageElement, local-only
  let refParams = { opacity: 0.5, scale: 1, rotation: 0, x: 0, y: 0 }; // x/y: plan-space offsets
  let refDrag = false; // 拖动参考图 toggle: plan-canvas drag pans the reference
  let planView = { zoom: 1, panX: 0, panY: 0 }; // screen-px view state, never history/JSON
  let renderer = null;
  let opticalCanvas = null;
  let history = [];
  let future = [];
  let drawerOpen = null; // 'left' | 'right' | null
  let started = false, disposed = false, suspended = false, keyboardTarget = null, saveStatus = '尚未保存';
  let asyncEpoch = 0, saveSequence = 0, recoveryData = null;

  const listeners = new Set();
  let snapshot = null;
  let snapshotVersion = 0;
  const lightlab = createLightlabController({
    getScene: () => compiled,
    getMaterial: () => material,
    getCamera: (width, height) => viewportFrame(camera, width, height),
    notify, download, storage: sessionStorage,
  });

  try {
    plan = initialPlan ?? persistence.load() ?? null;
  } catch {
    plan = null;
  }
  if (!plan) plan = createPattern();

  // ---- snapshot -----------------------------------------------------------

  /** Operable vertices/edges for the visible plan side, cached on compiled
   * identity + side so drags (notify per pointermove) never re-weld the mesh. */
  function currentEditTargets() {
    if (!compiled) return { vertices: [], edges: [] };
    if (editTargetsCache?.compiled === compiled && editTargetsCache?.side === planSide) return editTargetsCache.targets;
    const targets = editTargets(compiled, planSide);
    editTargetsCache = { compiled, side: planSide, targets };
    return targets;
  }

  function findEditTarget({ kind, key, identity }) {
    if (!compiled) return null;
    if (kind === 'face') {
      const face = compiled.baseFaces.find((f) => f.id === key);
      if (!face) return null;
      const point = [0, 1, 2].map((i) => face.points.reduce((sum, p) => sum + p[i], 0) / face.points.length);
      return { kind, key, identity: key, point, planeIds: [key], boundary: face.region === 'girdle', label: `切面 ${key}` };
    }
    const targets = currentEditTargets()[kind === 'vertex' ? 'vertices' : 'edges'];
    const target = targets.find((t) => identity ? t.identity === identity : t.key === key);
    if (!target) return null;
    const point = kind === 'vertex' ? target.point : target.a.map((x, i) => (x + target.b[i]) / 2);
    return { ...target, kind, point, label: kind === 'vertex' ? '已选交点' : '已选线段' };
  }

  function selectionSnapshot() {
    const target = editSelection ? findEditTarget(editSelection) : null;
    if (!target) return null;
    const mm = compiled.audit.mmPerUnit;
    const point = editDrag && editGhost ? [...editGhost.point, target.point[2]] : target.point;
    return { ...target, point, xMm: mm===null?null:point[0] * mm, yMm: mm===null?null:point[1] * mm };
  }

  function buildSnapshot() {
    if (compiled && dimensionCache?.compiled !== compiled) dimensionCache = { compiled, value: physicalDimensions(compiled) };
    const face = selectedIds.includes(selected) ? compiled?.faces.find((f) => f.id === selected) ?? null : null;
    const machine = face ? planeMachine(face, plan.machine.teeth) : null;
    const editable = !!(face && plan.planes.some((p) => p.id === selected) && !face.table);
    if (facetRowsCache?.compiled !== compiled || facetRowsCache?.search !== facetSearch) {
      facetRowsCache = { compiled, search: facetSearch, rows: compiled ? facetRows(compiled, plan.machine.teeth, facetSearch) : [] };
    }
    const rows = facetRowsCache.rows;
    const effective = new Set(compiled?.faces.map((f) => f.id) ?? []);
    const groups = groupsInPlan(plan)
      .map((g) => ({ name: g.name, count: g.ids.filter((id) => effective.has(id)).length }))
      .filter((g) => g.count > 0);
    return {
      version: ++snapshotVersion,
      plan,
      saveStatus, suspended,
      physicalDimensions: dimensionCache?.value,
      hasRecovery: !!recoveryData,
      indexGears: INDEX_GEARS,
      compatibility: compiled?.compatibility,
      bevelPolicies: { crown: bevelPolicy(plan, 'crown'), pavilion: bevelPolicy(plan, 'pavilion') },
      compiled,
      selectedFaceId: face?.id ?? null,
      selectedIds: [...selectedIds],
      selectedSet: Object.fromEntries(selectedIds.map((id) => [id, true])),
      multiSelectMode,
      planSide,
      groups,
      selectedFace: face,
      selectedMachine: machine,
      selectedEditable: editable,
      selectedHelp: face ? selectedHelpText(face) : '',
      view,
      workspace,
      lightlab: lightlab.getSnapshot(),
      material: { ...material },
      materials: MATERIALS.map((m) => ({ id: m.preset, label: m.label })),
      opticalEngine,
      opticalSettings: { ...opticalSettings },
      opticalPaused,
      opticalExpanded,
      allPolished,
      renderProgress,
      notice,
      modal,
      solveResult: solve,
      showHandles,
      facetSearch,
      camera: { ...camera, theta: -camera.yaw - Math.PI / 2, phi: Math.PI / 2 + camera.pitch },
      ghost: ghost ? [...ghost] : null,
      dragControlId: dragControl?.id ?? null,
      editTool,
      editSelection: selectionSnapshot(),
      editSettings: { ...editSettings },
      editFeedback,
      editBusy,
      pendingEdit: pendingEdit ? pendingEdit.result.diagnostics ?? pendingEdit.result.edit : null,
      editPreviewCompiled,
      mergePendingKey,
      editTargets: currentEditTargets(),
      editGhost: editGhost ? { ...editGhost, point: [...editGhost.point] } : null,
      editDragTarget: editDrag ? { kind: editDrag.kind, key: editDrag.key } : null,
      canUndo: history.length > 0,
      canRedo: future.length > 0,
      gearText: gearText(plan),
      density: plan.metadata?.density ?? 3,
      export96Disabled: false,
      export96Title: export96Title(plan.machine.teeth),
      footerState,
      metrics: compiled ? metricsRow(compiled) : null,
      solveBadge: '几何通过 · 工艺待核对',
      faceRows: rows,
      faceListCount: `${rows.length} / ${compiled?.faces.length ?? 0}`,
      hasReference: !!reference,
      referenceImage: reference,
      refParams: { ...refParams },
      refDrag,
      planView: { ...planView },
      drawerOpen,
    };
  }

  function notify() {
    if(disposed)return;
    snapshot = buildSnapshot();
    for (const l of listeners) l();
  }

  function announce(text, error = false) {
    notice = { text, error };
    notify();
  }

  function markStudy() {
  }

  // ---- compile pipeline -----------------------------------------------------

  /** A sane visible face on the current plan side (never the table). */
  function fallbackFaceId() {
    const onSide =
      planSide === 'pavilion' ? (f) => f.normal[2] < -0.1 && !f.table : (f) => f.normal[2] > 0.1 && !f.table;
    return compiled.faces.find(onSide)?.id ?? compiled.faces[0].id;
  }

  /** Selection is UI state, never history: prune vanished faces after each
   * compile and keep `selectedIds` ⊇ {selected} whenever it is non-empty. */
  function repairSelection() {
    const faceIds = new Set(compiled.faces.map((f) => f.id));
    selectedIds = selectedIds.filter((id) => faceIds.has(id));
    if (!faceIds.has(selected)) selected = fallbackFaceId();
    if (selectedIds.length && !selectedIds.includes(selected)) selected = selectedIds[selectedIds.length - 1];
    if (editSelection) editSelection = findEditTarget(editSelection);
  }

  function compile(next, { record = true, message, prepared = null, elapsedMs, cancelEdits = true } = {}) {
    if(disposed||suspended)return false;
    if (cancelEdits) invalidateEdits();
    clearTimeout(editPreviewTimer);
    editPreviewTimer = null;
    editPreviewCompiled = null;
    editDrag = null;
    editGhost = null;
    dragControl = null;
    ghost = null;
    const started = performance.now();
    try {
      const candidate = prepared ?? compilePlan(next);
      if (!candidate.audit.passed) throw new Error(candidate.audit.errors.join(' / '));
      if (record && compiled) {
        history.push(plan);
        if (history.length > 40) history.shift();
        future = [];
      }
      plan = candidate.plan;
      recoveryData=plan.recovery?.originalInput??recoveryData??persistence.recover?.();
      compiled = candidate;
      const facets=candidate.planes.map(p=>({id:p.id,normal:{x:p.normal[0],y:p.normal[1],z:p.normal[2]}}));
      const gears=[...new Set([...INDEX_GEARS,plan.machine.teeth])];
      compiled.compatibility={all:indexCompatibilityReport(facets,{gears}),final:indexCompatibilityReport(facets,{gears,scope:'final',effectiveFacetIds:candidate.faces.map(f=>f.id)})};
      planRevision++;
      mergePendingKey = null; // position-based keys may shift: never hold a stale pick
      repairSelection();
      const sequence=++saveSequence;
      try {
        const saving=persistence.save(plan);
        saveStatus=saving?.then?'保存中…':'已保存';
        if(saving?.then)saving.then(()=>{if(disposed||sequence!==saveSequence)return;saveStatus='已保存';notify();},error=>{if(disposed||sequence!==saveSequence)return;saveStatus='保存失败';announce(`保存失败：${error.message}。当前编辑仍在内存中。`,true);});
      } catch(error){saveStatus=`保存失败：${error.message}`;}
      footerState = footerStateText(plan, compiled, elapsedMs ?? performance.now() - started);
      if (prepared) footerState = footerState.replace('构建', '求解与复核');
      markStudy();
      updateOptical();
      announce(message ?? compiled.audit.warnings.join(' '));
      return true;
    } catch (e) {
      updateOptical();
      announce(`未应用：${e.message}。原设计保持不变。`, true);
      return false;
    }
  }

  function undo() {
    cancelEditDrag();
    if (!history.length) return;
    editFeedback = null;
    const prev = history.pop();
    future.push(plan);
    compile(prev, { record: false, message: '已撤销。' });
  }

  function redo() {
    cancelEditDrag();
    if (!future.length) return;
    editFeedback = null;
    const next = future.pop();
    history.push(plan);
    compile(next, { record: false, message: '已重做。' });
  }

  // ---- generators & construction parameters ---------------------------------

  function generateEight() {
    compile(createPattern({ density: snap0().density }), {
      message: '载入八向原创结构；不是视频设计的复刻。',
    });
  }

  function generateFive() {
    compile(createPattern({ teeth: 120, symmetry: 5, density: snap0().density }), {
      message: '已生成 120 齿五向结构，可保存计划、公共 Facet 文档和切磨 CSV。',
    });
  }

  function snap0() {
    return { density: plan.metadata?.density ?? 3 };
  }

  function regeneratePattern(template, density) {
    const pattern = createPattern({ teeth: template === 'five' ? 120 : 96, symmetry: template === 'five' ? 5 : 8, density: Number(density), sizeMm: plan.sizeMm });
    compile({ ...pattern, bevel: { ...plan.bevel } }, { message: '已重新生成整体图案；局部编辑已替换，可撤销。' });
  }

  function setDensity(density) {
    compile(
      createPattern({
        teeth: plan.machine.teeth,
        symmetry: plan.metadata?.symmetry ?? 8,
        sizeMm: plan.sizeMm,
        density: Number(density),
        frosted: plan.bevel.enabled,
      }),
      { message: '按所选密度重新生成；可撤销。' },
    );
  }

  function setSizeMm(sizeMm) {
    const value = Number(sizeMm);
    compile({ ...plan, sizeMm: value, ...(plan.mmPerUnit ? { mmPerUnit: plan.mmPerUnit * value / plan.sizeMm } : {}) });
  }

  function setIndexGear(teeth) {
    try { normalizeIndexTeeth(Number(teeth));return compile({...plan,machine:{...plan.machine,teeth:Number(teeth)}},{message:'已更换基准盘；实际平面、细面和尺度保持不变。'}); }
    catch(error){announce(error.message,true);return false;}
  }

  function setDirectionMode(mode) {
    if(!['integer','exact'].includes(mode))return false;
    return compile({...plan,machine:{...plan.machine,mode}},{message:mode==='exact'?'精确方向模式：保留小数索引。':'新操作优先整齿；已有方向保持不变。'});
  }

  function setPhysicalScale(value) {
    const mm=Number(value),unit=(plan.metadata?.sourceDocument?.stock?.size??2)/2;
    if(!Number.isFinite(mm)||mm<=0)return announce('毫米尺度必须为正数。',true);
    return compile({...plan,mmPerUnit:mm*unit},{message:'已显式标定毫米尺度，可撤销。'});
  }

  function calibrateWidth(widthMm) {
    try { return compile({ ...plan, mmPerUnit: scaleForWidth(compiled, widthMm) }, { message: '已标定实际尺寸；原坐标和来源保持不变，可撤销。' }); }
    catch (error) { announce(error.message, true); return false; }
  }

  function requireScale() {
    editFeedback = { blocked: true, text: '来源未提供毫米尺度，本次操作尚未执行。', ...editGuidance({ error: 'PHYSICAL_SCALE_REQUIRED' }) };
    modal = { kind: 'scale' };
    announce(editFeedback.text, true);
    return false;
  }

  function renamePlan(name) {
    return compile({ ...plan, name: String(name).trim() || plan.name }, { message: '已重命名。' });
  }

  function setBevelPolicy(side, patch) {
    if (compiled.audit.mmPerUnit === null && patch.enabled !== false) return requireScale();
    if (side === 'both') {
      return compile({ ...plan, bevel: { ...plan.bevel, ...patch, pavilion: { ...bevelPolicy(plan, 'pavilion'), ...patch } } });
    }
    const policy = { ...bevelPolicy(plan, side), ...patch };
    const bevel = side === 'pavilion' ? { ...plan.bevel, pavilion: policy } : { ...plan.bevel, ...policy };
    compile({ ...plan, bevel });
  }

  function setBevelEnabled(enabled, side = 'crown') {
    setBevelPolicy(side, { enabled: !!enabled });
  }

  function setBevelShoulder(shoulderMm, side = 'crown') {
    setBevelPolicy(side, { shoulderMm: Number(shoulderMm) });
  }

  function setBevelAlpha(alpha, side = 'crown') {
    setBevelPolicy(side, { alpha: Number(alpha) });
  }

  function setGlobalFrostedAlpha(alpha) {
    const value = Number(alpha);
    let next = { ...plan, bevel: { ...plan.bevel, alpha: value, pavilion: { ...bevelPolicy(plan, 'pavilion'), alpha: value } } };
    for (const plane of compiled.planes) {
      if (plane.finish.state === 'frosted') next = setFinish(next, plane.id, { ...plane.finish, alpha: value });
    }
    return compile(next, { message: '已更新整体磨砂粗糙度，可撤销。' });
  }

  function toggleHandles() {
    showHandles = !showHandles;
    notify();
  }

  // ---- selected facet ---------------------------------------------------------

  function select(id) {
    clearEditDrag();
    if (!compiled?.faces.some((f) => f.id === id)) return;
    selected = id;
    selectedIds = [id];
    editSelection = findEditTarget({ kind: 'face', key: id });
    editFeedback = null;
    markStudy();
    notify();
  }

  function toggleSelect(id) {
    clearEditDrag();
    if (!compiled?.faces.some((f) => f.id === id)) return;
    if (selectedIds.includes(id)) {
      selectedIds = selectedIds.filter((x) => x !== id);
      if (selected === id) selected = selectedIds[selectedIds.length - 1] ?? fallbackFaceId();
    } else {
      selectedIds = [...selectedIds, id];
      selected = id;
    }
    editSelection = selectedIds.length === 1 ? findEditTarget({ kind: 'face', key: selectedIds[0] }) : null;
    editFeedback = null;
    markStudy();
    notify();
  }

  function clearSelection() {
    clearEditDrag();
    selectedIds = [];
    selected = fallbackFaceId();
    editSelection = null;
    editFeedback = null;
    markStudy();
    notify();
  }

  function selectGroup(name) {
    clearEditDrag();
    const ids = groupsInPlan(plan)
      .find((g) => g.name === name)
      ?.ids.filter((id) => compiled.faces.some((f) => f.id === id));
    if (!ids?.length) return;
    selectedIds = ids;
    selected = ids[0];
    editSelection = null;
    editFeedback = null;
    markStudy();
    notify();
  }

  function toggleFaceGroup(ids) {
    clearEditDrag();
    const valid = ids.filter(id => compiled.faces.some(f => f.id === id));
    if (!valid.length) return;
    const allSelected = valid.every(id => selectedIds.includes(id));
    selectedIds = allSelected ? selectedIds.filter(id => !valid.includes(id)) : [...new Set([...selectedIds, ...valid])];
    selected = selectedIds.at(-1) ?? fallbackFaceId();
    editSelection = selectedIds.length === 1 ? findEditTarget({ kind: 'face', key: selected }) : null;
    editFeedback = null;
    markStudy();
    notify();
  }

  function setMultiSelectMode(on) {
    multiSelectMode = !!on;
    notify();
  }

  function setPlanSide(side) {
    if (!['crown', 'pavilion'].includes(side)) return;
    planSide = side;
    clearEditDrag();
    dragControl = null;
    ghost = null;
    mergePendingKey = null;
    editSelection = null;
    editFeedback = null;
    updateOptical();
    notify();
  }

  function setSelectedFinish(state) {
    const current = compiled.faces.find(face => face.id === selected)?.finish ?? {};
    compile(setFinish(plan, selected, { ...current, state, alpha: current.alpha > 0 ? current.alpha : plan.bevel?.alpha }), {
      message: '已更新该面身份的表面状态；几何和体材质未改变。',
    });
  }

  function setSelectedSurface(patch) {
    if (selectedIds.length !== 1) return false;
    const current = compiled.faces.find(face => face.id === selected)?.finish;
    if (!current) return false;
    const next = { ...current };
    for (const key of ['alpha', 'scatter']) if (patch[key] !== undefined) next[key] = patch[key];
    try {
      return compile(setFinish(plan, selected, next), { message: '已更新该面的粗糙度与表面散射，可撤销。' });
    } catch (error) {
      announce(`未应用：${error.message}。`, true);
      return false;
    }
  }

  function setFinishFor(ids, state) {
    const valid = ids.filter((id) => compiled.faces.some((f) => f.id === id));
    if (!valid.length) return;
    compile(setFinishMany(plan, valid, { state, alpha: plan.bevel.alpha }), {
      message: `已批量更新 ${valid.length} 个切面的表面状态；几何和体材质未改变。`,
    });
  }

  function invertFinishFor(ids) {
    const valid = ids.filter((id) => compiled.planes.some((p) => p.id === id));
    if (!valid.length) return;
    compile(invertFinishMany(plan, compiled.planes, valid), {
      message: `已反转 ${valid.length} 个切面的表面状态；几何和体材质未改变。`,
    });
  }

  function applyFacet({ index, angle, offset }) {
    const p = plan.planes.find((p) => p.id === selected);
    if (!p) return;
    try {
      if(plan.machine.mode==='integer'&&!Number.isInteger(Number(index)))throw new Error('本次切面修改需要整齿方向；可切换精确方向模式保留小数。');
      const normal = indexNormal(
        Number(index),
        Number(angle),
        planeMachine(p, plan.machine.teeth).region,
        plan.machine.teeth,
      );
      const q = { ...p, normal, offset: Number(offset) };
      delete q.control;
      delete q.generator;
      let next = { ...plan, planes: plan.planes.map((f) => (f.id === p.id ? q : f)) };
      let message;
      if (p.group) {
        next = dissolveGroup(next, p.group);
        message = `${p.group} 组已解除组合，可逐面编辑。`;
      }
      compile(next, { message });
    } catch (e) {
      announce(e.message, true);
    }
  }

  function setFacetSearch(q) {
    facetSearch = q;
    notify();
  }

  // ---- control-point drag -------------------------------------------------------

  function beginControlDrag(id, pointerPoint) {
    const control = plan.planes.find((p) => p.id === id)?.control;
    if (!control) return;
    select(id);
    dragControl = { id, origin: [...control], start: pointerPoint ? [...pointerPoint] : [...control] };
  }

  function controlTarget(x, y) {
    return dragControl.origin.map((v, i) => v + [x, y][i] - dragControl.start[i]);
  }

  function dragControlTo(x, y) {
    if (!dragControl) return;
    ghost = controlTarget(x, y);
    notify();
  }

  function endControlDrag(x, y) {
    if (!dragControl) return;
    const { id, start } = dragControl;
    const target = controlTarget(x, y);
    dragControl = null;
    ghost = null;
    if (Math.hypot(x - start[0], y - start[1]) < 1e-10) { notify(); return; }
    const before = plan.planes.find((p) => p.id === id);
    let next = moveControl(plan, id, ...target);
    if (before?.group) next = dissolveGroup(next, before.group);
    compile(next, { message: '已调整构造手柄；可撤销。' });
  }

  function cancelControlDrag() {
    dragControl = null;
    ghost = null;
    notify();
  }

  // ---- direct editing: one operation for dragging, coordinates and nudging ----

  function selectEditTarget(target) {
    clearEditDrag();
    editSelection = target ? findEditTarget(target) : null;
    editFeedback = null;
    if (editSelection) {
      const faceId = editSelection.kind === 'face' ? editSelection.key : editSelection.planeIds.includes(selected) ? selected : editSelection.planeIds.find((id) => {
        const f = compiled.baseFaces.find((f) => f.id === id);
        return planSide === 'crown' ? f?.normal[2] > 0 : f?.normal[2] < 0;
      });
      if (faceId) { selected = faceId; selectedIds = [faceId]; }
    }
    markStudy();
    notify();
  }

  function setEditSettings(patch) {
    clearEditDrag();
    if (['fixed', 'angle', 'topology'].includes(patch.mode)) editSettings.mode = patch.mode;
    for (const key of ['lockMergeHeight', 'snap']) if (typeof patch[key] === 'boolean') editSettings[key] = patch[key];
    if (Number.isFinite(Number(patch.angleLimit))) editSettings.angleLimit = Math.min(45, Math.max(0.01, Number(patch.angleLimit)));
    if (typeof patch.lockOutline === 'boolean') editSettings.lockOutline = patch.lockOutline;
    if (typeof patch.symmetry === 'boolean') editSettings.symmetry = patch.symmetry;
    if (patch.stepMm !== undefined) {
      const value = Number(patch.stepMm);
      if (Number.isFinite(value) && value >= 0.0001 && value <= 1) editSettings.stepMm = value;
    }
    editFeedback = null;
    updateOptical();
    notify();
  }

  function moveOperation(target, delta) {
    if (target.kind === 'vertex') return {
      kind: 'vertex.move', vertexKey: target.key,
      target: [target.point[0] + delta[0], target.point[1] + delta[1]],
    };
    return target.kind === 'edge'
      ? { kind: 'edge.move', edgeKey: target.key, delta }
      : { kind: 'face.move', faceId: target.key, delta };
  }

  function feedbackFor(result, preview = false) {
    if (result.error) return { limited: true, blocked: true, text: result.message, reason: result.message, details: result.details, ...editGuidance(result) };
    const info = { ...result.edit, ...result.diagnostics };
    const distance = Math.hypot(...(info.actualDelta ?? [0, 0])) * compiled.audit.mmPerUnit;
    const requested = Math.hypot(...(info.requestedDelta ?? [0, 0])) * compiled.audit.mmPerUnit;
    const formatDistance = value => value > 0 && value < 0.001 ? value.toPrecision(3) : value.toFixed(3);
    const changed = info.changedPlanes?.length ?? result.affectedIds?.length ?? 0;
    const detail = info.changedPlanes ? ` ${changed} 面联动 · 最大切角变化 ${(info.maxAngleDelta ?? 0).toFixed(4)}° · ${info.solveMs?.toFixed(0) ?? '—'} ms` : '';
    return {
      ...info, blocked: Boolean(result.unchanged) || (requested > 0 && distance < requested * 0.25),
      text: result.unchanged ? `当前方向无法继续移动。${info.reason ?? ''}`
        : `${preview ? '预览' : '已'}移动 ${formatDistance(distance)} mm${info.limited ? `（目标 ${formatDistance(requested)} mm）。${info.reason ?? ''}` : '。'}${detail}`,
    };
  }

  function invalidateEdits() {
    editEpoch++;
    editExecutor.cancel();
    editBusy = false;
    editCommitRunning = false;
    for (const job of editQueue) job.resolve(false);
    editQueue = [];
    pendingEdit = null;
    if (modal?.kind === 'edit-review') modal = null;
  }

  function clearEditDrag() {
    const hadPreview = !!editPreviewCompiled;
    invalidateEdits();
    clearTimeout(editPreviewTimer);
    editPreviewTimer = null;
    editDrag = null;
    editGhost = null;
    editPreviewCompiled = null;
    renderer?.setInteractive(false);
    if (hadPreview) updateOptical();
  }

  function beginEditDrag(target) {
    if (!target || !['vertex', 'edge', 'face'].includes(target.kind)) return;
    const found = findEditTarget(target);
    if (!found) return;
    clearEditDrag();
    editSelection = found;
    if (compiled.audit.mmPerUnit === null) return requireScale();
    const start = target.point ? target.point.slice(0, 2) : found.point.slice(0, 2);
    editDrag = { kind: found.kind, key: found.key, start, target: found, delta: [0, 0], result: null, request: 0, applied: 0 };
    editGhost = { kind: found.kind, key: found.key, start: found.point.slice(0, 2), point: found.point.slice(0, 2) };
    editFeedback = null;
    notify();
  }

  function settle(value, receive) {
    return value?.then ? value.then(receive, error => receive({ error: 'EDIT_FAILED', message: error.message })) : receive(value);
  }

  function requestEdit(op, preview = false) {
    if(disposed||suspended)return {cancelled:true};
    if(compiled.audit.mmPerUnit===null)return {error:'PHYSICAL_SCALE_REQUIRED',message:'来源缺少毫米尺度，请先标定实际尺寸。'};
    return editExecutor.run({ plan, op, settings: { ...editSettings, side: planSide }, revision: planRevision, preview });
  }

  function dragOperation(session, delta) {
    if (session.snapKey) return { kind: 'vertex.merge', vertexKeyA: session.target.key, vertexKeyB: session.snapKey };
    return moveOperation(session.target, delta);
  }

  function previewEdit() {
    editPreviewTimer = null;
    if (!editDrag) return;
    const session = editDrag, epoch = editEpoch, sequence = ++session.request;
    const delta = [...session.delta], snapKey = session.snapKey;
    editBusy = true;
    settle(requestEdit(dragOperation(session, delta), true), result => {
      // Like the accepted standalone page, show completed geometry throughout
      // the same gesture. A newer pointer position must not starve every reply.
      if (result.cancelled || epoch !== editEpoch || editDrag !== session || sequence <= session.applied) return;
      session.applied = sequence;
      editBusy = sequence < session.request;
      session.result = { delta, snapKey, value: result };
      editFeedback = feedbackFor(result, true);
      const actual = result.edit?.actualDelta ?? [0, 0];
      editGhost = {
        kind: session.kind, key: session.key, start: session.target.point.slice(0, 2), delta: actual,
        point: session.target.point.slice(0, 2).map((v, i) => v + actual[i]),
        requested: session.target.point.slice(0, 2).map((v, i) => v + session.delta[i]),
      };
      editPreviewCompiled = result.error || result.unchanged ? null : result.previewCompiled;
      updateOptical(); notify();
    });
  }

  function dragEditTo(x, y, snapKey = null) {
    if (!editDrag) return;
    editDrag.delta = [x - editDrag.start[0], y - editDrag.start[1]];
    editDrag.snapKey = editSettings.snap && editSettings.mode === 'topology' && editDrag.kind === 'vertex' ? snapKey : null;
    editGhost.requested = editDrag.target.point.slice(0, 2).map((v, i) => v + editDrag.delta[i]);
    if (!editPreviewTimer) editPreviewTimer = setTimeout(previewEdit, 16);
    notify();
  }

  function endEditDrag(x, y) {
    if (!editDrag) return false;
    const session = editDrag, delta = [x - editDrag.start[0], y - editDrag.start[1]], cached = session.result;
    const op = dragOperation(session, delta);
    clearEditDrag();
    if (Math.hypot(...delta) < 1e-10 && !session.snapKey) { updateOptical(); notify(); return false; }
    const result = cached && cached.snapKey === session.snapKey && cached.delta.every((v, i) => Math.abs(v - delta[i]) < 1e-10) ? cached.value : null;
    return enqueueEdit(() => applyEditOp(op, result));
  }

  function cancelEditDrag() {
    clearEditDrag(); editFeedback = null;
    updateOptical(); notify();
  }

  // Discrete input is FIFO, while pointer previews coalesce to the latest target.
  // The operation is constructed only when it runs, using the new selection.
  function enqueueEdit(action) {
    if (pendingEdit) return false;
    if (editCommitRunning) return new Promise(resolve => editQueue.push({ action, resolve }));
    const epoch = editEpoch;
    editCommitRunning = true;
    const finish = result => {
      if (epoch !== editEpoch) return false;
      editCommitRunning = false;
      if (pendingEdit) {
        for (const job of editQueue) job.resolve(false);
        editQueue = [];
      } else if (editQueue.length) {
        const job = editQueue.shift();
        settle(enqueueEdit(job.action), job.resolve);
      }
      return result;
    };
    return settle(action(), finish);
  }

  function moveSelectionBy(dxMm, dyMm) {
    if(compiled.audit.mmPerUnit===null)return requireScale();
    const numbers = [Number(dxMm), Number(dyMm)];
    if (!numbers.every(Number.isFinite)) return false;
    return enqueueEdit(() => {
      const target = editSelection ? findEditTarget(editSelection) : null;
      if (!target) return false;
      const delta = numbers.map(v => v / compiled.audit.mmPerUnit);
      return Math.hypot(...delta) < 1e-10 ? false : applyEditOp(moveOperation(target, delta));
    });
  }

  function setSelectionPosition(xMm, yMm) {
    if(compiled.audit.mmPerUnit===null)return requireScale();
    const numbers = [Number(xMm), Number(yMm)];
    if (!numbers.every(Number.isFinite)) return false;
    return enqueueEdit(() => {
      const target = editSelection ? findEditTarget(editSelection) : null;
      if (!target) return false;
      const delta = numbers.map((v, i) => v / compiled.audit.mmPerUnit - target.point[i]);
      return Math.hypot(...delta) < 1e-10 ? false : applyEditOp(moveOperation(target, delta));
    });
  }

  function nudgeSelection(dx, dy, multiplier = 1) {
    return moveSelectionBy(dx * editSettings.stepMm * multiplier, dy * editSettings.stepMm * multiplier);
  }

  function setEditTool(tool) {
    if (!['select', 'control', 'vertex', 'edge', 'face', 'merge'].includes(tool) || tool === editTool) return;
    clearEditDrag(); editTool = tool; mergePendingKey = null;
    dragControl = null; ghost = null; editFeedback = null;
    updateOptical(); notify();
  }

  function pickMergeVertex(key) {
    if (!key || key === mergePendingKey) { mergePendingKey = null; notify(); return false; }
    if (!mergePendingKey) { mergePendingKey = key; selectEditTarget({ kind: 'vertex', key }); return false; }
    const a = mergePendingKey; mergePendingKey = null;
    return mergeVertices(a, key);
  }

  function commitEdit(op, result) {
    if (op.kind === 'vertex.merge') editFeedback.text = `交点已合并。${editFeedback.text}`;
    const next = result.plan ?? { ...plan, planes: result.planes };
    const target = op.kind === 'vertex.merge' ? findEditTarget({ kind: 'vertex', key: op.vertexKeyB }) : null;
    const message = [editFeedback.text, ...(result.warnings ?? [])].join(' ');
    const ok = compile(next, { message, prepared: result.previewCompiled, elapsedMs: result.diagnostics?.solveMs, cancelEdits: false });
    if (ok && result.selectionRemap) {
      const remap = result.selectionRemap;
      editSelection = findEditTarget({ kind: remap.kind, key: remap.id ?? remap.key, identity: remap.identity });
    }
    if (ok && target && !editSelection) {
      const nearest = currentEditTargets().vertices.find(v => Math.hypot(...v.point.map((x, i) => x - target.point[i])) < 1e-7);
      editSelection = nearest ? { ...nearest, kind: 'vertex' } : null;
    }
    notify(); return ok;
  }

  function applyEditOp(op, prepared = null) {
    const epoch = editEpoch;
    editBusy = true; notify();
    return settle(prepared ?? requestEdit(op), result => {
      if (result.cancelled || epoch !== editEpoch) return false;
      editBusy = false;
      editFeedback = feedbackFor(result);
      if (result.error || result.unchanged) {
        updateOptical(); announce(result.error ? result.message : editFeedback.text, !!result.error); return false;
      }
      const lost = result.diagnostics?.lost ?? result.edit?.lost ?? [];
      if (lost.length) {
        pendingEdit = { op, result }; editPreviewCompiled = result.previewCompiled;
        modal = { kind: 'edit-review' }; updateOptical(); notify(); return false;
      }
      return commitEdit(op, result);
    });
  }

  function confirmEdit() {
    if (!pendingEdit) return false;
    const { op, result } = pendingEdit;
    pendingEdit = null; modal = null;
    return commitEdit(op, result);
  }

  function mergeVertices(keyA, keyB) {
    return enqueueEdit(() => applyEditOp({ kind: 'vertex.merge', vertexKeyA: keyA, vertexKeyB: keyB }));
  }

  // ---- plan-canvas zoom / pan (view state, no history) -------------------------

  /** Cursor-anchored zoom: factor is multiplicative, (cx, cy) and
   * (cssW, cssH) are canvas CSS px. Re-derives pan so the plan point under
   * the cursor stays under the cursor after clamping. */
  function zoomPlanAt(factor, cx, cy, cssW, cssH) {
    const base = planLayout(cssW, cssH, planSide);
    const l = viewLayout(base, planView);
    const zoom = clampZoom(planView.zoom * factor);
    const k = zoom / planView.zoom;
    planView = { zoom, panX: cx - k * (cx - l.x) - base.x, panY: cy - k * (cy - l.y) - base.y };
    notify();
  }

  function panPlanBy(dx, dy) {
    planView = { ...planView, panX: planView.panX + dx, panY: planView.panY + dy };
    notify();
  }

  function resetPlanView() {
    planView = { zoom: 1, panX: 0, panY: 0 };
    notify();
  }

  // ---- camera -------------------------------------------------------------------

  function paintCamera(interactive = false) {
    if (disposed || suspended) return;
    if (workspace === 'comparison') lightlab.cameraChanged(interactive);
    else if (renderer && view !== 'structure') {
      renderer.setInteractive(interactive);
      renderer.camera = viewportFrame(camera, opticalCanvas.clientWidth, opticalCanvas.clientHeight);
      renderer.reset();
      if (!opticalPaused) renderer.start(interactive ? 2 : view === 'surface' ? 8 : opticalSettings.samples);
    }
    notify();
  }

  function animateCamera() {
    if (disposed || suspended || cameraFrameId !== null) return;
    if (typeof requestAnimationFrame === 'undefined') {
      while (advanceViewportCamera(camera)) { /* deterministic non-browser verification */ }
      paintCamera(); return;
    }
    cameraFrameId = requestAnimationFrame(now => {
      cameraFrameId = null;
      const moving = advanceViewportCamera(camera, now);
      paintCamera(moving || !!rotationDrag);
      if (moving) animateCamera();
    });
  }

  function stopCamera() {
    if (cameraFrameId !== null) cancelAnimationFrame(cameraFrameId);
    cameraFrameId = null; rotationDrag = null;
    resetViewport(camera, camera); // Stop at the displayed pose, without a late target jump.
  }

  function beginCameraDrag(x, y) {
    if (disposed || suspended) return;
    rotationDrag = { x, y }; camera.transition = null;
  }
  function dragCameraTo(x, y, pan = false) {
    if (!rotationDrag || disposed || suspended) return;
    dragViewport(camera, x - rotationDrag.x, y - rotationDrag.y, pan);
    rotationDrag = { x, y }; animateCamera();
  }
  function endCameraDrag() { rotationDrag = null; animateCamera(); }
  function cancelCameraDrag() { stopCamera(); paintCamera(); }
  function resetCamera() { stopCamera(); resetViewport(camera, cameraHome); paintCamera(); }
  function cameraKey(key, shift) {
    if (disposed || suspended || !keyViewport(camera, key, shift, cameraHome)) return false;
    animateCamera(); return true;
  }

  // ---- optical view ---------------------------------------------------------------

  function opticalScene() {
    const scene = editPreviewCompiled ?? compiled;
    return !allPolished
      ? scene
      : { ...scene, planes: scene.planes.map((p) => ({ ...p, finish: { ...p.finish, state: 'polished', alpha: 0 } })) };
  }

  function onRendererProgress(p) {
    renderProgress = p.error ?? progressText(p, view);
    notify();
  }

  function ensureRenderer() {
    if (renderer || !opticalCanvas) return renderer;
    try {
      renderer = new RoughRenderer(opticalCanvas, onRendererProgress);
      resizeOptical();
    } catch (e) {
      renderer = null;
      announce(`光学视图不可用：${e.message}`, true);
    }
    return renderer;
  }

  function updateOptical() {
    if(disposed||suspended)return;
    lightlab.syncModel();
    if (workspace !== 'design') return;
    if (!renderer || view === 'structure') return;
    renderer.setInteractive(!!(editDrag || rotationDrag));
    renderer.setScene(opticalScene());
    renderer.setOptions({ ...opticalSettings, rotation: opticalSettings.rotation * Math.PI / 180 });
    renderer.camera = viewportFrame(camera, opticalCanvas.clientWidth, opticalCanvas.clientHeight);
    renderer.mode = view === 'surface' ? 1 : 0;
    renderer.engine = opticalEngine;
    renderer.material = {
      ...renderer.material,
      ior: material.ior,
      sigma: absorptionRGB(material),
      dispersion: material.dispersion,
      spectral: material.spectral,
    };
    renderer.reset();
    if (!opticalPaused) renderer.start(editDrag ? 2 : view === 'surface' ? 8 : opticalSettings.samples);
    else renderer.stop();
  }

  function setView(next) {
    view = next;
    if (next === 'structure') {
      if (opticalExpanded) setOpticalExpanded(false);
      renderer?.stop();
      renderProgress = '真实半空间几何';
      notify();
      return;
    }
    if (!ensureRenderer()) return;
    updateOptical();
    notify();
  }

  /** Whole-preset replace; keeps the 色散 toggle. */
  function setMaterialPreset(id) {
    material = { ...materialPreset(id), spectral: material.spectral };
    updateOptical();
    notify();
  }

  const MATERIAL_RANGES = { ior: [1.01, 3.5], dispersion: [0, 0.15], absorption: [0, 3], referenceMm: [1, 50] };

  /** Single-parameter edit (validated/clamped); flips the preset to custom. */
  function setMaterialParam(key, value) {
    if (key === 'bodyColor') {
      if (!/^#[0-9a-fA-F]{6}$/.test(String(value))) return;
      material = withCustomFlip(material, { bodyColor: String(value).toLowerCase() });
    } else if (key in MATERIAL_RANGES) {
      const [lo, hi] = MATERIAL_RANGES[key];
      const v = Number(value);
      if (!Number.isFinite(v)) return;
      material = withCustomFlip(material, { [key]: Math.min(hi, Math.max(lo, v)) });
    } else {
      return;
    }
    updateOptical();
    notify();
  }

  function setSpectral(on) {
    material = { ...material, spectral: !!on };
    updateOptical();
    notify();
  }

  function setOpticalEngine(next) {
    if (!['path', 'fast'].includes(next)) return;
    opticalEngine = next;
    updateOptical();
    notify();
  }

  function setAllPolished(next) {
    allPolished = !!next;
    updateOptical();
    notify();
  }

  function setOpticalSettings(patch) {
    const next = { ...opticalSettings };
    for (const key of ['nee', 'denoise', 'compare']) if (typeof patch[key] === 'boolean') next[key] = patch[key];
    const ranges = { env: [0, 2], rotation: [-360, 360], exposure: [-4, 4], budget: [16, 96], traversal: [0, 1] };
    for (const [key, [lo, hi]] of Object.entries(ranges)) if (patch[key] !== undefined && Number.isFinite(Number(patch[key]))) next[key] = Math.min(hi, Math.max(lo, Number(patch[key])));
    if ([128, 256, 384, 512, 768].includes(Number(patch.resolution))) next.resolution = Number(patch.resolution);
    if ([64, 128, 256, 512, 1024, 2048].includes(Number(patch.samples))) next.samples = Number(patch.samples);
    const changed = Object.keys(next).filter(key => next[key] !== opticalSettings[key]);
    opticalSettings = next;
    if (!changed.length) return;
    if (changed.includes('resolution') || changed.includes('compare')) resizeOptical();
    if (changed.every(key => ['denoise', 'exposure'].includes(key))) renderer?.setOptions(Object.fromEntries(changed.map(key => [key, next[key]])));
    else if (changed.every(key => key === 'samples')) { if (!opticalPaused) renderer?.start(next.samples); }
    else updateOptical();
    notify();
  }

  function setOpticalExpanded(expanded) {
    opticalExpanded = !!expanded;
    resizeOptical();
    updateOptical(); notify();
  }

  function setOpticalPaused(paused) {
    opticalPaused = !!paused;
    if (opticalPaused) renderer?.stop();
    else renderer?.start(view === 'surface' ? 8 : opticalSettings.samples);
    notify();
  }

  function setCameraTop() {
    setComparisonCamera('top');
  }

  function setWorkspace(next) {
    if(next==='comparison'&&compiled.audit.mmPerUnit===null)return requireScale();
    if (!['design', 'comparison'].includes(next) || workspace === next) return;
    cancelEditDrag();
    cancelControlDrag();
    cancelCameraDrag();
    workspace = next;
    opticalExpanded = false;
    drawerOpen = null;
    renderer?.stop();
    lightlab.setVisible(next === 'comparison');
    notify();
  }

  function setComparisonCamera(preset) {
    const angles = { top: 0, oblique: .65, side: Math.PI / 2, bottom: Math.PI };
    if (!(preset in angles)) return;
    stopCamera(); resetViewport(camera, { ...cameraHome, pitch: angles[preset] - Math.PI / 2 });
    paintCamera();
  }

  function zoomComparison(delta) {
    if (disposed || suspended) return;
    zoomViewport(camera, delta); animateCamera();
  }

  function setMaterialSigma(index, value) {
    const number = Number(value);
    if (![0, 1, 2].includes(index) || !Number.isFinite(number) || number < 0 || number > 100) return;
    const sigmaOverride = absorptionRGB(material); sigmaOverride[index] = number;
    material = { ...material, preset: 'custom', sigmaOverride };
    updateOptical(); notify();
  }

  function loadOpticalPreset(options) {
    if (!options) return;
    if (Number.isFinite(options.ior)) setMaterialParam('ior', options.ior);
    if (Number.isFinite(options.dispersion)) setMaterialParam('dispersion', options.dispersion);
    if (Array.isArray(options.sigma) && options.sigma.length === 3) options.sigma.forEach((value, index) => setMaterialSigma(index, value));
    if (typeof options.spectral === 'boolean') setSpectral(options.spectral);
    if ([0, 1].includes(options.integrator)) setOpticalEngine(options.integrator === 0 ? 'fast' : 'path');
    setOpticalSettings({ ...options, ...(Number.isFinite(options.rotation) ? { rotation: options.rotation * 180 / Math.PI } : {}) });
  }

  function saveOpticalPNG() {
    if (!opticalCanvas || !renderer) return;
    opticalCanvas.toBlob(blob => {
      if (!blob||disposed||suspended) return;
      download(`facet-optical-${opticalSettings.denoise ? 'display' : 'raw'}.png`, blob, 'image/png');
    }, 'image/png');
  }

  function resizeOptical() {
    if (!renderer || !opticalCanvas?.clientWidth || !opticalCanvas?.clientHeight) return;
    renderer.setInteractive(false);
    renderer.setSize(Math.round(opticalSettings.resolution * opticalCanvas.clientWidth / opticalCanvas.clientHeight), opticalSettings.resolution);
  }
  function opticalViewportChanged() { resizeOptical(); updateOptical(); }

  function attachOptical(canvas) {
    opticalCanvas = canvas;
    if (view !== 'structure' && !renderer) setView(view);
  }

  function detachOptical() {
    renderer?.dispose();
    renderer = null;
    opticalCanvas = null;
  }

  // ---- reference image ------------------------------------------------------------

  function loadReference(file) {
    if (!file) return;
    if (file.size > 8e6 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      announce('请使用 8 MB 以内的 PNG / JPEG / WebP。', true);
      return;
    }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      if(disposed){URL.revokeObjectURL(url);return;}
      reference = image;
      URL.revokeObjectURL(url);
      announce('本地图片已载入，保持宽高比；不会自动产生几何。');
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      announce('图片解码失败。', true);
    };
    image.src = url;
  }

  function setRefParam(key, value) {
    refParams = { ...refParams, [key]: Number(value) };
    notify();
  }

  function setRefDrag(on) {
    refDrag = !!on;
    notify();
  }

  /** Pan the reference image by a plan-space delta (screen y is flipped). */
  function moveRefBy(dx, dy) {
    refParams = { ...refParams, x: refParams.x + dx, y: refParams.y + dy };
    notify();
  }

  function resetRefPosition() {
    refParams = { ...refParams, x: 0, y: 0 };
    notify();
  }

  // ---- download / export ------------------------------------------------------------

  function download(name, text, type = 'application/json') {
    const u = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = u;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
  }

  function saveRecovery() {
    const original=recoveryData;
    if(original)download('facet-pattern-original-recovery.json',JSON.stringify(original,null,2));
  }

  function savePlan() {
    download('facet-pattern-plan.json', JSON.stringify(plan, null, 2));
  }

  function exportCutCSV() {
    try {
      download('facet-cut-parameters.csv', cutCSV(compiled), 'text/csv;charset=utf-8');
    } catch (e) {
      announce(e.message, true);
    }
  }

  function requestExport96() {
    modal = { kind: 'export96' };
    notify();
  }

  function confirmExport96() {
    try {
      download('pattern-editor96.json', JSON.stringify(exportEditor96(compiled, { acknowledgeWarnings: true }), null, 2));
      modal = null;
      notify();
    } catch (e) {
      announce(e.message, true);
    }
  }

  // ---- import & shared-node solve -----------------------------------------------------

  async function importJSON(file) {
    if (!file) return;
    if (file.size > 5e6) {
      announce('JSON 超过 5 MB。', true);
      return;
    }
    try {
      const data = JSON.parse(await file.text());
      if (data.kind === 'facet-projection-graph') await handleGraph(data);
      else loadDocument(data);
    } catch (e) {
      announce(`未导入：${e.message}`, true);
    }
  }

  function loadDocument(data) {
    try {
      const next = data?.kind === 'facet-96-document' ? importEditor96(data) : normalizeAnalyticPlan(data);
      const loaded = compile(next, { message: `${next.name ?? '计划'}已导入，可撤销。` });
      if (loaded) { planSide = 'crown'; facetSearch = ''; loadOpticalPreset(next.optics); select(fallbackFaceId()); }
      return loaded;
    } catch (e) {
      announce(`未导入：${e.message}。当前设计保持不变。`, true);
      return false;
    }
  }

  async function handleGraph(graph) {
    if(disposed||suspended)return;
    const epoch=++asyncEpoch;
    announce('正在求解共享节点……');
    await new Promise((r) => setTimeout(r, 20));
    if(disposed||suspended||epoch!==asyncEpoch)return;
    try {
      const started = performance.now();
      const r = solveProjectionGraph(graph);
      const body = {
        status: r.status,
        rank: r.rank,
        degreesOfFreedom: r.degreesOfFreedom,
        maxEqualityResidual: r.maxEqualityResidual,
        maxViolation: r.maxViolation,
        topologyMatched: r.topologyMatched,
        elapsedMs: performance.now() - started,
        note: '固定投影与分度，不是图片识别；可行性不是加工认证或最优性保证。',
      };
      solve = { result: r, body, canReplace: !!(r.ok && graph.machine.teeth === plan.machine.teeth) };
      modal = { kind: 'solve-result' };
      announce(r.ok ? '共享节点与投影拓扑检查通过。' : '求解未通过，设计未改变。', !r.ok);
    } catch (e) {
      announce(`约束图未应用：${e.message}`, true);
    }
  }

  async function runSharedExample() {
    try {
      const graph = (await import('../examples/shared-node-graph.json', { with: { type: 'json' } })).default;
      await handleGraph(graph);
    } catch (e) {
      announce(e.message, true);
    }
  }

  function downloadSolveResult() {
    if (!solve) return;
    download('projection-result.json', JSON.stringify(solve.result, null, 2));
  }

  function applySolvedCrown() {
    if (!solve?.canReplace) return;
    const r = solve.result;
    const lower = plan.planes.filter((p) => p.normal[2] < 0.1);
    const crown = r.planes.map((p) => ({ ...p, finish: { state: 'polished' } }));
    const next = {
      ...plan,
      planes: [...crown.filter((p) => p.table), ...lower, ...crown.filter((p) => !p.table)],
      surfaceOverrides: {},
      metadata: { ...plan.metadata, generator: 'shared-node-solver' },
    };
    if (compile(next, { message: '已应用联合求解冠部；亭、腰部参数保持。' })) {
      modal = null;
      notify();
    }
  }

  // ---- chrome ------------------------------------------------------------------------

  function openModal(kind) {
    modal = { kind };
    notify();
  }

  function closeModal() {
    if (!modal) return;
    if (modal.kind === 'edit-review') cancelEditDrag();
    modal = null;
    notify();
  }

  function openDrawer(which) {
    drawerOpen = drawerOpen === which ? null : which;
    notify();
  }

  function closeDrawers() {
    if (!drawerOpen) return;
    drawerOpen = null;
    notify();
  }

  // ---- keyboard ------------------------------------------------------------------------

  function onKeydown(e) {
    if(disposed||suspended)return;
    if (e.key === 'Escape') {
      lightlab.cancelLightDrag();
      if (editDrag || editGhost || editBusy) cancelEditDrag();
      if (dragControl) cancelControlDrag();
      if (mergePendingKey) {
        mergePendingKey = null;
        notify();
      }
      closeModal();
      closeDrawers();
      return;
    }
    if (modal) return;
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
    }
  }

  // ---- lifecycle ------------------------------------------------------------------------

  function start(target = window) {
    if (started) return;
    started = true;
    keyboardTarget=target;
    keyboardTarget.addEventListener('keydown', onKeydown);
    if(registerGlobal)window.FacetPatternLab = integrationAPI;
  }

  function setSuspended(value) {
    suspended=!!value;asyncEpoch++;
    if(suspended){stopCamera();cancelEditDrag();cancelControlDrag();renderer?.stop();lightlab.setVisible(false);}
    else {updateOptical();lightlab.setVisible(workspace==='comparison');}
    notify();
  }

  function dispose() {
    if(disposed)return;
    disposed=true;asyncEpoch++;stopCamera();invalidateEdits();
    clearEditDrag();
    editExecutor.dispose();
    started = false;
    if (typeof window !== 'undefined') {
      keyboardTarget?.removeEventListener('keydown', onKeydown);
      if (window.FacetPatternLab === integrationAPI) delete window.FacetPatternLab;
    }
    detachOptical();
    lightlab.dispose();
    listeners.clear();
  }

  // ---- integration surface -----------------------------------------------------------------

  const integrationAPI = Object.freeze({
    version: LAB_VERSION,
    getState: () => structuredClone({ plan, compiled, selectedFaceId: selected, view, material, allPolished }),
    getCompiled: () => compiled,
    exportDocument: () => structuredClone(exportEditor96(compiled,{acknowledgeWarnings:true})),
    exportPlan: () => JSON.stringify(plan, null, 2),
    exportEditor96: ({ acknowledgeWarnings = false } = {}) =>
      JSON.stringify(exportEditor96(compiled, { acknowledgeWarnings }), null, 2),
    loadPlan: (input) => loadDocument(input),
    solveGraph: (graph) => handleGraph(graph),
  });

  // ---- public controller API ------------------------------------------------------------------

  if (!compile(plan, { record: false })) throw new Error(snapshot?.notice.text??'无效的来源设计；原始记录保留。');
  loadOpticalPreset(plan.optics);
  if (selectedIds.length === 1) select(selectedIds[0]);

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,

    start,
    dispose,
    setSuspended,
    reportError: message => announce(message,true),
    exportDocument: integrationAPI.exportDocument,
    lightlab,
    setWorkspace,
    setComparisonCamera,
    zoomComparison,
    attachOptical, opticalViewportChanged,
    detachOptical,

    // history
    undo,
    redo,
    // generators & construction
    regeneratePattern,
    generateEight,
    generateFive,
    setDensity,
    setSizeMm,
    setIndexGear,
    setDirectionMode,
    setPhysicalScale, calibrateWidth,
    renamePlan,
    setBevelEnabled,
    setBevelShoulder,
    setBevelAlpha,
    setGlobalFrostedAlpha,
    toggleHandles,
    // selection
    select,
    toggleSelect,
    clearSelection,
    selectGroup,
    toggleFaceGroup,
    setMultiSelectMode,
    setPlanSide,
    setSelectedFinish,
    setSelectedSurface,
    setFinishFor,
    invertFinishFor,
    applyFacet,
    setFacetSearch,
    // plan-canvas drag
    beginControlDrag,
    dragControlTo,
    endControlDrag,
    cancelControlDrag,
    // geometry edit drag (original-mesh handles)
    selectEditTarget,
    setEditSettings,
    setSelectionPosition,
    moveSelectionBy,
    nudgeSelection,
    beginEditDrag,
    dragEditTo,
    endEditDrag,
    cancelEditDrag,
    mergeVertices,
    setEditTool,
    pickMergeVertex,
    confirmEdit,
    // plan-canvas zoom / pan
    zoomPlanAt,
    panPlanBy,
    resetPlanView,
    // camera
    resetCamera, cameraKey,
    beginCameraDrag,
    dragCameraTo,
    endCameraDrag,
    cancelCameraDrag,
    // optical
    setView,
    setMaterialPreset,
    setMaterialParam,
    setSpectral,
    setOpticalEngine,
    setAllPolished,
    setOpticalSettings,
    setOpticalPaused,
    setOpticalExpanded,
    setCameraTop,
    setMaterialSigma,
    saveOpticalPNG,
    // reference image
    loadReference,
    setRefParam,
    setRefDrag,
    moveRefBy,
    resetRefPosition,
    // import / export
    importJSON,
    loadDocument,
    savePlan,
    saveRecovery,
    exportCutCSV,
    requestExport96,
    confirmExport96,
    runSharedExample,
    downloadSolveResult,
    applySolvedCrown,
    // chrome
    openModal,
    closeModal,
    openDrawer,
    closeDrawers,
  };
}
