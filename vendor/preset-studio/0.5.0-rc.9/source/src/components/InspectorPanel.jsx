import { modelUnits } from '../application/units.js';
import { NumberInput } from './NumberInput.jsx';
import { GirdleContact } from './GirdleContact.jsx';
import { useEffect, useMemo, useRef } from 'react';
import { interfaceReport } from '../domain/assembly.js';
import { instancePlanes } from '../adapters/opengemcutting.js';
import { machineReport, compatibleGears } from '../domain/machine.js';
import { buildPanelView, transformPanelView, machineBarView, previewPlanesOf } from '../application/viewModels.js';
import { ParameterPreview } from './ParameterPreview.jsx';
import { CreativePanel } from './CreativePanel.jsx';

/** Slider + numeric field. Native input/change listeners preserve the v0.2.1
 * one-drag-one-undo contract (React onChange cannot tell preview from commit). */
function ParamField({ field, store }) {
    const rangeRef = useRef(null);
    useEffect(() => {
        const el = rangeRef.current;
        const onInput = () => store.previewParam(field.key, Number(el.value));
        const onChange = () => store.endParamDrag();
        el.addEventListener('input', onInput);
        el.addEventListener('change', onChange);
        return () => { el.removeEventListener('input', onInput); el.removeEventListener('change', onChange); };
    }, [store, field.key]);
    return <div className="ps-field">
        <div className="ps-field-label">
            <label htmlFor={`ps-param-${field.key}`}>{field.name} <small>{field.unit}</small></label>
            <NumberInput id={`ps-param-${field.key}`} aria-label={field.name} min={field.min} max={field.max} step={field.step} value={field.value} onFocus={() => store.setActiveParam(field.key)} onCommit={text => store.commitParam(field.key, text)} />
        </div>
        <input ref={rangeRef} aria-label={`${field.name}滑块`} type="range" min={field.min} max={field.max} step={field.step} value={field.value} onChange={() => { }} onFocus={() => store.setActiveParam(field.key)} />
    </div>;
}

function BuildPanel({ store, model }) {
    const view = useMemo(() => buildPanelView(model.draft, model.machine.teeth), [model.draft, model.machine.teeth]);
    if (!view.recipe)
        return <>
            <h3>自定义冠亭组件</h3>
            <p className="ps-description">当前形态保存的是完整平面数据，不会被旧配方覆盖。可在「同轴变换」中调整整组形态、保存或复用；单面修改交给主琢型编辑器。</p>
            <p className="ps-description">{view.notice}</p>
            <button type="button" onClick={() => store.setPanel('transform')}>调整同轴变换</button>
        </>;
    return <>
        <div className="ps-field">
            <div className="ps-field-label"><label htmlFor="ps-generator">结构生成器</label><small>RECIPE v{model.draft.recipe.version}</small></div>
            <select id="ps-generator" value={view.family} onChange={e => store.setGenerator(e.target.value)}>{view.available.map(o => <option key={o.key} value={o.key}>{o.name}</option>)}</select>
        </div>
        <p className="ps-description">{view.description}</p>
        {view.outline !== null ? <div className="ps-field">
            <div className="ps-field-label"><label htmlFor="ps-outline">轮廓规则</label></div>
            <select id="ps-outline" value={view.outline} onChange={e => store.setOutline(e.target.value)}>
                <option value="round">等向支持 · 圆 / 正多边形</option>
                <option value="emerald">截角长方 · 8 方向</option>
            </select>
        </div> : null}
        {view.fields.map(f => <ParamField key={f.key} field={f} store={store} />)}
        <p className="ps-description">星面 / 下腰面数值是本生成器的构造参数，不等同于 GIA 测量比例；长宽缩放可能产生分数分度。</p>
    </>;
}

