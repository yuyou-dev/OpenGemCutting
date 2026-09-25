import { useCallback, useEffect, useRef, useState } from 'react';
import { IconCamera, IconRestore, IconPlayerPause, IconPlayerPlay, IconAdjustmentsHorizontal } from '@tabler/icons-react';
import { DeferredRange, Toggle } from './controls.jsx';
import { LightingPanel } from './lightlab/LightingPanel.jsx';
import { RenderSettings } from './lightlab/RenderSettings.jsx';
import '../lightlab.css';
import { useViewportNavigation } from './useViewportNavigation.js';

const CAMERA_VIEWS = [['top', '顶视', 0], ['oblique', '斜视', .65], ['side', '侧视', Math.PI / 2], ['bottom', '底视', Math.PI]];

function OpticalCanvas({ api, controller }) {
  const ref = useRef(null);
  const navigation = useViewportNavigation(controller);
  const attach = useCallback(canvas => { ref.current = canvas; navigation.ref(canvas); api.attachCanvas('lightlab', canvas); }, [api, navigation.ref]);
  useEffect(() => {
    const canvas = ref.current;
    const resize = new ResizeObserver(([entry]) => api.setViewport('lightlab', entry.contentRect.width, entry.contentRect.height));
    resize.observe(canvas);
    return () => resize.disconnect();
  }, [api, controller]);
  return <canvas {...navigation} ref={attach} className="lightlab-optical-canvas" aria-label="LightLab 实时光学画面：拖动旋转，Shift 拖动平移，滚轮缩放，双击复位" />;
}

function MaterialPanel({ controller, snap, observation }) {
  const material = snap.material;
  return (
    <aside className="side-panel lightlab-material-panel" aria-label="宝石材质">
      <div className="design-section-heading"><h2>宝石材质</h2><span className="section-meta">体材质仅预览</span></div>
      {observation && <p className="field-note">观察环境使用无色 D 线，材质设置不生效。</p>}
      <fieldset className="lightlab-material-fields" disabled={observation}>
        <label className="select-field"><span>材质</span><select aria-label="材质" value={material.preset} onChange={(e) => controller.setMaterialPreset(e.target.value)}>{snap.materials.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
        <div className="field"><div className="field-top"><label>体色</label><div className="color-field"><code className="range-value">{material.bodyColor}</code><input type="color" aria-label="参考光程透过色" value={material.bodyColor} onChange={(e) => controller.setMaterialParam('bodyColor', e.target.value)} /></div></div></div>
        <DeferredRange label="吸收度" value={material.absorption} min={0} max={3} step={0.01} format={(v) => v.toFixed(2)} onCommit={(v) => controller.setMaterialParam('absorption', v)} />
        <DeferredRange label="折射率 n" value={material.ior} min={1.01} max={3.5} step={0.001} format={(v) => v.toFixed(3)} onCommit={(v) => controller.setMaterialParam('ior', v)} />
        <DeferredRange label="色散 Δn" value={material.dispersion} min={0} max={0.15} step={0.001} format={(v) => v.toFixed(3)} onCommit={(v) => controller.setMaterialParam('dispersion', v)} />
        <Toggle label="启用色散" checked={material.spectral} onChange={(v) => controller.setSpectral(v)} note="使用 610 / 550 / 460 nm 三波段近似。" />
        <DeferredRange label="参考光程" value={material.referenceMm} min={1} max={50} step={0.5} format={(v) => `${v.toFixed(1)} mm`} onCommit={(v) => controller.setMaterialParam('referenceMm', v)} />
      </fieldset>
      <section className="global-frosted-settings" aria-label="整体表面属性">
        <h3>整体表面</h3>
        <DeferredRange label="磨砂粗糙度" value={snap.plan.bevel.alpha} min={0.05} max={0.8} step={0.01} format={v => v.toFixed(2)} onCommit={v => controller.setGlobalFrostedAlpha(v)} />
        <p className="field-note">已有默认值，可直接使用。调整应用于全部磨砂面与细边，随设计保存；抛光面保持不变。</p>
      </section>
    </aside>
  );
}

export function OpticalComparison({ controller, snap }) {
  const state = snap.lightlab, api = controller.lightlab;
  const [dialog, setDialog] = useState(null);
  const exportRef = useCallback(canvas => api.attachCanvas('export', canvas), [api]);
  const observation = state.environment.observation.kind !== 'none';
  return <main id="comparison-workspace" className="optical-comparison" aria-label="光学对比工作区">
    <div className="layout lightlab-layout">
      <section className="center-workspace lightlab-center" aria-label="光学验证画面">
        <header className="lightlab-center-header">
          <h2>光学验证</h2>
          <span className={`lightlab-status-badge${state.paused ? '' : ' live'}`}>{state.paused ? '已暂停' : '实时'}</span>
          <div className="lightlab-surface-tabs segment" role="group" aria-label="表面模拟"><button className={!state.allPolished ? 'active' : ''} aria-pressed={!state.allPolished} onClick={() => api.setAllPolished(false)}>当前表面（含磨砂）</button><button className={state.allPolished ? 'active' : ''} aria-pressed={state.allPolished} onClick={() => api.setAllPolished(true)}>全抛光</button></div>
          <button className="button lightlab-render-settings" onClick={() => setDialog('render')}><IconAdjustmentsHorizontal size={17} /><span>成像设置</span></button>
        </header>
        <div className="lightlab-canvas-container"><OpticalCanvas api={api} controller={controller} /></div>
        <div className="lightlab-view-row"><div className="lightlab-camera-controls" role="group" aria-label="视角预设">{CAMERA_VIEWS.map(([id, label, phi]) => <button key={id} className="button" aria-pressed={Math.abs(snap.camera.phi - phi) < 1e-6 && Math.abs(snap.camera.theta + Math.PI / 2) < 1e-6} onClick={() => controller.setComparisonCamera(id)}>{label}</button>)}<button className="button" onClick={() => controller.setComparisonCamera('oblique')}><IconRestore size={16} />复位</button><button className="button" aria-pressed={state.paused} onClick={() => api.setPaused(!state.paused)}>{state.paused ? <IconPlayerPlay size={16} /> : <IconPlayerPause size={16} />}{state.paused ? '继续' : '暂停'}</button></div><button className="button lightlab-save-image" onClick={() => api.savePNG()} disabled={!state.liveReady}><IconCamera size={17} />保存图片</button></div>
        <div className="lightlab-center-status"><span>{state.progress}</span><span>{state.materialLabel}</span></div>
      </section>
      <LightingPanel api={api} state={state} />
      <MaterialPanel controller={controller} snap={snap} observation={observation} />
    </div>
    <canvas ref={exportRef} hidden aria-hidden="true" />
    {dialog === 'render' && <RenderSettings api={api} state={state} onClose={() => setDialog(null)} />}
  </main>;
}
