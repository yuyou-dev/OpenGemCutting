import { generatePreset, componentPreview } from './generators.js';
import { geometryStats } from './geometry.js';
import { polygonArea, clamp, transformPlane } from './math.js';
import { machineReport } from './machine.js';

export const supportsTiers = component => !!component.recipe && ['step', 'stagger'].includes(component.family) && component.recipe.params.outline === 'round' && Math.abs(component.recipe.params.aspect - 1) < 1e-9;
export function tierValues(component) {
    const p = component.recipe.params;
    return Array.from({ length: p.layers }, (_, i) => ({ id: `tier-${i + 1}`, width: p.tierWidths?.[i] ?? 1, phase: p.tierPhases?.[i] ?? 0 }));
}
export function rhythmWidths(layers, rhythm) {
    return Array.from({ length: layers }, (_, i) => rhythm === 'outer' ? 1.8 - i / Math.max(1, layers - 1) * 1.2 : rhythm === 'inner' ? .6 + i / Math.max(1, layers - 1) * 1.2 : 1);
}
const rimOf = polys => polys.find(f => f.role === 'interface')?.v;
function tierNeighbors(polys) {
    const edges = new Map(), pairs = new Set();
    const key = p => p.map(v => Math.round(v * 1e7)).join(',');
    for (const face of polys) for (let i = 0; i < face.v.length; i++) {
        const edge = [key(face.v[i]), key(face.v[(i + 1) % face.v.length])].sort().join('|');
        const tier = face.tier || face.role, previous = edges.get(edge);
        if (previous && previous !== tier) pairs.add([previous, tier].sort().join('|'));
        edges.set(edge, tier);
    }
    return pairs;
}
function rimDistance(a, b) {
    const distance = (p, ring) => Math.min(...ring.map((q, i) => {
        const r = ring[(i + 1) % ring.length], dx = r[0] - q[0], dy = r[1] - q[1];
        const t = clamp(((p[0] - q[0]) * dx + (p[1] - q[1]) * dy) / (dx * dx + dy * dy), 0, 1);
        return Math.hypot(p[0] - q[0] - t * dx, p[1] - q[1] - t * dy);
    }));
    return Math.max(...a.map(p => distance(p, b)), ...b.map(p => distance(p, a)));
}
/** Creative edits retain visible faces and a closed local body. This is a
 * geometric guard, not an optical or manufacturing certification. */
export function inspectCreative(component, transform, teeth, { reference, keepRim = false } = {}) {
    const polys = componentPreview(component), stats = geometryStats(polys, component.planes);
    if (stats.volume <= 1e-8 || !rimOf(polys) || polys.some(f => f.role === 'stock'))
        return { ok: false, reason: '无法形成完整的冠亭轮廓，请减小调整幅度。' };
    const visible = new Set(polys.filter(f => polygonArea(f.v) > 1e-7).map(f => f.id));
    if (component.planes.some(p => !visible.has(p.id)))
        return { ok: false, reason: '这一步会挤掉或压薄刻面；已保留原造型，请减小调整幅度。' };
    if (!machineReport(component.planes.map(p => transformPlane(p, transform)), teeth).exact)
        return { ok: false, reason: '当前分度不能精确表达这些面，请先在加工分度中选择兼容分度。' };
    if (keepRim && reference) {
        const referencePolys = componentPreview(reference), rim = rimOf(referencePolys);
        if (!rim || rimDistance(rim, rimOf(polys)) > 1e-6)
            return { ok: false, reason: '这一步会改变腰口轮廓；已保留原造型，请减小错位或调整圈层宽度。' };
        const before = tierNeighbors(referencePolys), after = tierNeighbors(polys);
        if (before.size !== after.size || [...after].some(pair => !before.has(pair)))
            return { ok: false, reason: '这一步会改变圈层的相邻关系；请减小错位或调整圈层宽度。' };
    }
    return { ok: true, polys };
}
export function creativeEdit(component, patch, transform, teeth, { keepRim = false } = {}) {
    if (!component.recipe) throw Error('此组件保留的是手工平面，请从参数化预设开始造型。');
    const next = generatePreset({ family: component.family, part: component.part, params: { ...component.recipe.params, ...patch }, name: component.name });
    next.id = component.id;
    const report = inspectCreative(next, transform, teeth, { reference: component, keepRim });
    if (!report.ok) throw Error(report.reason);
    return next;
}
export function editTier(component, index, { width, teethOffset }, transform, teeth) {
    if (!supportsTiers(component)) throw Error('圈层编排支持圆形阶梯式与错层环式。');
    const tiers = tierValues(component);
    if (!tiers[index]) throw Error('请先选择一个圈层。');
    const patch = {};
    if (width !== undefined) patch.tierWidths = tiers.map((t, i) => i === index ? width : t.width);
    if (teethOffset !== undefined) {
        if (!Number.isInteger(teethOffset)) throw Error('错位必须是整数齿，不能自动取整。');
        if (transform.scale && Math.abs(transform.scale[0] - transform.scale[1]) > 1e-9)
            throw Error('当前组件有非等比径向拉伸，旋转会改变切角；请先将 X / Y 缩放设为相同。');
        patch.tierPhases = tiers.map((t, i) => i === index ? teethOffset * 360 / teeth : t.phase);
    }
    return creativeEdit(component, patch, transform, teeth, { keepRim: true });
}

/** Deliberate, reproducible alternatives; never randomize technical parameters. */
export function variationPatches(component) {
    const p = component.recipe?.params;
    if (!p) return [];
    if (supportsTiers(component)) return [
        { title: '外圈舒展', caption: '向外加宽，向内收密', patch: { tierWidths: rhythmWidths(p.layers, 'outer') } },
        { title: '内圈舒展', caption: '向内加宽，外圈收密', patch: { tierWidths: rhythmWidths(p.layers, 'inner') } },
        { title: '宽窄交替', caption: '让层带形成轻重节奏', patch: { tierWidths: Array.from({ length: p.layers }, (_, i) => i % 2 ? .7 : 1.4) } },
    ];
    if (component.family === 'brilliant') return component.part === 'crown' ? [
        { title: '小台面', caption: '增加周围刻面的存在感', patch: { table: clamp(p.table - .09, .15, .8) } },
        { title: '大台面', caption: '让中心更开阔', patch: { table: clamp(p.table + .09, .15, .8) } },
        { title: '星面展开', caption: '延展环绕中心的节奏', patch: { star: clamp(p.star + .15, .2, .8) } },
    ] : [
        { title: '宽面节奏', caption: '缩短下腰面的延伸', patch: { lower: clamp(p.lower - .14, .3, .9) } },
        { title: '细面节奏', caption: '延长下腰面的延伸', patch: { lower: clamp(p.lower + .1, .3, .9) } },
        { title: '收浅轮廓', caption: '让亭部的侧面更轻盈', patch: { angle: clamp(p.angle - 4, 10, 70) } },
    ];
    const key = ['rose', 'checker'].includes(component.family) ? 'height' : 'angle';
    return [ .85, 1.15 ].map((factor, i) => ({ title: i ? '饱满轮廓' : '轻盈轮廓', caption: '只调整轮廓起伏', patch: { [key]: p[key] * factor } }));
}
