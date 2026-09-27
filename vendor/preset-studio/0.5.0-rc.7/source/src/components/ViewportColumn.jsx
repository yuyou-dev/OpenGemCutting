import { modelUnits } from '../application/units.js';
import { IconArrowBackUp, IconArrowForwardUp, IconLayoutGrid, IconTrash } from '@tabler/icons-react';
import { AxialInstrument } from './AxialInstrument.jsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { SolidViewport, drawOrthographic } from '../viewport/viewport.js';
import { watchPixelDensity } from '../viewport/canvas-resolution.js';
import { componentPreview } from '../domain/generators.js';
import { transformPoint } from '../domain/math.js';

const STOCK_OPTIONS = [['preform', '圆形底胚'], ['cube', '方形底胚'], ['crystal', '原始晶体 · 示例'], ['imported', '导入晶体 / 文档']];
const SOLID_VIEWS = [['iso', '立体'], ['top', '顶'], ['bottom', '底'], ['side', '侧']];

function Minis({ polys }) {
    const containerRef = useRef(null);
    const topRef = useRef(null), bottomRef = useRef(null), sideRef = useRef(null);
    useEffect(() => {
        const canvases = [['top', topRef.current], ['bottom', bottomRef.current], ['side', sideRef.current]];
        const redraw = () => requestAnimationFrame(() => { for (const [view, canvas] of canvases)
            drawOrthographic(canvas, polys, view); });
        redraw();
        const observer = new ResizeObserver(redraw);
        observer.observe(containerRef.current);
        const stopDensity = watchPixelDensity(redraw);
        return () => { observer.disconnect(); stopDensity(); };
    }, [polys]);
    return <div className="ps-minis" ref={containerRef}>
        <div className="ps-mini"><span>冠部投影 / TOP</span><canvas ref={topRef} /></div>
        <div className="ps-mini"><span>亭部投影 / BOTTOM</span><canvas ref={bottomRef} /></div>
        <div className="ps-mini"><span>侧面 / PROFILE</span><canvas ref={sideRef} /></div>
    </div>;
}

function Operations({ store, model, preview, session, children }) {
    const menu = useRef(null);
    useEffect(() => {
        const dismiss = e => { if (!menu.current?.contains(e.target)) menu.current.open = false; };
        const escape = e => { if (e.key === 'Escape' && menu.current.open) { menu.current.open = false; menu.current.querySelector('summary').focus(); } };
        document.addEventListener('pointerdown', dismiss);
        document.addEventListener('keydown', escape);
        return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); };
    }, []);
    return <div className="ps-workspace-tools">
        <details ref={menu} className="ps-operations-menu">
            <summary>组件工序 <small>{model.groups.length} 组</small></summary>
            <div className="ps-operation-list">
                {model.basePlanes.length ? <small>{model.basePlanes.length} 原有平面</small> : null}
                {model.groups.map(g => <div key={g.id} className={`ps-group${model.editId === g.id ? ' is-active' : ''}`}>
                    <button type="button" disabled={preview.pendingApply} onClick={() => store.selectGroup(g.id)}>{g.component.part === 'crown' ? '冠' : '亭'} · {g.component.name}</button>
                    <button type="button" disabled={preview.pendingApply} className="ps-delete-group" aria-label={`删除${g.component.name}`} onClick={() => store.removeGroup(g.id)}><IconTrash size={13} />删除</button>
                </div>)}
                {!model.groups.length ? <small>尚无已应用组件</small> : null}
            </div>
        </details>
        <div className="ps-scene-nav">{children}<div className="ps-history">
            <button type="button" aria-label="撤销" title="撤销 Ctrl / ⌘ Z" disabled={!session.historySize || preview.pendingApply} onClick={() => store.undo()}><IconArrowBackUp size={17} /></button>
            <button type="button" aria-label="重做" title="重做 Ctrl / ⌘ Shift Z" disabled={!session.futureSize || preview.pendingApply} onClick={() => store.redo()}><IconArrowForwardUp size={17} /></button>
        </div></div>
    </div>;
}

