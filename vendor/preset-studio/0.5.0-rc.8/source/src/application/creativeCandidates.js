import { generatePreset } from '../domain/generators.js';
import { creativeEdit, inspectCreative, variationPatches } from '../domain/creative.js';
import { cutSolid, geometryStats } from '../domain/geometry.js';
import { clone, normalizeTransform } from '../domain/math.js';
import { fitReferenceRim } from '../domain/rim-fit.js';
import { previewPlanesOf } from './viewModels.js';
import { planesEquivalent } from '../domain/io.js';

export function pairingTarget(model) {
    return model.groups.filter(g => g.component.part !== model.draft.part).at(-1);
}
export function comparisonSolid(model, component, transform, editId = model.editId) {
    if (!model.stock.convex) throw Error('组合比较暂时需要凸底胚；非凸原石可继续使用原有参数编辑。');
    const next = { ...model, draft: component, draftActive: true, transform, editId };
    const polys = cutSolid(model.stock.polys, previewPlanesOf(next), { convex: true });
    if (geometryStats(polys).volume <= 1e-8) throw Error('这组搭配会把晶体切空，请调整位置后再比较。');
    if (!polys.some(f => f.instanceId === 'draft')) throw Error('这组刻面没有显露，请调整底胚或组件位置。');
    return polys;
}

/** Each comparison is immutable and independent of the editor's undo history. */
export function buildCreativeChoices(model, mode) {
    const part = model.draft.part === 'crown' ? 'pavilion' : 'crown';
    const pairSpecs = [
        { title: '明亮搭配', caption: '放射主面与细面节奏', family: 'brilliant' },
        { title: '阶梯搭配', caption: '整齐的宽面与层次', family: 'step' },
        { title: '简面搭配', caption: '减少分割，突出大面', family: 'fan' },
        { title: '错层搭配', caption: '交替错开的圈层节奏', family: 'stagger' },
    ];
    const opposite = pairingTarget(model);
    const specs = mode === 'pair' ? opposite ? [{ title: '当前搭配', caption: '已应用的组合作为基准', original: true }, ...pairSpecs.filter(s => s.family !== opposite.component.family).slice(0, 3)] : pairSpecs : [{ title: '当前造型', caption: '作为比较基准', original: true }, ...variationPatches(model.draft)];
    return specs.map(spec => {
        try {
            let component, transform = clone(model.transform), editId = model.editId, adjustment = '';
            if (mode === 'pair') {
                if (model.basePlanes.some(p => p.part === part)) throw Error('来源中已有这一部位的切割，请先在主项目整理为独立组件后搭配。');
                component = spec.original ? clone(opposite.component) : generatePreset({ family: spec.family, part, params: { symmetry: model.draft.recipe?.params.symmetry ?? 8 } });
                editId = opposite?.id ?? null;
                transform = opposite ? clone(opposite.transform) : normalizeTransform({ translation: [0, 0, -model.transform.translation[2]] });
                const fit = spec.original ? { transform, deviation: 0, exact: true } : fitReferenceRim(component, transform, model.stock, previewPlanesOf(model));
                transform = fit.transform;
                if (!spec.original) {
                    const report = inspectCreative(component, transform, model.machine.teeth);
                    if (!report.ok) throw Error(report.reason);
                }
                adjustment = spec.original ? '保留当前组合，作为比较基准。' : `仅等比调整${part === 'crown' ? '冠' : '亭'}部 · 腰口偏差 ${(fit.deviation * 100).toFixed(2)}%${fit.exact ? '' : '，不能整圈重合'}`;
            } else component = spec.original ? clone(model.draft) : creativeEdit(model.draft, spec.patch, transform, model.machine.teeth);
            const unchanged = mode !== 'pair' && !spec.original && planesEquivalent(component.planes, model.draft.planes);
            return { ...spec, component, transform, editId, adjustment, unchanged, polys: comparisonSolid(model, component, transform, editId) };
        } catch (e) { return { ...spec, reason: e.message }; }
    });
}
