import { useState } from 'react';
import { Modal } from './Modal.jsx';

function HelpDialog({ onClose }) {
    return <Modal title="固定轴冠亭工作流程" confirmText="知道了" onClose={onClose} onConfirm={() => { }}>
        <p>文件导入、工作区保存、预设与模型导出统一在右上角「导入 / 导出」。导入先显示校验结果与影响，确认后才替换或合并。</p>
        <p>点击画布左上工具区「预设库」打开冠部/亭部抽屉，选择后自动返回画布；Esc 或点击外侧也可收起。先选预设，右上方独立线框显示组件本体，不受余料裁切。参数输入获得焦点时，相关面高亮。主视图仍显示对当前余料的真实切割结果。</p>
        <p>实时剖面仪表：顶部手柄调高度，左侧沿 Z 升降，下方横向手柄调 XY 径向，斜向手柄调 XYZ 等比。尺寸以 R 显示并与倍数同步；分度盘每步一整齿。右侧同轴变换面板可取消 XY 联动后分别调 X、Y。没有横向位移或倾斜控制。</p>
        <p>齿号必须为整数，但 96 分度的一齿是 3.75°。增加分度数不是自动修复：96 与120的刻度不是包含关系，360也不是所有几何的无损选择。</p>
        <p>拉伸出现分数分度时仍保留精确预览，但禁止应用。可选完全兼容的分度，或打开整齿重构对比，确认接受近似后的形状和交点变化。</p>
        <p>齿数清单来自 Ultra Tec、Facetron 与 GemCad 官方资料；88 为文献/厂商介绍项，360 为软件预设，不代表当前机器具有这些分度。自定义齿数也须核对硬件。</p>
        <p>本体 JSON 支持1–360分度并保留来源精确工序，新组件按当前加工分度检查。工作区 v2 保存机台设置；旧文件若包含横移、倾斜或不兼容旋转则拒绝，不会偷偷归零。</p>
        <div className="ps-help-shortcuts">Q 同轴杆 · V 观察 · Esc 取消当前拖动<br />Ctrl / ⌘ Z 撤销 · Ctrl / ⌘ Shift Z 重做</div>
    </Modal>;
}

function ExtractDialog({ store, model, dialog }) {
    const c = model.draft;
    const [name, setName] = useState(c.name + ' · 自定义');
    const [author, setAuthor] = useState('');
    const [license, setLicense] = useState('unspecified');
    const [part, setPart] = useState(dialog.part ?? (c.part === 'pavilion' ? 'pavilion' : 'crown'));
    const [waistZ, setWaistZ] = useState(String(model.transform.translation[2]));
    const [radius, setRadius] = useState('1');
    return <Modal title="提取当前冠部 / 亭部" confirmText="提取为草稿" onClose={store.closeDialog} onConfirm={() => store.extractDraft({ name: name.trim(), part, waistZ, radius, author, license })}>
        <p>确认提取将替换当前草稿；如需单独保留未应用的编辑，请取消并先应用或导出完整工作区。提取完整工序平面为当前草稿，保留当前无效面。可继续编辑，或通过「导入 / 导出」保存组件文件。</p>
        <label>预设名称<input value={name} maxLength={160} onChange={e => setName(e.target.value)} /></label>
        <>
            <label>提取部位<select value={part} onChange={e => setPart(e.target.value)}><option value="crown">冠部</option><option value="pavilion">亭部</option></select></label>
            <div className="ps-triple">
                <label>腰口 Z<input type="number" step=".001" value={waistZ} onChange={e => setWaistZ(e.target.value)} /></label>
                <label>参考半径 R<input type="number" min=".001" step=".01" value={radius} onChange={e => setRadius(e.target.value)} /></label>
            </div>
        </>
        <label>作者 / 来源说明<input maxLength={200} placeholder="自制，或注明原作者与授权" value={author} onChange={e => setAuthor(e.target.value)} /></label>
        <label>使用许可<select value={license} onChange={e => setLicense(e.target.value)}>
            <option value="unspecified">未声明 / 仅个人保存</option>
            <option value="MIT">MIT（确认有权授权时选择）</option>
            <option value="CC0-1.0">CC0（确认有权授权时选择）</option>
        </select></label>
    </Modal>;
}