export function ViewportColumn({ store, model, ui, preview, session, libraryOpen, onOpenLibrary }) {
    const solidRef = useRef(null), overlayRef = useRef(null);
    const [vp, setVp] = useState(null);
    useEffect(() => {
        const v = new SolidViewport(solidRef.current, overlayRef.current, {
            isLocked: () => !store.unlocked(),
        });
        store.setRenderMode(v.gl ? 'WebGL 2' : 'CPU 深度缓冲');
        setVp(v);
        return () => { v.destroy(); };
    }, [store]);
    useEffect(() => { vp?.frameStock(model.nativeDocument ? model.stock.polys : null); }, [vp, model.stock, model.nativeDocument]);
    useEffect(() => { if (vp) {
        vp.showGhost = ui.showGhost;
        if (vp.mode !== ui.mode)
            vp.setMode(ui.mode);
        vp.draw();
    } }, [vp, ui.showGhost, ui.mode]);
    const ghost = useMemo(() => { if (model.draftActive === false) return []; try {
        return componentPreview(model.draft).map(f => ({ ...f, v: f.v.map(v => transformPoint(v, model.transform)) }));
    }
    catch {
        return [];
    } }, [model.draft, model.transform, model.draftActive]);
    useEffect(() => { if (vp && preview.lastPreview)
        vp.setData(preview.lastPreview.polys, ghost); }, [vp, preview.lastPreview, ghost, model.transform]);
    useEffect(() => { vp?.setPaused(preview.suspended); }, [vp, preview.suspended]);
    const stats = preview.lastPreview?.stats;
    const stockKind = ['preform', 'cube', 'crystal'].includes(model.stock.kind) ? model.stock.kind : 'imported';
    return <section className="ps-canvas-column">
        <div className={`ps-edit-stage${ui.mode === 'orbit' ? ' is-orbit' : ''}`}>
        <div className="ps-scene-column">
        <div className="ps-viewport">
            <canvas ref={solidRef} aria-label="实际切割结果" />
            <canvas ref={overlayRef} className="ps-overlay" aria-label="三维操作区" tabIndex={0} />
            <div className="ps-scene-toolbar">
            <div className="ps-context-tools">
                <div className="ps-canvas-heading"><button type="button" className="ps-library-trigger" aria-haspopup="dialog" aria-controls="ps-library-drawer" aria-expanded={libraryOpen} disabled={preview.pendingApply} onClick={onOpenLibrary}><IconLayoutGrid size={17} />预设库</button><h2 title={model.draft.name}>{model.draftActive === false ? model.nativeDocument?.name ?? '选择冠亭预设开始设计' : model.draft.name}</h2></div>
                <select disabled={store.isLaboratory()} aria-label="切割对象" value={stockKind} onChange={e => store.safe(() => store.setStock(e.target.value))}>
                    {STOCK_OPTIONS.map(([v, n]) => <option key={v} value={v} disabled={v === 'imported'}>{n}</option>)}
                </select>
            </div>
            <div className="ps-scene-actions">
            <div className="ps-tools ps-segmented">
                <button type="button" className={ui.mode === 'axial' ? 'is-active' : ''} title="同轴操作 Q" onClick={() => store.setMode('axial')}>同轴操作 Q</button>
                <button type="button" className={ui.mode === 'orbit' ? 'is-active' : ''} title="观察 V" onClick={() => store.setMode('orbit')}>观察 V</button>
            </div>
            <Operations store={store} model={model} preview={preview} session={session}>
            <div className="ps-view-buttons ps-segmented">
                {SOLID_VIEWS.map(([v, n]) => <button key={v} type="button" onClick={() => vp?.setView(v)}>{n}</button>)}
            </div>
            </Operations>
            </div>
            </div>
            <div className="ps-preview-error" role="alert">{preview.errorDisplay}</div>
            <div className="ps-viewport-help">拖动空白观察 · Shift 仅平移视图<br />剖面仪表：高度 / 升降 / 径向 / 等比</div>
            <div className="ps-viewport-metrics">{stats ? <>{stats.cutFacets} 有效切面 / {preview.planeCount} 工序平面<br />V = {stats.volume.toFixed(4)} {modelUnits(model).label}³</> : null}</div>
        </div>
        <Minis polys={preview.lastPreview?.polys ?? []} />
        </div>
        {ui.mode === 'axial' && model.draftActive !== false ? <div className="ps-instrument-column">
            <AxialInstrument store={store} model={model} pending={preview.pendingApply || preview.suspended} polys={preview.lastPreview?.polys ?? []} />
        </div> : null}
        </div>
    </section>;
}