function TransformPanel({ store, model, ui }) {
    const t = transformPanelView(model, ui.linkXY);
    return <>
        <h3>一个同轴杆，完成整组调整</h3>
        <p className="ps-description">Z 轴固定不变。升降只改 Z；旋转只按整齿；缩放以轴线为中心。灰色空白拖动只改变视角。</p>
        <div className="ps-axial-fields">
            <label>沿 Z 升降 <small>{modelUnits(model).label}</small><NumberInput aria-label="沿 Z 升降" step=".01" value={t.tz} onCommit={text => store.setTransformField('translation', 2, Number(text))} /></label>
            <label>绕 Z 旋转 <small>整数齿</small><NumberInput aria-label="绕 Z 旋转齿号" step="1" min="0" max={t.teeth} value={t.index} onCommit={text => store.setRotationIndex(Number(text))} /></label>
        </div>
        <div className="ps-rotation-readout">
            <button type="button" aria-label="逆向一齿" onClick={() => store.nudgeIndex(-1)}>− 1 齿</button>
            <output>{t.rotationDeg}°</output>
            <button type="button" aria-label="正向一齿" onClick={() => store.nudgeIndex(1)}>+ 1 齿</button>
        </div>
        <div className="ps-field">
            <div className="ps-field-label">相对轴线缩放 <small>局部 X / Y，Z 高度</small></div>
            <div className="ps-triple">{[0, 1, 2].map(k => <label key={k}>{'XYZ'[k]}<NumberInput aria-label={`轴向缩放 ${'XYZ'[k]}`} min=".001" step=".01" value={t.scale[k]} onCommit={text => store.setTransformField('scale', k, Number(text))} /></label>)}</div>
        </div>
        <label className="ps-link-control"><input type="checkbox" checked={ui.linkXY} onChange={e => store.setLinkXY(e.target.checked)} /> XY 联动，保持当前长宽比</label>
        <p className="ps-description">取消联动可拉伸 X 或 Y。精确形变可能不落整齿；系统不会自动取整，须显式重构并确认误差。</p>
        <div className="ps-row-actions">
            <button type="button" onClick={() => store.resetTransform()}>重置变换</button>
            <button type="button" onClick={() => store.safe(() => store.fit())}>同轴径向适配</button>
            <button type="button" onClick={() => store.toggleGhost()}>组件虚线</button>
        </div>
        <div className="ps-locked-dof">已锁定：X/Y 位移 = 0 · X/Y 倾斜 = 0</div>
    </>;
}

function MachineBar({ store, model }) {
    const view = machineBarView(model.machine);
    return <div className="ps-machine-bar">
        <label htmlFor="ps-gear">固定 Z 轴 · 整数分度</label>
        <div className="ps-gear-row">
            <select id="ps-gear" aria-label="加工分度盘" value={String(view.teeth)} onChange={e => { if (e.target.value === 'custom')
        store.openDialog({ type: 'custom-gear' });
    else
        store.safe(() => store.changeGear(Number(e.target.value))); }}>
                {view.options.map(o => <option key={o.teeth} value={o.teeth}>{o.teeth}{o.suffix}</option>)}
                {!view.known ? <option value={view.teeth}>{view.teeth} · 自定义</option> : null}
                <option value="custom">自定义整数…</option>
            </select>
            <span>1 齿 = {view.perTooth}°</span>
        </div>
    </div>;
}

export function SourceNotes({ notes }) {
    if (!notes?.length) return null;
    return <div className="ps-source-notes" role="status">{notes.map((note, i) => <p key={i} className={note.kind === 'warning' ? 'is-warning' : ''}>{note.text}</p>)}</div>;
}

function Diagnostics({ store, model, d }) {
    return <div className="ps-diagnostics">
        <div className={`ps-manufacturing-line ${d.m.exact ? 'is-valid' : 'is-blocked'}`}><strong>{d.m.exact ? '整齿检查通过' : '未通过整齿检查'}</strong><span>{d.teeth} 分度 · {d.m.rows.length} 工序面</span></div>
        {d.m.exact ? <div>仅检查分度可表达性，不是制造或光学认证。</div> : <>
            <div>{d.m.incompatible} 面不落整齿（当前件 {d.own.incompatible}）· 最大差 {d.m.maxErrorDeg.toFixed(4)}°</div>
            <div>来源保持精确几何；新组件须通过当前分度检查。</div>
            <div className="ps-gear-suggestions">{d.gears.length ? <>{d.gears.slice(0, 4).map(g => <button key={g.teeth} type="button" title={g.note} onClick={() => store.safe(() => store.changeGear(g.teeth))}>{g.teeth}{['custom', 'software'].includes(g.kind) ? '＊' : ''}</button>)} 可精确表达（＊需核对硬件）</> : '已检索候选盘均不精确；加大齿数不一定解决。'}</div>
            <div className="ps-repair-actions"><button type="button" onClick={() => store.requestRepair('draft')}>重构当前件…</button><button type="button" onClick={() => store.requestRepair('all')}>重构整套冠亭…</button></div>
        </>}
        {d.rim ? <div>腰口间距 {d.rim.gap.toFixed(3)} {modelUnits(model).label} · 轮廓差 {d.rim.rimVertexDeviation.toFixed(3)} {modelUnits(model).label}</div> : null}
        {d.inactive ? <div>{d.inactive} 个工序面未显露，仍参与分度检查。</div> : null}
    </div>;
}

