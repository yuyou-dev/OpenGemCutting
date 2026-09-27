import { inspectLabDocument, normalizeIndexGear } from '../../vendor/labs-contract/1.1.0/index.js';
import { sub, dot, cross, norm, mul, rad, finite, clone, uid, vector, transformPlane, normalizePlane, polygonNormal, polygonArea, cleanPolygon, signedVolume, boundingBox, uniquePoints } from './math.js';
import { normalizeAxialTransform } from './machine.js';
import { cubeSolid } from './geometry.js';
import { generatePreset } from './generators.js';
export const LIMITS = Object.freeze({ fileBytes: 8 * 1024 * 1024, planes: 512, meshFaces: 2000, groups: 64, basePlanes: 2048 });
export function parseJSONSafe(text) { if (new TextEncoder().encode(text).length > LIMITS.fileBytes)
    throw new Error('JSON 超过 8 MiB'); return JSON.parse(text, (key, value) => { if (['__proto__', 'prototype', 'constructor'].includes(key))
    throw new Error('JSON 含保留字段'); return value; }); }
export function planesEquivalent(a, b, tol = 1e-7) { return a.length === b.length && a.every((p, i) => norm(sub(p.n, b[i].n)) < tol && Math.abs(p.d - b[i].d) < tol); }
export function validateComponent(input) {
    if (input?.kind !== 'opengemcutting-component' || input.schemaVersion !== 1)
        throw new Error('不是受支持的冠亭预设 JSON v1');
    if (!['crown', 'pavilion'].includes(input.part))
        throw new Error('部件类型无效');
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 160)
        throw new Error('预设名称需为 1–160 个字符');
    if (!Array.isArray(input.planes) || !input.planes.length || input.planes.length > LIMITS.planes)
        throw new Error('预设需包含 1–512 平面');
    const ids = new Set(), planes = input.planes.map((p, i) => { const q = normalizePlane(p); finite(q.d, '平面偏移', -10000, 10000); q.id = String(p.id || `custom-${i}`); if (q.id.length > 240 || ids.has(q.id))
        throw new Error('重复或过长的平面 ID'); ids.add(q.id); return q; });
    const result = { ...clone(input), id: String(input.id || uid()), planes };
    const frame = { origin: [0, 0, 0], axis: [0, 0, 1], referenceRadius: 1, unit: 'normalized' };
    if (input.frame) {
        const f = input.frame;
        if (norm(sub(vector(f.origin), frame.origin)) > 1e-9 || norm(sub(vector(f.axis), frame.axis)) > 1e-9 || f.referenceRadius !== 1 || f.unit !== 'normalized')
            throw new Error('frame 不是规范腰口坐标；请先烘焙到平面');
    }
    result.frame = frame;
    // Frozen geometry wins over stale/unknown recipes. Never rewrite user planes.
    if (result.recipe) {
        let match = false;
        try {
            const r = result.recipe;
            if (r.version === 1 || r.version === 2) {
                const generated = generatePreset({ family: r.generator, part: result.part, params: r.params });
                match = generated.recipe.version === r.version && planesEquivalent(planes, generated.planes);
            }
        }
        catch { /* preserve frozen data */ }
        if (!match) {
            result.unresolvedRecipe = result.recipe;
            delete result.recipe;
            result.family = 'custom';
            result.validationNotice = '配方与平面不一致或版本未知，已保留原始几何为自定义件';
        }
        else
            result.family = result.recipe.generator;
    }
    if (!result.recipe)
        result.family = 'custom';
    return result;
}
/** Closed oriented two-manifold validation. Does not claim global self-intersection testing. */
export function validateMesh(polys, { checkConvex = true } = {}) {
    if (!Array.isArray(polys) || polys.length < 4 || polys.length > LIMITS.meshFaces)
        throw new Error(`原石需为闭合网格，最多 ${LIMITS.meshFaces} 面`);
    const edges = new Map(), neighbors = polys.map(() => new Set()), points = [];
    const key = v => v.map(x => Math.round(x * 1e7)).join(',');
    for (let fi = 0; fi < polys.length; fi++) {
        const p = polys[fi];
        if (!Array.isArray(p.v) || p.v.length < 3 || p.v.length > 256)
            throw new Error('无效的多边形面');
        p.v.forEach(v => vector(v, '网格坐标').forEach(x => finite(x, '网格坐标', -1e5, 1e5)));
        const n = polygonNormal(p.v);
        if (norm(n) < .5 || polygonArea(p.v) < 1e-12)
            throw new Error('网格有零面积面');
        const d = dot(n, p.v[0]);
        if (p.v.some(v => Math.abs(dot(n, v) - d) > 1e-5))
            throw new Error('非共面多边形，请先三角化');
        points.push(...p.v);
        for (let i = 0; i < p.v.length; i++) {
            const a = key(p.v[i]), b = key(p.v[(i + 1) % p.v.length]);
            if (a === b)
                throw new Error('网格存在退化短边');
            const k = [a, b].sort().join('|');
            if (!edges.has(k))
                edges.set(k, []);
            edges.get(k).push({ fi, sign: a < b ? 1 : -1 });
        }
    }
    let bad = 0;
    for (const list of edges.values()) {
        if (list.length !== 2 || list[0].sign + list[1].sign !== 0) {
            bad++;
            continue;
        }
        neighbors[list[0].fi].add(list[1].fi);
        neighbors[list[1].fi].add(list[0].fi);
    }
    if (bad)
        throw new Error(`网格有 ${bad} 条非闭合、非流形或绕序错误边；未作凸包替换`);
    const seen = new Set(), shells = [];
    for (let i = 0; i < polys.length; i++)
        if (!seen.has(i)) {
            const queue = [i], shell = [];
            seen.add(i);
            while (queue.length) {
                const j = queue.pop();
                shell.push(polys[j]);
                for (const k of neighbors[j])
                    if (!seen.has(k)) {
                        seen.add(k);
                        queue.push(k);
                    }
            }
            if (signedVolume(shell) <= 1e-10)
                throw new Error('原石包含反向或零体积壳；独立嵌套内腔不支持');
            shells.push(shell);
        }
    const boxes = shells.map(boundingBox);
    for (let i = 0; i < boxes.length; i++)
        for (let j = 0; j < boxes.length; j++)
            if (i !== j && boxes[i].lo.every((v, k) => v > boxes[j].lo[k] + 1e-7) && boxes[i].hi.every((v, k) => v < boxes[j].hi[k] - 1e-7))
                throw new Error('检测到包围盒嵌套的独立壳；请先合并为有效实体');
    const verts = uniquePoints(points);
    let convex = true;
    if (checkConvex)
        for (const p of polys) {
            const n = polygonNormal(p.v), d = dot(n, p.v[0]);
            if (verts.some(v => dot(n, v) > d + 1e-6)) {
                convex = false;
                break;
            }
        }
    return { valid: true, convex, vertices: verts.length, shells: shells.length };
}
export function triangulateFace(v) {
    if (v.length < 3 || v.some(p => !p))
        throw new Error('面索引非法');
    if (v.length === 3)
        return [v];
    const n = polygonNormal(v), axis = n.map(Math.abs).indexOf(Math.max(...n.map(Math.abs))), pts = v.map(p => p.filter((_, i) => i !== axis));
    const area = pts.reduce((s, a, i) => { const b = pts[(i + 1) % pts.length]; return s + a[0] * b[1] - a[1] * b[0]; }, 0), s = area >= 0 ? 1 : -1;
    const orient = (a, b, c) => s * ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
    const ids = v.map((_, i) => i), out = [];
    let guard = 0;
    while (ids.length > 3) {
        let found = false;
        for (let j = 0; j < ids.length; j++) {
            const a = ids[(j + ids.length - 1) % ids.length], b = ids[j], c = ids[(j + 1) % ids.length];
            if (orient(pts[a], pts[b], pts[c]) <= 1e-12)
                continue;
            if (ids.some(k => k !== a && k !== b && k !== c && orient(pts[a], pts[b], pts[k]) >= -1e-12 && orient(pts[b], pts[c], pts[k]) >= -1e-12 && orient(pts[c], pts[a], pts[k]) >= -1e-12))
                continue;
            out.push([v[a], v[b], v[c]]);
            ids.splice(j, 1);
            found = true;
            break;
        }
        if (!found || guard++ > 256)
            throw new Error('多边形自交或退化，无法安全三角化');
    }
    out.push(ids.map(i => v[i]));
    return out;
}
function finishImport(polys, { normalize = true, name = '导入原石' } = {}) {
    if (!polys.length)
        throw new Error('文件没有网格');
    polys.forEach(p => p.v.forEach(v => vector(v, '顶点')));
    const box = boundingBox(polys), extent = Math.max(...box.size);
    if (!Number.isFinite(extent) || extent < 1e-8)
        throw new Error('原石尺寸无效');
    const factor = normalize ? 2 / extent : 1, center = normalize ? box.center : [0, 0, 0];
    polys = polys.map((p, i) => ({ ...p, id: `rough-${i}`, part: 'stock', role: 'stock', isCut: false, v: p.v.map(v => mul(sub(v, center), factor)) }));
    if (signedVolume(polys) < 0)
        polys = polys.map(p => ({ ...p, v: p.v.slice().reverse() }));
    const validation = validateMesh(polys);
    return { name, polys, convex: validation.convex, sourceTransform: { center, scale: factor }, nativeStock: null };
}
export function importOBJ(text, options = {}) {
    if (new TextEncoder().encode(text).length > LIMITS.fileBytes)
        throw new Error('OBJ 超过 8 MiB');
    const vertices = [], polys = [];
    for (const line of text.split(/\r?\n/)) {
        const a = line.split('#')[0].trim().split(/\s+/);
        if (a[0] === 'v') {
            const p = a.slice(1, 4).map(Number);
            vector(p, 'OBJ 顶点');
            vertices.push(p);
            if (vertices.length > 20000)
                throw new Error('OBJ 顶点预算超限');
        }
        else if (a[0] === 'f') {
            const ids = a.slice(1).map(t => { const n = Number(t.split('/')[0]); if (!Number.isInteger(n) || !n)
                throw new Error('OBJ 索引非法'); return n < 0 ? vertices.length + n : n - 1; });
            if (ids.length < 3 || ids.length > 256 || ids.some(i => i < 0 || i >= vertices.length))
                throw new Error('OBJ 面索引非法');
            for (const tri of triangulateFace(ids.map(i => vertices[i])))
                polys.push({ v: tri });
            if (polys.length > LIMITS.meshFaces)
                throw new Error('三角化后超过 2000 面；请先简化');
        }
    }
    return finishImport(polys, options);
}
export function importSTL(buffer, options = {}) {
    if (buffer.byteLength > LIMITS.fileBytes)
        throw new Error('STL 超过 8 MiB');
    const view = new DataView(buffer), polys = [], count = buffer.byteLength >= 84 ? view.getUint32(80, true) : 0;
    if (84 + count * 50 === buffer.byteLength) {
        if (count > LIMITS.meshFaces)
            throw new Error('STL 超过 2000 三角面');
        for (let i = 0; i < count; i++) {
            const v = [];
            for (let j = 0; j < 3; j++) {
                const off = 84 + i * 50 + 12 + j * 12;
                v.push([0, 4, 8].map(k => view.getFloat32(off + k, true)));
            }
            polys.push({ v });
        }
    }
    else {
        const text = new TextDecoder().decode(buffer), matches = [...text.matchAll(/vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g)];
        if (!matches.length || matches.length % 3)
            throw new Error('ASCII STL 不完整');
        for (let i = 0; i < matches.length; i += 3)
            polys.push({ v: matches.slice(i, i + 3).map(m => m.slice(1).map(Number)) });
    }
    return finishImport(polys, options);
}
export function nativeFacetPlane(f, stock, teeth = f.indexTeeth ?? 96) {
    if (!['crown', 'pavilion', 'girdle'].includes(f.region))
        throw new Error('本体刻面区域非法');
    normalizeIndexGear(teeth);
    finite(f.index, '本体分度', 0, teeth);
    finite(f.industryAngleDeg, '行业角', 0, 90);
    finite(f.depth, '切深', 0, 1e5);
    const a = rad(f.industryAngleDeg), az = rad(f.index * 360 / teeth), sign = f.region === 'pavilion' ? -1 : 1;
    const n = f.region === 'girdle' ? [Math.cos(az), Math.sin(az), 0] : [Math.sin(a) * Math.cos(az), Math.sin(a) * Math.sin(az), sign * Math.cos(a)];
    const c = vector(stock.center || [0, 0, 0]), radius = stock.kind === 'mesh' ? stock.envelope?.radius : stock.size / 2, hh = stock.kind === 'mesh' ? stock.envelope?.halfHeight : stock.size / 2;
    finite(radius, '底胚包络半径', .00001, 1e5);
    finite(hh, '底胚包络半高', .00001, 1e5);
    return { n, d: dot(n, c) + radius * Math.hypot(n[0], n[1]) + hh * Math.abs(n[2]) - f.depth, id: f.id || uid(), tier: f.metadata?.componentTier || f.patternId || 'import', part: f.region, role: f.metadata?.componentRole || (f.metadata?.operationType === 'table' ? 'table' : 'custom'), isCut: true, label: f.label || f.patternId };
}
export function importNativeDocument(doc, { convexOnly = false } = {}) {
    if (doc?.kind !== 'facet-96-document' || ![1, 2, 3].includes(doc.schemaVersion) || !Array.isArray(doc.facets))
        throw new Error('不是 OpenGemCutting 文档');
    const inspection = inspectLabDocument(doc, { profile: 'preset' });
    if (!inspection.supported) throw new Error(inspection.errors.map(e => `${e.path}: ${e.message}`).join('；'));
    const machine = { teeth: normalizeIndexGear(doc.indexGear).teeth };
    if (doc.facets.length > LIMITS.basePlanes)
        throw new Error('已有 CUT 超过2048道');
    const raw = doc.stock;
    let stock;
    if (raw?.kind === 'cube')
        stock = { name: doc.name || '本体底胚', polys: cubeSolid(finite(raw.size, '底胚尺寸', .001, 1000), vector(raw.center || [0, 0, 0])), convex: true };
    else if (raw?.kind === 'mesh') {
        if (!Array.isArray(raw.mesh?.vertices) || !Array.isArray(raw.mesh?.faces) || raw.mesh.vertices.length > 20000)
            throw new Error('本体 mesh 格式或预算非法');
        const vertices = raw.mesh.vertices.map(p => vector(Array.isArray(p) ? p : [p.x, p.y, p.z]));
        const polys = [];
        for (const f of raw.mesh.faces) {
            const ids = Array.isArray(f) ? f : f.vertexIndices;
            if (!Array.isArray(ids) || ids.some(i => !Number.isInteger(i) || i < 0 || i >= vertices.length))
                throw new Error('本体 mesh 面索引非法');
            for (const tri of triangulateFace(ids.map(i => vertices[i])))
                polys.push({ v: tri });
        }
        stock = finishImport(polys, { normalize: false, name: doc.name || '本体晶体' });
    }
    else
        throw new Error('不支持的原生底胚');
    if (convexOnly && !stock.convex) throw new Error('冠亭实验室目前仅支持凸晶体；原晶体保持不变，未作凸包替换');
    stock.nativeStock = clone(raw);
    const planes = doc.facets.map(f => { const p = nativeFacetPlane(f, doc.cuttingReference ?? stock.nativeStock, f.indexTeeth ?? 96); if (typeof f.id !== 'string' || !f.id)
        throw new Error('本体 CUT 缺少 ID'); const q = f.plane; if (!q || q.keep !== 'less-than-or-equal' || !q.normal || !planesEquivalent([p], [{ n: vector([q.normal.x, q.normal.y, q.normal.z]), d: finite(q.offset) }], 1e-6))
        throw new Error('本体显式平面与分度、角度、切深不一致'); return { ...p, n: [q.normal.x, q.normal.y, q.normal.z], d: q.offset };  }), groups = [], warnings = [], owned = new Set();
    if (new Set(planes.map(p => p.id)).size !== planes.length)
        throw new Error('本体 CUT ID 重复');
    for (const g of doc.metadata?.componentInstances || []) {
        // Do not silently bake a legacy tilted/translated assembly into an unlocked cutter.
        normalizeAxialTransform(g.transform);
        try {
            if (!g.id || groups.some(x => x.id === g.id))
                throw new Error('实例身份重复');
            const c = validateComponent(g.component), t = normalizeAxialTransform(g.transform,{teeth:machine.teeth}), expected = c.planes.filter(p => p.role !== 'interface');
            const members = doc.facets.map((f, i) => ({ f, p: planes[i] })).filter(x => x.f.metadata?.componentInstanceId === g.id);
            let ok = members.length === expected.length;
            // Match source IDs, not display ordering; hand edits must never be overwritten.
            for (const p of expected) {
                const f = members.find(x => x.f.metadata?.sourcePlaneId === p.id);
                const q = transformPlane(p, t);
                if (!f || !planesEquivalent([q], [f.p]))
                    ok = false;
            }
            if (!ok)
                throw new Error('组件 metadata 与真实 CUT 不一致');
            groups.push({ id: g.id, component: c, transform: t });
            members.forEach(x => owned.add(x.p.id));
        }
        catch (e) {
            warnings.push(`${g.id || '组件'}：${e.message}；保留原 CUT`);
        }
    }
    const nativeDocument = clone(doc);
    return { machine, stock, basePlanes: planes.filter(p => !owned.has(p.id)), groups, nativeDocument, warnings };
}
export function extractComponent(planes, part, { name = '我的冠亭预设', radius = 1, waistZ = 0 } = {}) {
    finite(radius, '归一化半径', .001, 10000);
    finite(waistZ, '腰口高度');
    const selected = planes.filter(p => p.part === part && p.role !== 'interface');
    if (!selected.length)
        throw new Error('当前没有所选部位的 CUT 平面');
    const out = selected.map((p, i) => ({ ...p, id: `saved-${i}`, n: p.n.slice(), d: (p.d - p.n[2] * waistZ) / radius }));
    return validateComponent({ kind: 'opengemcutting-component', schemaVersion: 1, id: uid(), name, part, family: 'custom', planes: out, provenance: { type: 'user-saved', license: 'unspecified' }, notes: '从已解析工序提取，按指定腰口和半径归一化。' });
}
/** Stitch T-junctions before export; never run the O(EV) pass during a drag. */
export function weldTJunctions(polys) {
    const points = uniquePoints(polys.flatMap(p => p.v));
    if (points.length > 12000)
        throw new Error('导出顶点过多');
    let ops = 0;
    return polys.map(p => { const v = []; for (let i = 0; i < p.v.length; i++) {
        const a = p.v[i], b = p.v[(i + 1) % p.v.length], ab = sub(b, a), den = dot(ab, ab);
        if (den < 1e-14)
            continue;
        const along = [{ t: 0, p: a }];
        for (const q of points) {
            if (++ops > 1e7)
                throw new Error('导出焊接预算超限');
            const aq = sub(q, a), t = dot(aq, ab) / den;
            if (t > 1e-7 && t < 1 - 1e-7 && norm(cross(aq, ab)) / Math.sqrt(den) < 1e-7)
                along.push({ t, p: q });
        }
        along.sort((x, y) => x.t - y.t);
        v.push(...along.map(x => x.p));
    } return { ...p, v: cleanPolygon(v) }; }).filter(p => p.v.length >= 3);
}
export function exportOBJ(polys) {
    const mesh = weldTJunctions(polys), vertices = [], map = new Map(), faces = [];
    for (const p of mesh) {
        const ids = p.v.map(v => { const key = v.map(x => Math.round(x * 1e7)).join(','); if (!map.has(key)) {
            map.set(key, vertices.length + 1);
            vertices.push(v);
        } return map.get(key); });
        faces.push(ids);
    }
    return '# OpenGemCutting Preset Studio; geometry only\n' + vertices.map(v => 'v ' + v.map(x => x.toFixed(9)).join(' ')).join('\n') + '\n' + faces.map(f => 'f ' + f.join(' ')).join('\n') + '\n';
}
