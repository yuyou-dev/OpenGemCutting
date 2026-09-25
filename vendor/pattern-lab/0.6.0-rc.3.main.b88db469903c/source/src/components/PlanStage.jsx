import { useEffect, useRef } from 'react';
import { ToolRail } from './ToolRail.jsx';
import { Button, Toggle, DeferredNumber } from './controls.jsx';
import {
  GUIDE_RADII,
  PLAN_COLORS,
  planLayout,
  viewLayout,
  projectPlan,
  unprojectPlan,
  planSidePredicate,
  hitTestFace,
  hitTestControl,
  hitTestVertex,
  hitTestPlanEdit,
  previewTargetPoints,
} from '../ui/planView.js';
import { beginPointerSession, advancePointerSession, planNudgeForKey } from '../ui/planInteraction.js';

function canvasContext(canvas) {
  const r = canvas.getBoundingClientRect();
  const dpi = Math.min(2, window.devicePixelRatio || 1);
  if (canvas.width !== Math.round(r.width * dpi) || canvas.height !== Math.round(r.height * dpi)) {
    canvas.width = Math.round(r.width * dpi);
    canvas.height = Math.round(r.height * dpi);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpi, 0, 0, dpi, 0, 0);
  ctx.clearRect(0, 0, r.width, r.height);
  return { ctx, w: r.width, h: r.height };
}

