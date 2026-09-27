import { useEffect, useMemo, useRef, useState } from 'react';
import { ParameterViewport } from '../viewport/viewport.js';
import { componentPreview } from '../domain/generators.js';
import { controlDefinitions } from '../application/viewModels.js';

const PARAM_VIEWS = [['iso', '立体'], ['top', '顶'], ['side', '侧']];

/** Independent live wireframe of the full local component; never clipped by rough. */
export function ParameterPreview({ model, ui }) {
    const canvasRef = useRef(null);
    const [pv, setPv] = useState(null);
    useEffect(() => {
        const v = new ParameterViewport(canvasRef.current);
        setPv(v);
        return () => v.destroy();
    }, []);
    const data = useMemo(() => {
        try {
            const polys = componentPreview(model.draft), name = ui.activeParam.startsWith('tier-') ? `第 ${ui.activeParam.slice(5)} 圈 · 从腰口向内` : controlDefinitions[ui.activeParam]?.[0] || '';
            return { polys, label: name || 'LOCAL Z · 组件本体', caption: `${model.draft.planes.length} 定义面 · ${name || '组件本体，不受余料裁切'} · 拖动观察` };
        }
        catch (e) {
            return { polys: [], label: '', caption: e.message };
        }
    }, [model.draft, ui.activeParam]);
    useEffect(() => { if (pv)
        pv.setData(data.polys, [], ui.activeParam, data.label); }, [pv, data, ui.activeParam]);
    return <section className="ps-parameter-preview" aria-label="独立参数预览">
        <div className="ps-parameter-head">
            <strong>参数预览 <small>3D 线框</small></strong>
            <div>{PARAM_VIEWS.map(([v, n]) => <button key={v} type="button" title={`参数预览${n}视角`} onClick={() => pv?.setView(v)}>{n}</button>)}</div>
        </div>
        <div className="ps-parameter-canvas-wrap"><canvas ref={canvasRef} aria-label="冠亭本体三维线框，拖动查看" tabIndex={0} /></div>
        <div className="ps-parameter-caption">{data.caption}</div>
    </section>;
}