const INSPECTOR_TABS = [['creative', '创意设计'], ['build', '精细参数'], ['transform', '同轴变换']];

export function InspectorPanel({ store, model, ui, preview, notes }) {
    const d = useMemo(() => {
        const planes = previewPlanesOf(model), m = machineReport(planes, model.machine.teeth), own = machineReport(instancePlanes(model.draft, model.transform, 'draft'), model.machine.teeth);
        const opposite = model.groups.filter(g => g.id !== model.editId && g.component.part !== model.draft.part).at(-1);
        let rim = null;
        if (opposite) {
            try {
                const r = interfaceReport({ component: model.draft, transform: model.transform }, opposite);
                if (r.gap !== undefined)
                    rim = r;
            }
            catch { }
        }
        const gears = m.exact ? [] : compatibleGears(planes, model.machine.teeth);
        const inactive = preview.lastPreview && preview.previewVersion === preview.version ? preview.lastPreview.stats.inactive.length : 0;
        const applyDisabled = model.draftActive === false || !preview.valid || preview.previewVersion !== preview.version || preview.pendingApply || !store.api.getMachineReport().exact;
        const applyLabel = preview.pendingApply ? '提交中…' : !store.api.getMachineReport().exact ? '需解决整数分度后应用' : model.editId ? '更新这一组切割' : '应用整组切割';
        return { m, own, rim, gears, inactive, applyDisabled, applyLabel, teeth: model.machine.teeth };
    }, [model, preview]);
    if (model.draftActive === false) return <aside className="ps-inspector ps-source-empty">
        <h2>冠亭组件</h2><p>来源设计已完整载入。打开预设库选择冠部或亭部，或从已有组件工序继续编辑。</p>
        <SourceNotes notes={notes} />
        <p>保存实验稿不会改变来源项目。</p>
        {['crown','pavilion'].map(part => model.basePlanes.some(p => p.part === part) ? <button type="button" key={part} onClick={() => store.openDialog({ type: 'extract', part })}>{part === 'crown' ? '冠部' : '亭部'}提取为参考件</button> : null)}
    </aside>;
    return <aside className="ps-inspector">
        <div className="ps-section-head"><h2>组件编辑器</h2><small>{model.draft.part.toUpperCase()}</small></div>
        <SourceNotes notes={notes} />
        <div className="ps-tabs ps-segmented" role="tablist" aria-label="编辑器面板">
            {INSPECTOR_TABS.map(([key, name]) => <button key={key} type="button" role="tab" aria-selected={ui.panel === key} className={ui.panel === key ? 'is-active' : ''} onClick={() => store.setPanel(key)}>{name}</button>)}
        </div>
        <ParameterPreview model={model} ui={ui} />
        <MachineBar store={store} model={model} />
        <div className="ps-inspector-body">{ui.panel === 'creative' ? <CreativePanel store={store} model={model} ui={ui} pending={preview.pendingApply} /> : <><GirdleContact store={store} model={model} pending={preview.pendingApply} />{ui.panel === 'build' ? <BuildPanel store={store} model={model} /> : <TransformPanel store={store} model={model} ui={ui} />}</>}</div>
        <Diagnostics store={store} model={model} d={d} />
        <div className="ps-inspector-actions">
            {!model.editId && model.basePlanes.some(p => p.part === model.draft.part) ? <button type="button" onClick={() => store.openDialog({ type: 'source-replacement' })}>选择要替换的来源{model.draft.part === 'crown' ? '冠部' : '亭部'}工序…</button> : null}
            {model.replacementIds?.length ? <p>正在预览替换 {model.replacementIds.length} 道来源工序，应用后生效。</p> : null}
            <div className="ps-save-row">
                <button type="button" onClick={() => store.openDialog({ type: 'extract' })}>提取当前冠 / 亭</button>
            </div>
            <button type="button" className="ps-primary ps-apply" disabled={d.applyDisabled} onClick={() => void store.apply()}>{d.applyLabel}</button>
        </div>
    </aside>;
}
