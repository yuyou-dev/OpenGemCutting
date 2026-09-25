import { useCallback, useEffect, useRef } from 'react';
import { Button, IconButton } from './controls.jsx';
import { SurfaceConsole } from './SurfaceConsole.jsx';
import { SelectedProperties, RegionProperties } from './ParametersPanel.jsx';
import { viewportFrame, solidFaces, projectSolid, SOLID_COLORS } from '../ui/solidView.js';

import { useViewportNavigation } from './useViewportNavigation.js';

const VIEWS = [['structure', '结构'], ['surface', '表面']];

function paintSolid(canvas, snap) {
  const compiled = snap.editPreviewCompiled ?? snap.compiled;
  if (!compiled || snap.view !== 'structure') return;
  const r = canvas.getBoundingClientRect();
  const dpi = Math.min(2, window.devicePixelRatio || 1);
  if (r.width < 4 || r.height < 4) return;
  if (canvas.width !== Math.round(r.width * dpi) || canvas.height !== Math.round(r.height * dpi)) {
    canvas.width = Math.round(r.width * dpi);
    canvas.height = Math.round(r.height * dpi);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpi, 0, 0, dpi, 0, 0);
  ctx.clearRect(0, 0, r.width, r.height);
  const frame = viewportFrame(snap.camera, r.width, r.height);
  for (const { face, brightness } of solidFaces(compiled, frame)) {
    ctx.beginPath();
    face.points.forEach((p, i) => { const [x, y] = projectSolid(r.width, r.height, frame, p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.closePath();
    ctx.fillStyle = snap.selectedSet[face.id] ? SOLID_COLORS.selectedFill : face.finish.state === 'frosted' ? SOLID_COLORS.frostedFill : `rgb(${brightness},${brightness},${brightness})`;
    ctx.fill();
    ctx.strokeStyle = SOLID_COLORS.stroke;
    ctx.lineWidth = 0.6;
    ctx.stroke();
  }
}

export function InspectionPanel({ controller, snap }) {
  const solidRef = useRef(null);
  const solidNavigation = useViewportNavigation(controller);
  const surfaceNavigation = useViewportNavigation(controller);
  const attachSolid = useCallback(el => { solidRef.current = el; solidNavigation.ref(el); }, [solidNavigation.ref]);
  const surfaceRef = useRef(null);
  const previewRef = useRef(null);
  const drawerRef = useRef(null);
  const snapRef = useRef(snap);
  snapRef.current = snap;
  const opticalRef = useCallback((el) => { surfaceRef.current = el; surfaceNavigation.ref(el); if (el) controller.attachOptical(el); else controller.detachOptical(); }, [controller, surfaceNavigation.ref]);

  useEffect(() => {
    if (!snap.opticalExpanded) return;
    const trigger = document.activeElement;
    previewRef.current?.querySelector('button')?.focus();
    return () => trigger?.focus?.();
  }, [snap.opticalExpanded]);

  useEffect(() => {
    const observer = new ResizeObserver(() => controller.opticalViewportChanged());
    observer.observe(surfaceRef.current);
    return () => observer.disconnect();
  }, [controller]);

  useEffect(() => { if (solidRef.current) paintSolid(solidRef.current, snapRef.current); },
    [snap.compiled, snap.editPreviewCompiled, snap.view, snap.selectedIds, snap.camera]);
  useEffect(() => {
    const canvas = solidRef.current;
    const observer = new ResizeObserver(() => paintSolid(canvas, snapRef.current));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (snap.drawerOpen !== 'right' || !window.matchMedia('(max-width: 1000px)').matches) return;
    const trigger = document.activeElement;
    drawerRef.current.querySelector('button').focus({ preventScroll: true });
    return () => trigger.focus({ preventScroll: true });
  }, [snap.drawerOpen]);

  return (
    <aside ref={drawerRef} className={`side-panel right-panel${snap.drawerOpen === 'right' ? ' open' : ''}`} aria-label="检视与属性">
      <div className="inspector-mobile-heading"><strong>检视与属性</strong><IconButton icon="close" label="关闭属性面板" onClick={() => controller.closeDrawers()} /></div>
      <section ref={previewRef} className={`fixed-preview${snap.opticalExpanded ? ' optical-expanded' : ''}`} aria-label="三维预览" role={snap.opticalExpanded ? 'dialog' : undefined} aria-modal={snap.opticalExpanded || undefined} onKeyDown={e => {
        if (e.key === 'Escape' && snap.opticalExpanded) { e.stopPropagation(); controller.setOpticalExpanded(false); }
        if (e.key === 'Tab' && snap.opticalExpanded) {
          const buttons = [...e.currentTarget.querySelectorAll('button, input, select')].filter(b => !b.disabled);
          if (e.shiftKey && document.activeElement === buttons[0]) { e.preventDefault(); buttons.at(-1)?.focus(); }
          else if (!e.shiftKey && document.activeElement === buttons.at(-1)) { e.preventDefault(); buttons[0]?.focus(); }
        }
      }}>
        <div className="preview-heading"><h2>{snap.view === 'structure' ? '三维检视' : '表面分区'}</h2>

        </div>
        <div className="inspector-tabs segment" role="tablist" aria-label="检视模式">
          {VIEWS.map(([id, label]) => <button key={id} role="tab" aria-selected={snap.view === id} className={snap.view === id ? 'active' : ''} title={id === 'surface' ? '查看磨砂与抛光表面分区' : label} onClick={() => controller.setView(id)}>{label}</button>)}
        </div>
        <div className="inspection-canvas-wrap">
          <canvas {...solidNavigation} ref={attachSolid} className="solid-canvas" hidden={snap.view !== 'structure'} aria-label="结构视图：拖动旋转，Shift 拖动平移，滚轮缩放" />
          <canvas {...surfaceNavigation} ref={opticalRef} className="optical-canvas" hidden={snap.view === 'structure'} aria-label="表面分区：拖动旋转，Shift 拖动平移，滚轮缩放" />
        </div>
        {snap.view !== 'structure' && <>
          <div className="preview-actions">
            <Button className="subtle small" label="俯视" onClick={() => controller.setCameraTop()} />
            <Button className="subtle small" label={snap.opticalPaused ? '继续' : '暂停'} onClick={() => controller.setOpticalPaused(!snap.opticalPaused)} />
            <Button className="subtle small" label="保存 PNG" onClick={() => controller.saveOpticalPNG()} />
          </div>
        </>}
        <p className="render-progress">{snap.view === 'structure' ? '拖动旋转 · Shift 平移 · 滚轮缩放 · 双击复位' : snap.renderProgress}</p>
      </section>
      <SurfaceConsole controller={controller} snap={snap} />
      <div className="panel-content inspector-content">
        <details className="geometry-disclosure"><summary>几何与工艺参数</summary><RegionProperties controller={controller} snap={snap} /></details>
        <SelectedProperties controller={controller} snap={snap} />
      </div>
    </aside>
  );
}
