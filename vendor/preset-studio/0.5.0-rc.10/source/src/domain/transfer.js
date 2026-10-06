import { LIMITS, parseJSONSafe, validateComponent, importOBJ, importSTL, importNativeDocument } from './io.js';
import { validateWorkspace } from './workspace.js';

/** Read and validate without mutating a workspace or source files.
 * The modal shows this plan first; commit is an explicit, version-checked action.
 */
export async function readTransferFile(file) {
    if (!file || typeof file.text !== 'function' || !Number.isFinite(file.size)) throw new TypeError('请选择本地文件');
    if (file.size > LIMITS.fileBytes) throw new Error('文件超过 8 MiB，请先简化后导入');
    if (file.size === 0) throw new Error('文件为空');
    const name = file.name || 'import.json';
    const base = { name, bytes: file.size, warnings: [] };
    if (/\.(obj|stl)$/i.test(name)) {
        const stock = /\.obj$/i.test(name) ? importOBJ(await file.text(), { name }) : importSTL(await file.arrayBuffer(), { name });
        return { ...base, kind: 'mesh', label: '原石网格', payload: stock,
            summary: `${stock.polys.length} 个原石面 · ${stock.convex ? '凸实体' : '非凸实体'}`,
            impact: '替换当前原石，并清空已应用工序；当前冠亭草稿保留。可撤销。' };
    }
    if (!/\.json$/i.test(name)) throw new Error('暂不支持此格式；请使用预设 / 工作区 / 本体 JSON，或 OBJ、STL 原石');
    const data = parseJSONSafe(await file.text());
    switch (data?.kind) {
        case 'opengemcutting-component': {
            const component = validateComponent(data);
            return { ...base, kind: 'component', label: '冠亭预设', payload: component,
                summary: `${component.name} · ${component.part === 'crown' ? '冠部' : '亭部'} · ${component.planes.length} 个工序面`,
                impact: '替换当前组件草稿，不改变原石或已应用工序。需要点击“应用整组切割”才会提交。' };
        }
        case 'opengemcutting-component-workspace': {
            const state = validateWorkspace(data);
            return { ...base, kind: 'workspace', label: '完整工作区', payload: state,
                summary: `${state.machine.teeth} 分度 · ${state.groups.length} 组工序${state.girdlePlanes.length ? ` · ${state.girdlePlanes.length} 面独立腰棱` : ''} · 含当前草稿`,
                impact: '替换当前工作区的原石、工序、草稿与机台配置。可撤销。' };
        }
        case 'facet-96-document': {
            const native = importNativeDocument(data);
            return { ...base, kind: 'native', label: 'OpenGemCutting 本体文档', payload: native, warnings: [...native.notices, ...native.warnings],
                summary: `${native.machine.teeth} 分度 · ${native.groups.length} 组冠亭 · ${native.basePlanes.length} 个原有工序面`,
                impact: '载入本体晶体和完整工序，保留来源分度与参考系；不修改来源文件。可撤销。' };
        }
        default: throw new Error('未知 JSON：支持冠亭预设、工作区及本体 facet-96-document');
    }
}

export const TRANSFER_EXPORTS = Object.freeze([
    { id: 'workspace', title: '完整工作区', format: 'JSON', filename: 'OpenGemCutting-workspace.json',
        description: '继续编辑或交接项目。保留原石、组件与腰棱工序、当前草稿、同轴变换与分度设置。',
        note: '包含当前未应用的修改。' },
    { id: 'component', title: '当前冠亭预设', format: 'JSON', filename: 'OpenGemCutting-component.json',
        description: '分享、复用当前冠部或亭部。保留局部坐标中的完整几何和可用的参数配方。',
        note: '不包含整体摆放、缩放或独立腰棱重整；保存完整结果请导出工作区。' },
    { id: 'native', title: 'OpenGemCutting 本体', format: 'JSON', filename: 'OpenGemCutting-native.json',
        description: '交给主琢型编辑器继续设计，保存原石与真实工序平面。',
        note: '包含当前草稿的预览结果。新组件按当前整数分度检查，来源工序保留精确形状，不会自动取整。' },
    { id: 'obj', title: '切割结果网格', format: 'OBJ', filename: 'OpenGemCutting-result.obj',
        description: '将当前切割预览的实体网格交给其他三维软件。',
        note: '包含尚未应用的当前草稿；仅几何，不保留配方、工序或加工可行性保证。' },
]);
export function transferFilename(value, type) {
    const ext = type === 'obj' ? '.obj' : '.json';
    const clean = String(value || '').trim();
    if (!clean || /[\\/:*?"<>|\u0000-\u001f]/.test(clean) || clean.length > 160 || clean === '.' || clean === '..') throw new Error('请输入有效文件名（不含路径，最多 160 字符）');
    return clean.toLowerCase().endsWith(ext) ? clean : clean + ext;
}
