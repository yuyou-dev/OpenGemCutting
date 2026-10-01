import { rad, deg, sub, mul, dot, cross, norm, finite, normalizePlane, transformPlane, clone } from './math.js';
import { cubeSolid, clipConvex, geometryStats, topologySignature } from './geometry.js';
export const GENERATORS = Object.freeze({
    brilliant: { name: '明亮式', code: 'BRILLIANT', description: '主面 + 星面 + 上腰面 / 下腰面，解析交点构造。' },
    step: { name: '阶梯式', code: 'STEP', description: '同相位同心环；按逐层角度与径向宽度推导高度。' },
    stagger: { name: '错层环式', code: 'STAGGER', description: '层间相位交错；葡萄牙式节奏的程序化探索，不是指定切工复刻。' },
    fan: { name: '放射主面', code: 'FAN', description: '单圈主面与台面 / 尖底，低面数基础结构。' },
    rose: { name: '三角玫瑰冠', code: 'ROSE', description: '交错顶点环的凸支持面；无台面浅拱冠部。' },
    checker: { name: '棋盘曲顶', code: 'CHECKER', description: '二次曲面的支持平面网格；真实刻面，不是纹理贴图。' },
    keel: { name: '龙骨线阶梯亭', code: 'KEEL', description: '线段支持函数 + 截角阶梯；底部汇成真底棱而不是拉长尖点。' },
    scissor: { name: '剪式节奏 · 实验', code: 'SCISSOR', description: '双相位轨道多层平面；不声称符合标准 Princess/Chevron 拓扑。' }
});
export const DEFAULT_PARAMS = Object.freeze({ symmetry: 8, layers: 3, angle: 34.5, spread: 16, table: .56, culet: 0, star: .5, lower: .75, phase: 0, twist: .5, aspect: 1, height: .52, grid: 5, bevel: .3, keel: .5, outline: 'round' });
function recipeParams(part, family, input = {}) {
    if (!GENERATORS[family] || !['crown', 'pavilion'].includes(part))
        throw new Error('未知生成器或部位');
    const p = { ...DEFAULT_PARAMS, angle: part === 'pavilion' ? 41 : 34.5, ...input };
    if (family === 'keel') {
        p.symmetry = 8;
        p.outline = 'emerald';
        if (part !== 'pavilion')
            throw new Error('龙骨线只用于亭部');
    }
    if (['rose', 'checker'].includes(family) && part !== 'crown')
        throw new Error('玫瑰/棋盘生成器仅用于冠部');
    for (const [key, min, max] of [['symmetry', 3, 32], ['layers', 1, 8], ['angle', 5, 80], ['spread', 0, 60], ['table', .06, .92], ['culet', 0, .4], ['star', .15, .85], ['lower', .25, .9], ['aspect', .45, 2.6], ['phase', -360, 360], ['twist', -1, 1], ['height', .08, 1.5], ['grid', 3, 9], ['bevel', .05, .8], ['keel', 0, 1.5]])
        finite(p[key], key, min, max);
    for (const k of ['symmetry', 'layers', 'grid'])
        if (!Number.isInteger(p[k]))
            throw new Error(`${k} 需要整数`);
    if (!['round', 'emerald'].includes(p.outline))
        throw new Error('未知轮廓');
    if (p.outline === 'emerald' && p.symmetry !== 8)
        throw new Error('截角轮廓需要 8 个方向');
    for (const [key, min, max, fallback] of [['tierWidths', .1, 6, 1], ['tierPhases', -360, 360, 0]]) {
        if (input[key] === undefined) continue;
        if (!['step', 'stagger'].includes(family) || !Array.isArray(input[key]) || input[key].length > 8)
            throw new Error('圈层编排仅支持阶梯式与错层环式，最多 8 层');
        input[key].forEach(value => finite(value, key, min, max));
        p[key] = Array.from({ length: p.layers }, (_, i) => input[key][i] ?? fallback);
    }
    return p;
}
function ringPlane(a, theta, r, z, sign, meta) { const aa = rad(a), th = rad(theta); return { ...meta, n: [Math.sin(aa) * Math.cos(th), Math.sin(aa) * Math.sin(th), sign * Math.cos(aa)], d: Math.sin(aa) * r + Math.cos(aa) * z }; }
function terminalPlane(z, part, role = 'table') { return { id: `${part}-${role}`, tier: role, role, part, isCut: true, n: [0, 0, part === 'crown' ? 1 : -1], d: z }; }
function supportedRosePlanes(p) {
    if (p.symmetry * p.layers > 96)
        throw new Error('玫瑰冠限制：对称数 × 层数 ≤ 96');
    const pts = [[0, 0, p.height]];
    for (let l = 0; l < p.layers; l++) {
        const r = 1 - l / p.layers, z = p.height * (1 - r * r);
        for (let i = 0; i < p.symmetry; i++) {
            const a = 2 * Math.PI * (i + (l % 2) * .5) / p.symmetry;
            pts.push([r * Math.cos(a), r * Math.sin(a), z]);
        }
    }
    const out = [], keys = new Set();
    for (let i = 0; i < pts.length; i++)
        for (let j = i + 1; j < pts.length; j++)
            for (let k = j + 1; k < pts.length; k++) {
                let n = cross(sub(pts[j], pts[i]), sub(pts[k], pts[i]));
                const len = norm(n);
                if (len < 1e-9 || Math.abs(n[2]) < 1e-9)
                    continue;
                n = mul(n, (n[2] < 0 ? -1 : 1) / len);
                const d = dot(n, pts[i]);
                if (pts.some(q => dot(n, q) > d + 1e-8))
                    continue;
                const key = [...n, d].map(x => Math.round(x * 1e7)).join(',');
                if (keys.has(key))
                    continue;
                keys.add(key);
                out.push({ n, d, id: `crown-rose-${out.length}`, part: 'crown', role: 'rose', tier: 'rose', isCut: true });
            }
    return out;
}
export function generatePreset({ family = 'brilliant', part = 'crown', params = {}, name } = {}) {
    const p = recipeParams(part, family, params), N = p.symmetry, s = part === 'crown' ? 1 : -1, step = 360 / N;
    let planes = [];
    const meta = (tier, role, i) => ({ id: `${part}-${tier}-${i}`, tier, role, part, isCut: true });
    if (family === 'brilliant') {
        const tan = Math.tan(rad(p.angle)), half = Math.cos(Math.PI / N), quarter = Math.cos(Math.PI / (2 * N));
        for (let i = 0; i < N; i++)
            planes.push(ringPlane(p.angle, i * step, 1, 0, s, meta('main', 'main', i)));
        if (part === 'crown') {
            const h = (1 - p.table) * tan, rs = p.table / half + (1 - p.table / half) * p.star, zs = tan * (1 - rs * half);
            if (rs >= 1 || zs <= 0)
                throw new Error('台面过大，星面交点无法形成；请减小台宽比');
            const ast = deg(Math.atan2(h - zs, rs - p.table * half)), aup = deg(Math.atan2(zs, quarter * (1 - rs)));
            if (ast <= 0 || aup >= 89.5)
                throw new Error('星面 / 上腰面退化，请调整参数');
            for (let i = 0; i < N; i++) {
                planes.push(ringPlane(ast, (i + .5) * step, rs, zs, s, meta('star', 'star', i)));
                for (const q of [.25, .75])
                    planes.push(ringPlane(aup, (i + q) * step, quarter, 0, s, meta('upper', 'upper', i * 2 + (q === .75 ? 1 : 0))));
            }
            planes.push(terminalPlane(h, part));
        }
        else {
            const r = 1 - p.lower, z = tan * (1 - r * half), a = deg(Math.atan2(z, quarter * (1 - r)));
            for (let i = 0; i < 2 * N; i++)
                planes.push(ringPlane(a, (i + .5) * step / 2, quarter, 0, s, meta('lower', 'lower', i)));
            if (p.culet > 0)
                planes.push(terminalPlane(tan * (1 - p.culet), part, 'culet'));
        }
    }
    else if (family === 'rose')
        planes = supportedRosePlanes(p);
    else if (family === 'checker') {
        for (let i = 0; i < p.grid; i++)
            for (let j = 0; j < p.grid; j++) {
                const x = (i - (p.grid - 1) / 2) * 1.4 / (p.grid - 1), y = (j - (p.grid - 1) / 2) * 1.4 / (p.grid - 1);
                planes.push(normalizePlane({ ...meta(`row-${j}`, 'checker', i * p.grid + j), n: [2 * p.height * x, 2 * p.height * y, s], d: p.height * (1 + x * x + y * y) }));
            }
    }
    else {
        const layers = family === 'fan' ? 1 : p.layers, inner = part === 'crown' ? p.table : p.culet;
        let r = 1, z = 0, accumulatedWidth = 0;
        const widths = p.tierWidths ?? Array(layers).fill(1), totalWidth = widths.reduce((sum, w) => sum + w, 0);
        for (let l = 0; l < layers; l++) {
            const a = p.angle + (layers === 1 ? 0 : p.spread * (.5 - l / (layers - 1)));
            if (a < 2 || a > 87)
                throw new Error('逐层角度超出 2°–87°，请减小角差');
            accumulatedWidth += widths[l];
            const next = 1 - (1 - inner) * accumulatedWidth / totalWidth, phase = (family === 'stagger' ? (l % 2) * p.twist * step : 0) + (p.tierPhases?.[l] ?? 0), shifts = family === 'scissor' ? [-p.twist * .18 * step, p.twist * .18 * step] : [phase];
            for (let i = 0; i < N; i++)
                for (let q = 0; q < shifts.length; q++) {
                    const th = i * step + shifts[q], outline = p.outline === 'emerald' ? (Math.abs(Math.sin(rad(2 * th))) > .7 ? (2 - p.bevel) / Math.sqrt(2) : 1) : 1;
                    const angle = family === 'keel' ? deg(Math.atan(Math.tan(rad(a)) / outline)) : a;
                    planes.push(ringPlane(angle, th, (family === 'keel' ? p.keel * Math.abs(Math.cos(rad(th))) : 0) + r * outline, z, s, meta(`tier-${l + 1}`, family === 'fan' ? 'main' : family, i * shifts.length + q)));
                }
            z += (r - next) * Math.tan(rad(a));
            r = next;
        }
        if (part === 'crown' || p.culet > 0)
            planes.push(terminalPlane(z, part, part === 'crown' ? 'table' : 'culet'));
    }
    if (planes.length > 512)
        throw new Error('预设最多 512 平面');
    planes = planes.map(q => transformPlane(q, { scale: [p.aspect, 1, 1], rotation: [0, 0, p.phase] }));
    return { kind: 'opengemcutting-component', schemaVersion: 1, id: `builtin-${family}-${part}`, name: name || `${GENERATORS[family].name} · ${part === 'crown' ? '冠部' : '亭部'}`, part, family, recipe: { generator: family, version: p.tierWidths || p.tierPhases ? 2 : 1, params: p }, planes, frame: { origin: [0, 0, 0], axis: [0, 0, 1], referenceRadius: 1, unit: 'normalized' }, provenance: { type: 'procedural-original', license: 'MIT', source: 'OpenGemCutting Preset Studio' }, notes: family === 'scissor' ? '实验性节奏，不等于标准 Princess/Chevron。' : '' };
}
export function componentPreview(component) {
    const sign = component.part === 'crown' ? 1 : -1;
    // Display cap is not a cutting instruction; canonical component never owns it.
    const cuts=[...component.planes,{n:[0,0,-sign],d:0,id:'interface-preview-only',role:'interface',part:'interface',isCut:false}];
    let polys=[];
    for(const size of [16,64,256,1024]){polys=clipConvex(cubeSolid(size),cuts);if(!polys.some(f=>f.role==='stock'))break;}
    return polys;
}
export function inspectComponent(component) { const polys = componentPreview(component), stats = geometryStats(polys, component.planes); return { stats, signature: topologySignature(polys), polys }; }
export function editPlane(component, id, { angle, azimuth, d } = {}) {
    const c = clone(component);
    delete c.recipe;
    c.family = 'custom';
    c.provenance = { ...c.provenance, type: 'user-edited' };
    const p = c.planes.find(q => q.id === id);
    if (!p)
        throw new Error('未找到刻面');
    const a = angle === undefined ? deg(Math.acos(Math.min(1, Math.abs(p.n[2])))) : finite(angle, '角度', 0, 90), th = azimuth === undefined ? deg(Math.atan2(p.n[1], p.n[0])) : finite(azimuth, '方位', -720, 720);
    // Preserve unusual hand-made plane orientation rather than forcing it by label.
    const s = Math.abs(p.n[2]) < 1e-12 ? (c.part === 'crown' ? 1 : -1) : Math.sign(p.n[2]);
    p.n = [Math.sin(rad(a)) * Math.cos(rad(th)), Math.sin(rad(a)) * Math.sin(rad(th)), s * Math.cos(rad(a))];
    if (d !== undefined)
        p.d = finite(d, '偏移', -10000, 10000);
    return c;
}
