import { useEffect, useMemo, useRef, useState } from 'react';
import { drawOrthographic } from '../viewport/viewport.js';
import { Modal } from './Modal.jsx';

function ComparisonCanvas({ polys, frame, view, label }) {
    const ref = useRef(null);
    useEffect(() => {
        const draw = () => drawOrthographic(ref.current, polys, view, frame);
        const observer = new ResizeObserver(draw); observer.observe(ref.current); draw();
        return () => observer.disconnect();
    }, [polys, frame, view]);
    return <canvas ref={ref} aria-label={label} />;
}
export function CreativeComparison({ store, dialog }) {
    const { choices, mode, part } = dialog;
    const [selected, setSelected] = useState(choices.findIndex(c => c.component && !c.original && !c.unchanged));
    const [view, setView] = useState('iso');
    const frame = useMemo(() => choices.flatMap(c => c.polys || []), [choices]);
    const kept = part === 'crown' ? '冠部' : '亭部';
    const selectedChoice = choices[selected];
    return <Modal className="ps-comparison-dialog" title={mode === 'pair' ? `固定${kept} · 比较搭配` : '在同一视角里，找到喜欢的造型'} confirmText="载入所选预览" cancelText="返回编辑" confirmDisabled={!selectedChoice?.component || selectedChoice.original || selectedChoice.unchanged} onClose={() => store.closeDialog()} onConfirm={() => store.acceptComparison(selected)}>
        <div className="ps-comparison-intro"><p>{mode === 'pair' ? `${kept}已应用并保持原样；只等比适配另一半。选择后仍需应用整组切割。` : '当前造型作为基准。这里只比较，载入后仍可编辑、撤销，再决定应用。'}</p><div className="ps-segmented">{[['iso', '立体'], [mode === 'pair' ? part === 'crown' ? 'bottom' : 'top' : part === 'crown' ? 'top' : 'bottom', '正视'], ['side', '侧面']].map(([key, label]) => <button type="button" key={key} className={key === view ? 'is-active' : ''} onClick={() => setView(key)}>{label}</button>)}</div></div>
        <div className="ps-comparison-grid">{choices.map((c, index) => <button type="button" className={`ps-comparison-card${index === selected ? ' is-selected' : ''}`} key={c.title} disabled={!c.component} aria-pressed={index === selected} onClick={() => setSelected(index)}>
            <span className="ps-comparison-card-head"><strong>{c.title}</strong><span>{c.original ? '基准' : c.unchanged ? '同当前' : index === selected ? '已选' : '选择'}</span></span>
            <span className="ps-comparison-visual">{c.polys ? <ComparisonCanvas polys={c.polys} frame={frame} view={view} label={`${c.title}实际组合`} /> : <span>暂不可用</span>}</span>
            <span className="ps-comparison-side">{c.polys ? <ComparisonCanvas polys={c.polys} frame={frame} view="side" label={`${c.title}侧视`} /> : null}</span>
            <span className="ps-comparison-caption">{c.reason || c.caption}</span>
        </button>)}</div>
        <div className="ps-comparison-note" aria-live="polite">{selectedChoice?.adjustment || '比较图来自实际切割几何，所有候选使用相同视角与比例。'}<span>几何预览，不代表光学表现或加工认证。</span></div>
    </Modal>;
}
