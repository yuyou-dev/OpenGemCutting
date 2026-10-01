import { useEffect, useMemo, useState } from 'react';
import { GENERATORS } from '../domain/generators.js';
import { supportsTiers, tierValues, rhythmWidths, editTier } from '../domain/creative.js';
import { NumberInput } from './NumberInput.jsx';

function ShapeControl({ store, label, hint, param, value, min, max, step = 1, factor = 1, unit = '', onError }) {
    const run = (v, preview) => {
        try {
            const patch = { [param]: Number(v) / factor };
            preview ? store.previewCreative(patch) : store.changeCreative(patch);
            store.setActiveParam(param); onError('');
        } catch (e) { onError(e.message); }
    };
    return <div className="ps-shape-control">
        <div className="ps-field-label"><label htmlFor={`ps-shape-${param}`}>{label}</label><span><NumberInput id={`ps-shape-${param}`} aria-label={label} value={Number((value * factor).toFixed(3))} min={min} max={max} step={step} onCommit={v => run(v, false)} /> {unit}</span></div>
        <input type="range" aria-label={`${label}滑块`} min={min} max={max} step={step} value={value * factor} onChange={e => run(e.target.value, true)} onPointerUp={() => store.endParamDrag()} onPointerCancel={() => store.endParamDrag()} onKeyUp={() => store.endParamDrag()} onBlur={() => store.endParamDrag()} />
        <small>{hint}</small>
    </div>;
}
function TierEditor({ store, model, ui, onError }) {
    const supported = supportsTiers(model.draft);
    const tiers = supported ? tierValues(model.draft) : [];
    const selected = Math.max(0, tiers.findIndex(t => t.id === ui.activeParam));
    const tier = tiers[selected];
    const current = tier ? tier.phase * model.machine.teeth / 360 : 0;
    const options = useMemo(() => {
        if (!supported) return [];
        return [-1, 1].map(delta => {
            try { editTier(model.draft, selected, { teethOffset: current + delta }, model.transform, model.machine.teeth); return { delta }; }
            catch (e) { return { delta, reason: e.message }; }
        });
    }, [model.draft, model.transform, model.machine.teeth, selected, current, supported]);
    const change = patch => { try { store.changeTier(selected, patch); onError(''); } catch (e) { onError(e.message); } };
    if (!supported) return <div className="ps-creative-empty"><strong>从阶梯圈层开始探索</strong><p>圆形阶梯式、错层环式支持逐圈宽度与整齿错位。明亮式的交会关系用「造型」里的主次控制调整。</p><button type="button" onClick={() => store.setGenerator('step')}>换成阶梯式</button></div>;
    const total = tiers.reduce((s, t) => s + t.width, 0);
    return <>
        <p className="ps-creative-hint">从腰口向中心选一圈，上方线框同步高亮。</p>
        <div className="ps-tier-list" aria-label="选择圈层">{tiers.map((t, i) => <button type="button" key={t.id} aria-pressed={i === selected} className={i === selected ? 'is-selected' : ''} onClick={() => { store.setActiveParam(t.id); onError(''); }}><span>第 {i + 1} 圈</span><span className="ps-tier-bar"><i style={{ width: `${t.width / total * 100}%` }} /></span><small>{i === 0 ? '靠腰' : i === tiers.length - 1 ? '靠中心' : '中间'}</small></button>)}</div>
        <div className="ps-tier-edit">
            <div className="ps-field-label"><label htmlFor="ps-tier-width">这一圈的相对宽度</label><NumberInput id="ps-tier-width" aria-label="这一圈的相对宽度" min=".1" max="6" step=".1" value={tier.width} onCommit={v => change({ width: Number(v) })} /></div>
            <p className="ps-creative-hint">增大后这一圈更宽，其余圈按比例收窄。</p>
            <div className="ps-tier-rotation"><span>圈层错位</span><output>{Number(current.toFixed(3))} 齿</output><div>{options.map(o => <button type="button" key={o.delta} disabled={!!o.reason} title={o.reason || '保留腰口与各圈刻面'} onClick={() => change({ teethOffset: current + o.delta })}>{o.delta < 0 ? '−' : '+'} 1 齿</button>)}</div></div>
            {options.some(o => o.reason) ? <p className="ps-creative-boundary">当前边界：{options.find(o => o.reason).reason}</p> : <p className="ps-creative-hint">保留腰口与各圈刻面；整齿旋转，切面角度不变。</p>}
            <button type="button" disabled={current === 0} onClick={() => change({ teethOffset: 0 })}>重置这圈错位</button>
        </div>
    </>;
}

