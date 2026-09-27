import { generatePreset } from './generators.js';
/** Original reproducible recipes, not redistributed third-party cutting charts. */
export function builtinCatalog() {
    const entries = [];
    function add(family, part, name, params, tags = []) { entries.push({ id: `ogc-${String(entries.length + 1).padStart(3, '0')}`, family, part, name, params, tags, provenance: { type: 'procedural-original', license: 'MIT' } }); }
    for (const part of ['crown', 'pavilion']) {
        const cn = part === 'crown' ? '冠' : '亭';
        for (const n of [4, 5, 6, 7, 8, 9, 10, 12, 16])
            add('brilliant', part, `${n === 8 ? '经典八向' : n + ' 向明亮'} · ${cn}`, { symmetry: n, angle: part === 'crown' ? 34.5 : 41, table: .56 }, ['放射', '明亮式']);
        for (const [n, l, name, extra] of [[4, 3, '方形三阶', {}], [8, 3, '八角三阶', {}], [8, 4, '截角长方', { aspect: 1.35, outline: 'emerald' }], [8, 5, '深阶八角', {}], [12, 3, '十二向阶梯', {}], [16, 4, '圆形四阶', {}], [6, 3, '六角三阶', {}], [8, 3, '椭圆阶梯', { aspect: 1.45 }]])
            add('step', part, `${name} · ${cn}`, { symmetry: n, layers: l, angle: part === 'crown' ? 36 : 45, spread: 20, ...extra }, ['阶梯', '同心']);
        for (const n of [6, 8, 12, 16])
            add('stagger', part, `${n} 向错层 · ${cn}`, { symmetry: n, layers: 4, angle: part === 'crown' ? 37 : 47, spread: 24, twist: .5 }, ['错层', '葡萄牙式节奏']);
        for (const n of [4, 6, 8, 16])
            add('fan', part, `${n} 主面基础 · ${cn}`, { symmetry: n, layers: 1, angle: part === 'crown' ? 32 : 42 }, ['基础', '低面数']);
        for (const n of [4, 6, 8])
            add('scissor', part, `${n} 向剪式探索 · ${cn}`, { symmetry: n, layers: 3, angle: part === 'crown' ? 36 : 45, spread: 18, twist: .5 }, ['实验', '双轨道']);
    }
    for (const [n, l] of [[6, 2], [6, 3], [8, 2], [8, 3], [12, 2], [12, 3]])
        add('rose', 'crown', `${n} 向 ${l} 环玫瑰冠`, { symmetry: n, layers: l, height: .56 }, ['三角', '无台面']);
    for (const g of [3, 5, 7, 9])
        add('checker', 'crown', `${g} × ${g} 棋盘曲顶`, { grid: g, height: .46 }, ['网格', '曲顶']);
    for (const [k, l] of [[.25, 3], [.5, 3], [.75, 4], [1, 4]])
        add('keel', 'pavilion', `龙骨 ${k.toFixed(2)} · ${l} 阶亭`, { keel: k, layers: l, angle: 44, spread: 14, bevel: .3 }, ['龙骨线', '截角长方']);
    return entries;
}
export function instantiateCatalog(entry) { return { ...generatePreset({ family: entry.family, part: entry.part, name: entry.name, params: entry.params }), id: entry.id, tags: entry.tags }; }
