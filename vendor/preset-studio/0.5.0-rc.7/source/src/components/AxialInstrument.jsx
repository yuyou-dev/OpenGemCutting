import { modelUnits } from '../application/units.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { IconArrowsDiagonal, IconChevronLeft, IconChevronRight, IconHelpCircle, IconSquareCheckFilled } from '@tabler/icons-react';
import { componentPreview } from '../domain/generators.js';
import { boundingBox, clone, clamp } from '../domain/math.js';
import { snapIndex, rotationIndex, GEAR_CATALOG } from '../domain/machine.js';
import { drawAxialProfile, drawIndexDial } from '../viewport/axial-instrument.js';
import { watchPixelDensity } from '../viewport/canvas-resolution.js';
import { NumberInput } from './NumberInput.jsx';

export function AxialInstrument({ store, model, pending, polys }) {
    const profile = useRef(null), dial = useRef(null), grips = useRef([]), gesture = useRef(null);
    const [active, setActive] = useState(''), [help, setHelp] = useState(false);
    const local = useMemo(() => { try { return componentPreview(model.draft); } catch { return []; } }, [model.draft]);
    const units = modelUnits(model);
    const pavilion = model.draft.part === 'pavilion';
    const t = model.transform, teeth = model.machine.teeth;
    const baseHeight = local.length ? boundingBox(local).size[2] : 0;
    const height = baseHeight * t.scale[2], radius = Math.max(0, ...local.flatMap(f => f.v.map(v => Math.hypot(v[0] * t.scale[0], v[1] * t.scale[1]))));
    const index = snapIndex(rotationIndex(t.rotation[2], teeth), teeth);
    useEffect(() => () => { if (gesture.current) store.dragEnd(); }, [store]);
    useEffect(() => {
        const redraw = () => {
            grips.current = drawAxialProfile(profile.current, polys, t, gesture.current?.polys, model.draft.part);
            drawIndexDial(dial.current, index, teeth);
        };
        redraw();
        const observer = new ResizeObserver(redraw); observer.observe(profile.current); observer.observe(dial.current);
        const stop = watchPixelDensity(redraw);
        return () => { observer.disconnect(); stop(); };
    }, [polys, t, index, teeth, active, model.draft.part]);
    const begin = (action, e) => {
        if (pending || !store.unlocked()) return;
        e.preventDefault(); e.currentTarget.focus({ preventScroll: true });
        const rect = e.currentTarget.getBoundingClientRect();
        gesture.current = { action, transform: clone(t), polys, x: e.clientX, y: e.clientY,
            angle: Math.atan2(e.clientY - rect.top - rect.height / 2, e.clientX - rect.left - rect.width / 2), total: 0 };
        store.dragStart(); setActive(action); e.currentTarget.setPointerCapture(e.pointerId);
    };
    const valueOf = action => action === 'scaleZ' ? height : action === 'scaleXY' ? radius : action === 'translateZ' ? t.translation[2] : t.scale[0];
    const update = (action, value) => {
        const next = clone(model.transform);
        if (action === 'translateZ') next.translation[2] = value;
        else {
            const axes = action === 'scaleZ' ? [2] : action === 'scaleXY' ? [0, 1] : [0, 1, 2];
            const factor = value / valueOf(action);
            for (const axis of axes) next.scale[axis] *= factor;
        }
        store.safe(() => store.onTransform(next));
    };
    const move = e => {
        const g = gesture.current; if (!g || pending) return;
        const next = clone(g.transform), dy = e.clientY - g.y, dx = e.clientX - g.x;
        if (g.action === 'rotateZ') {
            const rect = e.currentTarget.getBoundingClientRect();
            const angle = Math.atan2(e.clientY - rect.top - rect.height / 2, e.clientX - rect.left - rect.width / 2);
            let delta = angle - g.angle;
            if (delta > Math.PI) delta -= 2 * Math.PI;
            if (delta < -Math.PI) delta += 2 * Math.PI;
            g.total -= delta; g.angle = angle;
            next.rotation[2] = snapIndex(rotationIndex(g.transform.rotation[2], teeth) + g.total * teeth / (2 * Math.PI), teeth) * 360 / teeth;
        } else if (g.action === 'translateZ') next.translation[2] = clamp(next.translation[2] - dy / 150, -100, 100);
        else {
            const factor = Math.exp((g.action === 'scaleXY' ? dx : g.action === 'scaleAll' ? dx - dy : pavilion ? dy : -dy) / 110);
            const axes = g.action === 'scaleZ' ? [2] : g.action === 'scaleXY' ? [0, 1] : [0, 1, 2];
            for (const axis of axes) next.scale[axis] = clamp(next.scale[axis] * factor, .01, 20);
        }
        store.safe(() => store.onTransform(next, false));
    };
    const finish = (cancel = false) => {
        const g = gesture.current; if (!g) return;
        if (cancel) { store.onTransform(g.transform, false); store.dragCancel(); }
        else store.dragEnd();
        gesture.current = null; setActive('');
    };
    useEffect(() => { if (pending) finish(); }, [pending]);
    const keyDown = (e, action) => {
        if (e.key === 'Escape') { e.preventDefault(); finish(true); }
        else if (action && ['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp'].includes(e.key)) {
            e.preventDefault();
            const direction = ['ArrowLeft', 'ArrowDown'].includes(e.key) ? -1 : 1;
            if (action === 'rotateZ') store.nudgeIndex(direction);
            else update(action, valueOf(action) + direction * .01);
        }
    };
    const events = { onPointerMove: move, onPointerUp: () => finish(), onPointerCancel: () => finish(true), onLostPointerCapture: () => finish(), onKeyDown: e => keyDown(e) };
    const field = (action, label, factor, unit) => <div className={`ps-instrument-field ps-field-${action}`}>
        <label htmlFor={`instrument-${action}`}>{label}{factor ? <span>{factor}</span> : null}</label>
        <div className="ps-instrument-number"><NumberInput id={`instrument-${action}`} aria-label={`仪表${label}`} disabled={!local.length && ['scaleZ', 'scaleXY'].includes(action)} step=".01" value={Number(valueOf(action).toFixed(4))} onCommit={text => { if (text.trim()) update(action, Number(text)); }} />{unit ? <span>{unit}</span> : null}</div>
    </div>;
    return <fieldset className="ps-instrument" disabled={pending}>
        <legend className="ps-sr-only">实时剖面仪表</legend>
        <div className="ps-instrument-title"><strong>实时剖面仪表</strong><button type="button" aria-label="剖面仪表帮助" aria-expanded={help} onClick={() => setHelp(!help)}><IconHelpCircle size={16} /></button></div>
        {help ? <p className="ps-instrument-help">圆点向远离腰棱的方向拖动增加高度；左侧手柄沿 Z 升降；横向拖动改变径向尺寸；斜向拖动等比缩放。剖面显示整颗宝石，操作只影响当前组件。{units.description}</p> : null}
        {store.isLaboratory() ? <p className="ps-instrument-help">{units.description}</p> : null}
        {field('scaleZ', '高度', `H × ${t.scale[2].toFixed(2)}`, units.label)}
        <canvas ref={profile} className="ps-profile-control" aria-label={`宝石实时剖面：${pavilion ? '底部' : '顶部'}拖动高度，左侧手柄沿 Z 升降`} tabIndex={0} {...events} onPointerDown={e => {
            const rect = e.currentTarget.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
            const grip = grips.current.find(g => Math.hypot(g.x - x, (g.y - y) / (g.action === 'translateZ' ? 2 : 1)) < 13);
            if (grip) begin(grip.action, e);
        }} />
        {field('translateZ', '升降 Z', null, units.label)}
        <div className={`ps-radial-control${active === 'scaleXY' ? ' is-active' : ''}`} role="slider" tabIndex={0} aria-label="径向拖动手柄" aria-valuemin={.01} aria-valuenow={radius} {...events} onPointerDown={e => begin('scaleXY', e)} onKeyDown={e => keyDown(e, 'scaleXY')}>
            <svg viewBox="0 0 240 28" aria-hidden="true"><path d="M12 14H228" /><path d="M12 14l7-4v8zm216 0l-7-4v8z" /><path className="ps-radial-active" d="M76 14H164" /><circle cx="120" cy="14" r="7.5" /></svg>
        </div>
        {field('scaleXY', '径向', `R × ${t.scale[0].toFixed(2)}`, units.label)}
        <div className="ps-uniform-control">
            <div role="slider" tabIndex={0} aria-label="等比拖动手柄" aria-valuemin={.01} aria-valuenow={t.scale[0]} {...events} onPointerDown={e => begin('scaleAll', e)} onKeyDown={e => keyDown(e, 'scaleAll')}><IconArrowsDiagonal size={44} stroke={1.8} /></div>
            {field('scaleAll', '等比', `S × ${t.scale[0].toFixed(2)}`, null)}
        </div>
        <div className="ps-instrument-rotation"><span>旋转（整数分度）</span>
            <div><button type="button" aria-label="仪表逆向一齿" onClick={() => store.nudgeIndex(-1)}><IconChevronLeft size={17} /></button>
                <canvas className="ps-index-control" ref={dial} aria-label={`整数分度盘，${index || teeth} / ${teeth} 齿`} tabIndex={0} {...events} onPointerDown={e => begin('rotateZ', e)} onKeyDown={e => keyDown(e, 'rotateZ')} />
                <button type="button" aria-label="仪表正向一齿" onClick={() => store.nudgeIndex(1)}><IconChevronRight size={17} /></button></div>
        </div>
        <div className="ps-instrument-gear"><span><IconSquareCheckFilled size={15} />整数分度</span><select aria-label="仪表分度盘" value={teeth} onChange={e => store.safe(() => store.changeGear(Number(e.target.value)))}>
            {!GEAR_CATALOG.some(g => g.teeth === teeth) ? <option value={teeth}>{teeth} 整齿</option> : null}
            {GEAR_CATALOG.map(g => <option value={g.teeth} key={g.teeth}>{g.teeth} 整齿</option>)}
        </select></div>
    </fieldset>;
}