export function CreativePanel({ store, model, ui, pending }) {
    const [page, setPage] = useState('shape'), [error, setError] = useState('');
    const c = model.draft, p = c.recipe?.params;
    useEffect(() => { setError(''); }, [c.id, c.family, model.editId]);
    useEffect(() => {
        if (page === 'tiers' && supportsTiers(c) && !tierValues(c).some(t => t.id === ui.activeParam)) store.setActiveParam('tier-1');
    }, [page, c, ui.activeParam, store]);
    const compare = async mode => { try { await store.openComparison(mode); setError(''); } catch (e) { setError(e.message); } };
    const currentPart = c.part === 'crown' ? '冠部' : '亭部', otherPart = c.part === 'crown' ? '亭部' : '冠部';
    const shape = (param, label, hint, min, max, factor = 1, unit = '', step = 1) => <ShapeControl key={param} {...{ store, param, label, hint, min, max, factor, unit, step }} value={p[param]} onError={setError} />;
    return <section className="ps-creative-panel" aria-label="创意设计">
        <div className="ps-creative-entry"><span>探索造型，保留喜欢的变化</span><button type="button" disabled={!p || pending} onClick={() => void compare('variation')}>比较变体</button></div>
        {p ? <div className="ps-creative-family"><label htmlFor="ps-creative-family">切面风格</label><select id="ps-creative-family" value={c.family} onChange={e => store.setGenerator(e.target.value)}>{Object.entries(GENERATORS).filter(([key]) => c.part === 'crown' ? key !== 'keel' : !['rose', 'checker'].includes(key)).map(([key, g]) => <option value={key} key={key}>{g.name}</option>)}</select></div> : null}
        <div className="ps-creative-tabs" aria-label="创意工具">{[['shape', '造型'], ['tiers', '圈层']].map(([key, name]) => <button type="button" key={key} className={key === page ? 'is-active' : ''} aria-pressed={key === page} onClick={() => setPage(key)}>{name}</button>)}</div>
        {!p ? <p className="ps-creative-hint">这个组件保留了自定义平面。可继续搭配，或从预设库选择参数化组件来探索造型。</p> : page === 'tiers' ? <TierEditor {...{ store, model, ui }} onError={setError} /> : <>
            {c.part === 'crown' && !['rose', 'checker'].includes(c.family) ? shape('table', '台面开合', '向左集中，向右展开中心', 15, 80, 100, '%') : null}
            {c.family === 'brilliant' ? c.part === 'crown' ? shape('star', '星面舒展', '控制星面与周围刻面的主次', 20, 80, 100, '%') : shape('lower', '细面延伸', '向左宽面更醒目，向右分割更细密', 30, 90, 100, '%') : null}
            {['rose', 'checker'].includes(c.family) ? shape('height', '拱顶起伏', '从浅拱到饱满的轮廓', .08, 1.5, 1, 'R', .01) : shape('angle', c.part === 'crown' ? '冠部起伏' : '亭部深浅', '角度更大，侧面轮廓更饱满', 10, 70, 1, '°', .5)}
            {supportsTiers(c) ? <div className="ps-rhythm"><strong>层带节奏</strong><div>{[['even', '均匀'], ['outer', '外圈宽'], ['inner', '内圈宽']].map(([key, title]) => <button type="button" key={key} onClick={() => { try { store.changeCreative({ tierWidths: rhythmWidths(p.layers, key) }); setError(''); } catch (e) { setError(e.message); } }}>{title}</button>)}</div><small>保留圈数与切角，重新分配层带宽度。</small></div> : null}
        </>}
        <div className="ps-creative-message" role="status">{error}</div>
        <div className="ps-pair-entry"><strong>保留这半颗，寻找另一半</strong><p>{currentPart}应用后固定；比较{otherPart}的搭配，取消比较保留已应用的{currentPart}。</p><button type="button" disabled={pending || store.isEmbedded()} onClick={() => void compare('pair')}>{model.editId && !store.hasPendingDraft() ? `固定${currentPart}，搭配${otherPart}` : `应用${currentPart}，搭配${otherPart}`}</button>{store.isEmbedded() ? <small>当前宿主需在独立实验稿中进行组合比较。</small> : null}</div>
    </section>;
}