function CustomGearDialog({ store }) {
    const [teeth, setTeeth] = useState('288');
    return <Modal title="自定义整数分度" confirmText="使用此分度" onClose={store.closeDialog} onConfirm={() => store.changeGear(Number(teeth))}>
        <p>这是软件分度，不代表硬件支持；所有切面会重新验证。不会自动取整或改变几何。</p>
        <label>齿数<input type="number" min="1" max={store.isLaboratory() ? 360 : 10000} step="1" value={teeth} onChange={e => setTeeth(e.target.value)} /></label>
    </Modal>;
}

function RepeatedSourceDialog({ store, model, dialog }) {
    const [selected, setSelected] = useState(() => dialog.operations.map(o => o.id));
    const part = model.draft.part === 'crown' ? '冠部' : '亭部';
    const ids = dialog.operations.filter(o => selected.includes(o.id)).flatMap(o => o.ids);
    return <Modal title={`组件与来源${part}工序重合`} confirmText={ids.length ? '替换所选工序' : '保留两份并应用'}
        onClose={store.closeDialog} onConfirm={() => store.resolveRepeatedSource(ids)}>
        <p>当前组件包含下列来源工序的全部切面。叠加应用会让同一组切面出现两份：宝石形状不变，但以后修改其中一份时，另一份仍留在原位；图案实验室等后续工具也会多读到一组重复切割。</p>
        <p>建议用组件替换它们。替换会先更新预览，确认后再点“应用整组切割”，可撤销。取消勾选则保留两份。</p>
        {dialog.operations.map(o => <label key={o.id} className="ps-replace-choice">
            <input type="checkbox" checked={selected.includes(o.id)} onChange={e => setSelected(old => e.target.checked ? [...old, o.id] : old.filter(id => id !== o.id))} />
            替换 {o.label || `${part}切割组`} · {o.ids.length} 面
        </label>)}
    </Modal>;
}

export function StudioDialog({ store, dialog, model }) {
    switch (dialog.type) {
        case 'source-replacement': return <SourceReplacementDialog store={store} model={model} />;
        case 'repeated-source': return <RepeatedSourceDialog store={store} model={model} dialog={dialog} />;
        case 'help': return <HelpDialog onClose={store.closeDialog} />;
        case 'extract': return <ExtractDialog store={store} model={model} dialog={dialog} />;
        case 'custom-gear': return <CustomGearDialog store={store} />;
        default: return null;
    }
}

function SourceReplacementDialog({ store, model }) {
    const [selected, setSelected] = useState([]);
    const eligible = new Set(model.basePlanes.filter(p => p.part === model.draft.part).map(p => p.id));
    const groups = new Map();
    for (const f of model.nativeDocument?.facets ?? []) if (eligible.has(f.id)) {
        if (!groups.has(f.patternId)) groups.set(f.patternId, []);
        groups.get(f.patternId).push(f);
    }
    const part = model.draft.part === 'crown' ? '冠部' : '亭部';
    return <Modal title={`替换来源${part}工序`} confirmText="预览替换所选工序" confirmDisabled={!selected.length}
        onClose={store.closeDialog} onConfirm={() => store.previewSourceReplacement(selected)}>
        <p>用当前组件替换下面明确选中的工序。另一部位与未选工序保持不变；预览后仍需应用整组切割，可撤销。</p>
        {[...groups.entries()].map(([id, faces], i) => <label key={id} className="ps-replace-choice">
            <input type="checkbox" checked={faces.every(f => selected.includes(f.id))} onChange={e => setSelected(old => e.target.checked ? [...new Set([...old, ...faces.map(f => f.id)])] : old.filter(id => !faces.some(f => f.id === id)))} />
            {part}切割组 {i + 1} · {faces.length} 面{faces[0].label ? ` · ${faces[0].label}` : ''}
        </label>)}
    </Modal>;
}