function paintPlan(canvas, snap) {
  if (!snap.compiled) return;
  const { ctx, w, h } = canvasContext(canvas);
  if (w < 4 || h < 4) return;
  const side = snap.planSide;
  const l = viewLayout(planLayout(w, h, side), snap.planView);
  const pt = (p) => projectPlan(l, p);
  const { plan, compiled, selectedFaceId, selectedSet, showHandles, ghost } = snap;
  const reference = snap.referenceImage;
  const ref = snap.refParams;

  ctx.save();
  ctx.strokeStyle = PLAN_COLORS.guide;
  ctx.lineWidth = 0.7;
  ctx.setLineDash([3, 5]);
  for (const r of GUIDE_RADII) {
    ctx.beginPath();
    ctx.arc(l.x, l.y, r * l.s, 0, 2 * Math.PI);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(l.x - 1.14 * l.s, l.y);
  ctx.lineTo(l.x + 1.14 * l.s, l.y);
  ctx.moveTo(l.x, l.y - 1.14 * l.s);
  ctx.lineTo(l.x, l.y + 1.14 * l.s);
  ctx.stroke();
  ctx.restore();

  if (reference) {
    ctx.save();
    ctx.translate(l.x + ref.x * l.s, l.y - ref.y * l.s);
    ctx.rotate((-ref.rotation * Math.PI) / 180);
    ctx.globalAlpha = ref.opacity;
    const rw = 2 * l.s * ref.scale;
    const rh = (rw * reference.height) / reference.width;
    ctx.drawImage(reference, -rw / 2, -rh / 2, rw, rh);
    ctx.restore();
  }

  const preview = snap.editPreviewCompiled;
  const rendered = preview ?? compiled;
  for (const f of (rendered.faces ?? rendered.baseFaces).filter(planSidePredicate(side))) {
    ctx.beginPath();
    f.points.forEach((p, i) => {
      const [a, b] = pt(p);
      i ? ctx.lineTo(a, b) : ctx.moveTo(a, b);
    });
    ctx.closePath();
    const frosted = f.finish?.state === 'frosted';
    const selected = f.id === selectedFaceId;
    const multi = !selected && !!selectedSet?.[f.id];
    ctx.fillStyle = selected
      ? PLAN_COLORS.selectedFill
      : multi
        ? PLAN_COLORS.multiFill
        : frosted
          ? PLAN_COLORS.frostedFill
          : reference
            ? PLAN_COLORS.faceFillWithReference
            : PLAN_COLORS.faceFill;
    ctx.fill();
    ctx.lineWidth = selected ? 1.1 : 0.65;
    ctx.strokeStyle = selected ? PLAN_COLORS.selectedStroke : frosted ? PLAN_COLORS.frostedStroke : PLAN_COLORS.faceStroke;
    ctx.stroke();
  }

  const tool = snap.editTool;
  const selection = snap.editSelection;
  const targets = snap.editTargets;
  if (snap.editSettings?.lockOutline && targets && !preview) {
    ctx.save();
    ctx.strokeStyle = PLAN_COLORS.lockedOutline;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    for (const e of targets.edges.filter((e) => e.boundary)) {
      const [ax, ay] = pt(e.a);
      const [bx, by] = pt(e.b);
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
    }
    ctx.stroke();
    ctx.restore();
  }
  if (tool === 'edge' && targets && !preview) {
    ctx.save();
    ctx.strokeStyle = PLAN_COLORS.editEdge;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    for (const e of targets.edges) {
      const [ax, ay] = pt(e.a);
      const [bx, by] = pt(e.b);
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
    }
    ctx.stroke();
    ctx.restore();
  }

  if ((tool === 'vertex' || tool === 'merge' || tool === 'face') && targets)
    for (const v of targets.vertices) {
      if (tool === 'face' && !v.planeIds.includes(selectedFaceId)) continue;
      const point = preview ? previewTargetPoints(preview, v)[0] : v.point;
      if (!point) continue;
      const [a, b] = pt(point);
      const pending = tool === 'merge' && v.key === snap.mergePendingKey;
      const selected = selection?.kind === 'vertex' && selection.key === v.key;
      ctx.beginPath();
      ctx.arc(a, b, selected || pending ? 4.5 : 2.8, 0, 2 * Math.PI);
      ctx.fillStyle = selected || pending ? PLAN_COLORS.selectedStroke : PLAN_COLORS.editHandle;
      ctx.fill();
      ctx.strokeStyle = selected || pending ? PLAN_COLORS.controlRing : PLAN_COLORS.editHandleRing;
      ctx.lineWidth = selected || pending ? 1.5 : 0.7;
      ctx.stroke();
    }

  if (selection?.kind === 'edge' && targets) {
    const edge = targets.edges.find((e) => e.key === selection.key);
    const points = edge ? (preview ? previewTargetPoints(preview, edge) : [edge.a, edge.b]) : [];
    if (points.length >= 2) {
      ctx.save();
      ctx.strokeStyle = PLAN_COLORS.selectedStroke;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(...pt(points[0]));
      ctx.lineTo(...pt(points[1]));
      ctx.stroke();
      ctx.restore();
    }
  }

  if (tool === 'control' && showHandles && side === 'crown')
    for (const p of plan.planes.filter((p) => p.control)) {
      const [a, b] = pt(p.control);
      const selected = p.id === selectedFaceId;
      ctx.beginPath();
      ctx.arc(a, b, selected ? 4 : 2.1, 0, 2 * Math.PI);
      ctx.fillStyle = selected ? PLAN_COLORS.controlSelected : PLAN_COLORS.control;
      ctx.fill();
      ctx.strokeStyle = PLAN_COLORS.controlRing;
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }

  if (ghost) {
    const [a, b] = pt(ghost);
    ctx.beginPath();
    ctx.arc(a, b, 7, 0, 2 * Math.PI);
    ctx.strokeStyle = PLAN_COLORS.ghost;
    ctx.lineWidth = 1.3;
    ctx.stroke();
  }

  const editGhost = snap.editGhost;
  if (editGhost) {
    ctx.save();
    ctx.strokeStyle = PLAN_COLORS.ghost;
    const [a, b] = pt(editGhost.point);
    ctx.beginPath();
    ctx.arc(a, b, 7, 0, 2 * Math.PI);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    if (editGhost.requested) {
      const [x, y] = pt(editGhost.requested);
      if (Math.hypot(x - a, y - b) > 3) {
        ctx.strokeStyle = PLAN_COLORS.requested;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(a, b);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, 2 * Math.PI);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  ctx.fillStyle = PLAN_COLORS.caption;
  ctx.font = '9px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(plan.sizeMm===null?'毫米尺度未标定':`最大 X/Y 尺寸 ${plan.sizeMm.toFixed(1)} mm`, w / 2, h - 18);
}

export function PlanStage({ controller, snap }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const optionsRef = useRef(null);
  const snapRef = useRef(snap);
  snapRef.current = snap;
  // A pointerdown selects; only motion beyond the screen-space threshold edits.
  const dragRef = useRef(null);
  const paintFrame = useRef(null);

  useEffect(() => {
    const options = optionsRef.current;
    const doc = options.ownerDocument;
    const dismiss = event => {
      if (!options.contains(event.target)) options.open = false;
    };
    const onKey = event => {
      if (event.key === 'Escape' && options.open) {
        options.open = false;
        options.querySelector('summary').focus();
      }
    };
    doc.addEventListener('pointerdown', dismiss, true);
    doc.addEventListener('keydown', onKey);
    return () => {
      doc.removeEventListener('pointerdown', dismiss, true);
      doc.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    if (paintFrame.current === null) paintFrame.current = requestAnimationFrame(() => {
      paintFrame.current = null;
      if (canvasRef.current) paintPlan(canvasRef.current, snapRef.current);
    });
  });
  useEffect(() => () => cancelAnimationFrame(paintFrame.current), []);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver(() => {
      if (canvasRef.current) paintPlan(canvasRef.current, snapRef.current);
    });
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  // React wheel listeners are passive; attach our own so preventDefault works.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e) => {
      e.preventDefault();
      if (dragRef.current) return;
      const r = canvas.getBoundingClientRect();
      controller.zoomPlanAt(Math.exp(-e.deltaY * 0.0012), e.clientX - r.left, e.clientY - r.top, r.width, r.height);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [controller]);

  function planPoint(e) {
    const canvas = canvasRef.current;
    const r = canvas.getBoundingClientRect();
    const l = viewLayout(planLayout(r.width, r.height, snapRef.current.planSide), snapRef.current.planView);
    return { l, p: unprojectPlan(l, e.clientX - r.left, e.clientY - r.top) };
  }

  function onPointerDown(e) {
    if (!e.isPrimary || dragRef.current || (e.button !== 0 && e.button !== 1)) return;
    const { l, p } = planPoint(e);
    const snap = snapRef.current;
    const tool = snap.editTool;
    canvasRef.current.focus({ preventScroll: true });
    canvasRef.current.setPointerCapture(e.pointerId);
    const session = (kind, data = {}) => beginPointerSession(kind, e.clientX, e.clientY, {
      pointerId: e.pointerId, point: p, button: e.button, ...data,
    });
    if (e.button === 1) {
      e.preventDefault();
      dragRef.current = session('pan');
      return;
    }
    if (tool === 'vertex' || tool === 'edge' || tool === 'face') {
      const hit = hitTestPlanEdit(tool, snap.compiled, snap.editTargets, l, p, snap.planSide, snap.selectedFaceId, {
        shiftKey: e.shiftKey, multiSelectMode: snap.multiSelectMode,
      });
      if (hit) {
        controller.selectEditTarget(hit);
        dragRef.current = session('edit', { target: hit });
        return;
      }
    } else if (tool === 'merge') {
      const hit = hitTestVertex(snap.editTargets, l, p);
      if (hit) {
        dragRef.current = session('merge', { key: hit.key });
        return;
      }
    } else if (tool === 'control') {
      const control = snap.showHandles && snap.planSide === 'crown' ? hitTestControl(snap.plan, l, p) : null;
      if (control) {
        controller.select(control.id);
        dragRef.current = session('control', { controlId: control.id });
        return;
      }
    }
    dragRef.current = session(snap.refDrag && snap.hasReference ? 'ref' : 'pan');
  }

  function advanceDrag(e) {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return null;
    if (e.clientX === d.last[0] && e.clientY === d.last[1]) return d;
    const { session, started, delta } = advancePointerSession(d, e.clientX, e.clientY);
    dragRef.current = session;
    if (!session.active) return session;
    if (started && d.kind === 'control') controller.beginControlDrag(d.controlId, d.point);
    if (started && d.kind === 'edit') controller.beginEditDrag({ ...d.target, point: d.point });
    if (d.kind === 'control') controller.dragControlTo(...planPoint(e).p);
    else if (d.kind === 'edit') {
      const { l, p } = planPoint(e), snap = snapRef.current;
      const hit = d.target.kind === 'vertex' && snap.editSettings.snap && snap.editSettings.mode === 'topology'
        ? hitTestVertex({ vertices: snap.editTargets.vertices.filter(v => v.key !== d.target.key) }, l, p, 8) : null;
      controller.dragEditTo(...p, hit?.key ?? null);
    }
    else if (d.kind === 'ref') {
      const { l } = planPoint(e);
      controller.moveRefBy(delta[0] / l.s, -delta[1] / l.s);
    } else if (d.kind === 'pan') {
      controller.panPlanBy(...delta);
    }
    return session;
  }

  function onPointerMove(e) {
    advanceDrag(e);
  }

  function onPointerUp(e) {
    const d = advanceDrag(e);
    if (!d) return;
    dragRef.current = null;
    canvasRef.current.releasePointerCapture(e.pointerId);
    if (d.kind === 'control') {
      if (d.active) controller.endControlDrag(...planPoint(e).p);
      return;
    }
    if (d.kind === 'edit') {
      if (d.active) controller.endEditDrag(...planPoint(e).p);
      return;
    }
    if (d.active || d.button !== 0) return;
    if (d.kind === 'merge') {
      controller.pickMergeVertex(d.key);
      return;
    }
    const snap = snapRef.current;
    const { p } = planPoint(e);
    const f = hitTestFace(snap.compiled, p, snap.planSide);
    if (f) (e.shiftKey || snap.multiSelectMode ? controller.toggleSelect : controller.select)(f.id);
    else {
      if (snap.editTool === 'merge') controller.pickMergeVertex(null); // empty click disarms the pick
      if (!e.shiftKey && !snap.multiSelectMode) {
        controller.selectEditTarget(null);
        controller.clearSelection();
      }
    }
  }

  function onPointerCancel() {
    dragRef.current = null;
    controller.cancelEditDrag();
    controller.cancelControlDrag();
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onPointerCancel();
      if (snapRef.current.editTool === 'merge') controller.pickMergeVertex(null);
      return;
    }
    if (dragRef.current || !snapRef.current.editSelection) return;
    const nudge = planNudgeForKey(e.key, {
      side: snapRef.current.planSide, shiftKey: e.shiftKey, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey,
    });
    if (nudge) {
      e.preventDefault();
      controller.nudgeSelection(nudge.dx, nudge.dy, nudge.multiplier);
    }
  }

  const pavilion = snap.planSide === 'pavilion';
  const toolHint =
    {
      select: '点选切面，Shift 多选',
      control: !pavilion && snap.showHandles ? '拖动粉色生成控制点重排图案' : '生成控制点仅在冠部显示',
      vertex: '点选交点后拖动或用方向键微调',
      edge: '点选棱线后拖动或用方向键微调',
      face: '拖动面内移动整面，拖动已选面的边界调整轮廓',
      merge: '依次点选起点 A 与目标 B，合并后显示真实拓扑变化',
    }[snap.editTool] ?? '';
  const feedback = snap.editFeedback;

  return (
    <section className="center-workspace plan-stage">
      <div className="panel-title canvas-toolbar">
        <ToolRail controller={controller} snap={snap} />
        <div className="toolbar-multiselect"><Toggle label="多选模式" checked={snap.multiSelectMode} onChange={value => controller.setMultiSelectMode(value)} /></div>
        <span className="stage-title">{pavilion ? '亭部仰视图' : '冠部平面图'}</span>
        <span className="edit-busy" aria-live="polite">{snap.editBusy ? '正在计算…' : ''}</span>
        <div className="canvas-view-tools"><div className="segment plan-side-tabs" role="tablist" aria-label="平面图方向">
          <button role="tab" aria-selected={!pavilion} className={pavilion ? '' : 'active'} onClick={() => controller.setPlanSide('crown')}>
            冠部
          </button>
          <button role="tab" aria-selected={pavilion} className={pavilion ? 'active' : ''} onClick={() => controller.setPlanSide('pavilion')}>
            亭部
          </button>
        </div>

        <details ref={optionsRef} className="edit-options"><summary>编辑设置</summary><div className="edit-options-popover">
        <label className="edit-mode-label">编辑模式<select aria-label="编辑模式" value={snap.editSettings.mode} onChange={e => controller.setEditSettings({ mode: e.target.value })}>
          <option value="fixed">固定切角微调</option><option value="angle">切角联动 · 保留拓扑</option><option value="topology">切角联动 · 允许合并</option>
        </select></label>
        <label className="toolbar-step">步长<select aria-label="微调步长" value={snap.editSettings.stepMm} onChange={(e) => controller.setEditSettings({ stepMm: Number(e.target.value) })}>{[0.001,0.005,0.01,0.05,0.1].map((v) => <option key={v} value={v}>{v} mm</option>)}</select></label>
        <div className="edit-guards"><Toggle label="锁定腰平面" checked={snap.editSettings.lockOutline} onChange={(lockOutline) => controller.setEditSettings({ lockOutline })} /><Toggle label="对称编辑" checked={snap.editSettings.symmetry} onChange={(symmetry) => controller.setEditSettings({ symmetry })} /></div>
          <DeferredNumber label="单次切角上限" value={snap.editSettings.angleLimit} min={0.01} max={45} step={0.1} unit="°" disabled={snap.editSettings.mode === 'fixed'} onCommit={angleLimit => controller.setEditSettings({ angleLimit })} />
          <Toggle label="保持合并目标 B 的高度" checked={snap.editSettings.lockMergeHeight} onChange={lockMergeHeight => controller.setEditSettings({ lockMergeHeight })} />
          <Toggle label="拖动吸附并合并交点" checked={snap.editSettings.snap} disabled={snap.editSettings.mode !== 'topology'} onChange={snap => controller.setEditSettings({ snap })} />
          <p className="field-note">腰平面锁定限制外扩，不固定腰部交点高度。切角联动完整到达请求位置；约束不相容时保留原设计。</p>
        </div></details>
        </div>
      </div>
      {snap.compiled.audit.mmPerUnit === null && <div className="scale-prompt" role="note"><div><strong>先标定实际尺寸</strong><span>来源没有毫米尺度。点线面编辑、磨砂细边与光学验证需要实测尺寸。</span></div><Button label="标定尺寸" onClick={() => controller.openModal('scale')} /></div>}
      <div className="plan-canvas-wrap" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          className="plan-canvas"
          tabIndex={0}
          aria-label={`${pavilion ? '亭部仰视图' : '冠部平面图'}：${toolHint}。滚轮缩放，空白处拖动平移。方向键微调，Shift 十倍步长，Esc 取消拖动。`}
          aria-describedby="plan-feedback"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onLostPointerCapture={() => { if (dragRef.current) onPointerCancel(); }}
          onKeyDown={onKeyDown}
        />
        <div className="plan-zoom-controls" aria-label="平面图缩放">
          <span className="zoom-readout">{Math.round(snap.planView.zoom * 100)}%</span>
          <Button className="subtle small reset-view" label="适合视图" onClick={() => controller.resetPlanView()} />
        </div>
      </div>
      <div id="plan-feedback" className={`notice${snap.notice.error ? ' error' : ''}${feedback?.blocked ? ' is-limited' : ''}`} role="status" aria-live="polite">
        <span>{feedback?.text || snap.notice.text || toolHint}{feedback?.next && <small className="edit-next-step">{feedback.next}</small>}{snap.editSelection?.boundary && snap.editSettings.lockOutline && !feedback?.next && <small className="edit-next-step">所选对象位于腰部边界，腰平面锁定限制外扩。可沿边界移动；如需外扩，请先核对编辑约束。</small>}</span>
        {feedback?.action === 'scale' && <Button className="subtle small" label="标定尺寸" onClick={() => controller.openModal('scale')} />}
        {feedback?.action === 'constraints' && <Button className="subtle small" label="查看约束" onClick={() => { const details = wrapRef.current.parentElement.querySelector('.edit-options'); details.open = true; details.querySelector('summary').focus(); }} />}
        {feedback?.changedPlanes?.length > 0 && <Button className="subtle small" label="本次变化" onClick={() => controller.openModal('edit-details')} />}
      </div>
    </section>
  );
}
