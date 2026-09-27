import { modelUnits } from '../application/units.js';
import { fitRim } from '../application/fitRim.js';
import { useMemo, useState } from 'react';
import { currentGirdleStock, girdleContact } from '../domain/girdle.js';
import { previewPlanesOf } from '../application/viewModels.js';
import { NumberInput } from './NumberInput.jsx';

const partName = part => part === 'crown' ? '冠部' : '亭部';
export function GirdleContact({ store, model, pending }) {
    const unit = modelUnits(model).label;
    const [datum, setDatum] = useState(0), [result, setResult] = useState(null);
    const reports = useMemo(() => ['crown', 'pavilion'].map(part => {
        const group = model.draft.part === part ? { component: model.draft, transform: model.transform } : model.groups.filter(g => g.component.part === part).at(-1);
        try {
            if (!group) throw new Error('尚无对应组件');
            if (store.isEmbedded() && model.draft.part !== part) throw new Error('请先选择该组件再贴合');
            return { part, ...girdleContact(group.component, group.transform, currentGirdleStock(model.stock, previewPlanesOf(model)), datum) };
        } catch (e) { return { part, error: e.message }; }
    }), [model, datum, store]);
    const recut = part => {
        try {
            const applied = store.recutGirdle(part);
            if (applied) setResult({ text: `${partName(part)}腰线已整圈平齐 · 可撤销`, version: store.getVersion() });
        } catch (e) { setResult({ text: e.message, error: true, version: store.getVersion() }); }
    };
    const fit = () => {
        try {
            const fitted = fitRim(store);
            if (fitted) setResult({ text: fitted.exact
                ? '参考腰口已整圈贴合 · 请检查预览后应用'
                : `已尽量贴近腰线，不能整圈重合 · 最大径向偏差 ${(fitted.deviation * 100).toFixed(2)}% · 请检查预览后应用`,
                error: !fitted.exact, version: store.getVersion(), fit: true });
        } catch (e) { setResult({ text: e.message, error: true, version: store.getVersion(), fit: true }); }
    };
    return <section className="ps-girdle-tools">
        <details className="ps-girdle-recut" open>
            <summary>腰棱重整</summary>
            <p>自动重新切腰棱，让整圈腰线平齐，尽量保留尺寸。</p>
            <div className="ps-recut-actions">{['crown', 'pavilion'].map(part => <button type="button" key={part} disabled={pending || store.isEmbedded() || (model.draft.part !== part && !model.groups.some(g => g.component.part === part))} onClick={() => recut(part)}>{partName(part)}平腰</button>)}</div>
            <p>保留冠亭角度与位置，完成后可撤销。</p>
            {store.isEmbedded() ? <p className="ps-recut-warning">请在独立工作室中使用腰棱重整。</p> : null}
            <div aria-live="polite">{!result?.fit && result?.version === store.getVersion() ? <p className={result.error ? 'ps-recut-warning' : 'ps-recut-success'}>{result.text}</p> : null}</div>
        </details>
        <details className="ps-girdle-contact" open>
            <summary>缩放贴腰 <small>固定腰棱 · 等比缩放组件</small></summary>
            <p>让当前组件的参考腰口尽量贴近腰线，保持切面角度和形状。</p>
            <button type="button" disabled={pending} onClick={fit}>{partName(model.draft.part)}缩放贴腰</button>
            <p>高度随比例变化，腰口 Z 不变；先预览，再应用，可撤销。</p>
            <div aria-live="polite">{result?.fit && result.version === store.getVersion() ? <p className={result.error ? 'ps-recut-warning' : 'ps-recut-success'}>{result.text}</p> : null}</div>
        </details>
        <details className="ps-girdle-contact">
            <summary>Z 向贴合 <small>固定腰棱 · 仅移动组件</small></summary>
            <label>腰棱基准 Z <small>{unit}</small><NumberInput aria-label="固定腰棱基准 Z" value={datum} step=".01" onCommit={v => { if (v.trim() && Number.isFinite(Number(v))) setDatum(Number(v)); }} /></label>
            <p>保留腰棱半径和切面形状，仅沿 Z 移至接触。</p>
            {reports.map(r => <div key={r.part} className="ps-contact-result">
                <button type="button" disabled={pending || !!r.error} onClick={() => store.safe(() => store.contactGirdle(r.part, datum))}>{partName(r.part)}贴合</button>
                <span className={!r.exact ? 'is-warning' : ''}>{r.error || (r.exact ? `可整圈贴合 · ΔZ ${r.deltaZ.toFixed(4)} ${unit}` : `仅局部接触，不能整圈贴合 · 高度差 ${r.spread.toFixed(4)} ${unit}`)}</span>
            </div>)}
            <p>只移动目标组件，另一组件保持不变；可撤销。</p>
        </details>
    </section>;
}
