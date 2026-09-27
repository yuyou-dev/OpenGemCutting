import { GENERATORS, componentPreview } from '../domain/generators.js';
import { builtinCatalog, instantiateCatalog } from '../domain/catalog.js';
import { GEAR_CATALOG, machineReport, rotationIndex, snapIndex } from '../domain/machine.js';
import { instancePlanes } from '../adapters/opengemcutting.js';
import { clone } from '../domain/math.js';
import { thumbnailSVG } from '../viewport/viewport.js';

/** Parameter editor metadata (labels, ranges, units) for the generator recipes. */
export const controlDefinitions = { symmetry: ['对称 / 方向数', 3, 32, 1, 'N'], layers: ['层数', 1, 8, 1, '层'], angle: ['主面 / 中心行业角', 5, 80, .1, '°'], spread: ['逐层角度总差', 0, 60, .1, '°'], table: ['台宽构造比', .06, .92, .01, 'ratio'], culet: ['底小面构造比', 0, .4, .01, 'ratio'], star: ['星面交点构造位置', .15, .85, .01, 'ratio'], lower: ['下腰面构造长度', .25, .9, .01, 'ratio'], phase: ['整体初始相位', -180, 180, .25, '°'], twist: ['层间 / 双轨道偏移', -1, 1, .01, 'sector'], aspect: ['X / Y 比例', .45, 2.6, .01, 'ratio'], height: ['曲顶相对高度', .08, 1.5, .01, 'R'], grid: ['棋盘网格阶数', 3, 9, 1, 'N'], bevel: ['截角系数', .05, .8, .01, 'ratio'], keel: ['半龙骨长度', 0, 1.5, .01, 'R'] };
export const familyFields = { brilliant: ['symmetry', 'angle', 'table', 'star', 'lower', 'culet', 'phase', 'aspect'], step: ['symmetry', 'layers', 'angle', 'spread', 'table', 'culet', 'phase', 'aspect', 'bevel'], stagger: ['symmetry', 'layers', 'angle', 'spread', 'twist', 'table', 'culet', 'phase', 'aspect'], fan: ['symmetry', 'angle', 'table', 'culet', 'phase', 'aspect'], scissor: ['symmetry', 'layers', 'angle', 'spread', 'twist', 'table', 'culet', 'phase', 'aspect'], rose: ['symmetry', 'layers', 'height', 'phase', 'aspect'], checker: ['grid', 'height', 'phase', 'aspect'], keel: ['layers', 'angle', 'spread', 'keel', 'bevel', 'culet', 'phase', 'aspect'] };

/** Shared built-in catalog with per-id instance and thumbnail caches. */
const catalog = builtinCatalog(), instanceCache = new Map(), thumbCache = new Map();
export function builtinEntries() { return catalog; }
export function defaultSelectedPreset() { return catalog.find(c => c.part === 'crown' && c.family === 'brilliant' && c.params.symmetry === 8).id; }
export function getBuiltin(id) { if (!instanceCache.has(id))
    instanceCache.set(id, instantiateCatalog(catalog.find(e => e.id === id))); return clone(instanceCache.get(id)); }
export function getThumb(c) { const key = c.id + JSON.stringify(c.planes); if (!thumbCache.has(key)) {
    try {
        thumbCache.set(key, thumbnailSVG(componentPreview(c), c.part));
    }
    catch {
        thumbCache.set(key, '<svg viewBox="0 0 96 88"><path d="M20 65L48 20 76 65Z" fill="none" stroke="#e59bb8"/></svg>');
    }
} return thumbCache.get(key); }

export function fieldView(key, params, teeth) {
    let [name, min, max, step, unit] = controlDefinitions[key], value = params[key];
    if (key === 'phase') {
        name = '基准分度'; min = 0; max = teeth - 1; step = 1; unit = '齿'; value = rotationIndex(value, teeth);
    }
    return { key, name, min, max, step, unit, value: Number(value.toFixed(8)) };
}

/** Build-panel view model: generator select, optional outline rule, parameter fields. */
export function buildPanelView(draft, teeth) {
    const c = draft, p = c.recipe?.params;
    if (!p)
        return { recipe: false, notice: c.validationNotice || c.notes || '保存时保留所有工序平面，包括被其他切面遮住的平面。' };
    const available = Object.entries(GENERATORS).filter(([key]) => c.part === 'crown' ? key !== 'keel' : !['rose', 'checker'].includes(key)).map(([key, g]) => ({ key, name: g.name }));
    const keys = familyFields[c.family].filter(k => !(c.part === 'crown' && ['culet', 'lower'].includes(k)) && !(c.part === 'pavilion' && ['table', 'star'].includes(k)) && (k !== 'bevel' || p.outline === 'emerald' || c.family === 'keel'));
    return { recipe: true, family: c.family, available, description: GENERATORS[c.family].description, outline: c.family === 'step' ? p.outline : null, fields: keys.map(k => fieldView(k, p, teeth)) };
}

export function transformPanelView(model, linkXY) {
    const t = model.transform, i = snapIndex(rotationIndex(t.rotation[2], model.machine.teeth), model.machine.teeth);
    return { tz: Number(t.translation[2].toFixed(6)), index: i || model.machine.teeth, teeth: model.machine.teeth, rotationDeg: t.rotation[2].toFixed(4), scale: t.scale.map(v => Number(v.toFixed(6))), linkXY };
}

export function machineBarView(machine) {
    const g = machine.teeth, known = GEAR_CATALOG.some(x => x.teeth === g);
    return { teeth: g, known, options: GEAR_CATALOG.map(x => ({ teeth: x.teeth, suffix: x.kind === 'software' ? ' · 软件' : x.kind === 'documented' ? ' · 文献' : '' })), perTooth: (360 / g).toFixed(5).replace(/0+$/, '').replace(/\.$/, '') };
}

/** Library cards with thumbnails and per-gear compatibility flags. */
export function libraryView(ui, teeth) {
    const families = Object.keys(GENERATORS).filter(f => catalog.some(e => e.part === ui.library && e.family === f));
    const filters = [{ key: 'all', name: '全部' }, ...families.map(k => ({ key: k, name: GENERATORS[k].name.replace(' · 实验', '') }))];
    const source = catalog.filter(c => c.part === ui.library);
    const list = source.filter(c => (ui.filter === 'all' || c.family === ui.filter) && `${c.name} ${(c.tags || []).join(' ')} ${c.family}`.toLowerCase().includes(ui.search.toLowerCase()));
    const cards = list.map(entry => { const c = getBuiltin(entry.id); return { id: entry.id, name: entry.name, thumb: getThumb(c), planes: c.planes.length, gearNote: machineReport(c.planes, teeth).exact ? `${teeth} 整齿` : '需分度适配', active: ui.selectedPreset === entry.id }; });
    const count = `${list.length} / 70 RECIPES`;
    return { filters, cards, count };
}

/** All cutting planes of the current workspace, committed groups first, draft last. */
export function previewPlanesOf(model) { return [...model.basePlanes.filter(p => !(model.replacementIds ?? []).includes(p.id)), ...(model.girdlePlanes ?? []), ...model.groups.filter(g => model.draftActive === false || g.id !== model.editId).flatMap(g => instancePlanes(g.component, g.transform, g.id)), ...(model.draftActive === false ? [] : instancePlanes(model.draft, model.transform, 'draft'))]; }
