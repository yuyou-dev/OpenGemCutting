import { EPS, add, sub, mul, dot, mix, planeBasis, normalizePlane, polygonNormal, polygonArea, cleanPolygon, signedVolume, boundingBox, uniquePoints } from './math.js';
export function cubeSolid(size = 2.4, center = [0, 0, 0]) {
    const h = size / 2, v = [[-h, -h, -h], [h, -h, -h], [h, h, -h], [-h, h, -h], [-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h]].map(p => add(p, center));
    return [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]].map((ids, i) => ({ v: ids.map(j => v[j]), id: `stock-${i}`, part: 'stock', role: 'stock', isCut: false }));
}
/** Incremental B-rep clipping. ONLY valid for a known-convex input solid. */
export function clipConvex(polys, planes) {
    let out = polys;
    for (const raw of planes) {
        const p = normalizePlane(raw);
        if (!out.length)
            break;
        let cut = false, kept = false;
        const next = [], cuts = [];
        for (const face of out) {
            const v = [];
            for (let i = 0; i < face.v.length; i++) {
                const a = face.v[i], b = face.v[(i + 1) % face.v.length], da = dot(p.n, a) - p.d, db = dot(p.n, b) - p.d;
                if (da <= EPS) {
                    v.push(a);
                    kept = true;
                }
                else
                    cut = true;
                if ((da > EPS && db < -EPS) || (da < -EPS && db > EPS)) {
                    const q = mix(a, b, da / (da - db));
                    v.push(q);
                    cuts.push(q);
                }
                else if (Math.abs(da) <= EPS)
                    cuts.push(a);
            }
            const cv = cleanPolygon(v);
            if (cv.length)
                next.push({ ...face, v: cv });
        }
        if (!kept) {
            out = [];
            break;
        }
        if (cut) {
            const ring = uniquePoints(cuts);
            if (ring.length >= 3) {
                const c = mul(ring.reduce(add, [0, 0, 0]), 1 / ring.length), [u, v] = planeBasis(p.n);
                ring.sort((a, b) => Math.atan2(dot(sub(a, c), v), dot(sub(a, c), u)) - Math.atan2(dot(sub(b, c), v), dot(sub(b, c), u)));
                const cv = cleanPolygon(ring);
                if (cv.length)
                    next.push({ ...p, v: cv });
            }
        }
        out = next;
    }
    return out;
}
export function prismSolid(sides = 32, radius = 1, height = 2.4) {
    const planes = Array.from({ length: sides }, (_, i) => { const a = 2 * Math.PI * (i + .5) / sides; return { n: [Math.cos(a), Math.sin(a), 0], d: radius * Math.cos(Math.PI / sides), id: `stock-girdle-${i}`, part: 'girdle', role: 'stock', isCut: false }; });
    return clipConvex(cubeSolid(Math.max(height, 2.1 * radius)), [...planes, { n: [0, 0, 1], d: height / 2, id: 'stock-top', part: 'stock', isCut: false }, { n: [0, 0, -1], d: height / 2, id: 'stock-bottom', part: 'stock', isCut: false }]);
}
export function crystalSolid() {
    const s = prismSolid(6, 1.14, 2.35), planes = [];
    for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3 + .14;
        planes.push({ n: [.66 * Math.cos(a), .66 * Math.sin(a), .7513], d: .90 + .04 * Math.sin(i * 3.1), id: `rough-${i}`, part: 'stock', isCut: false });
        planes.push({ n: [.58 * Math.cos(a + .21), .58 * Math.sin(a + .21), -.8146], d: .99, id: `rough-b-${i}`, part: 'stock', isCut: false });
    }
    return clipConvex(s, planes);
}
/* Bounded floating-point BSP. No hull substitution of user rough. Polygon
 * fragments retain their CUT ownership; this is not an exact arithmetic kernel. */
function splitBspPolygon(plane, poly, cf, cb, front, back, budget) {
    if (++budget.ops > 2500000)
        throw new Error('非凸计算预算超限；请简化原石');
    const types = poly.v.map(v => { const t = dot(plane.n, v) - plane.d; return t < -1e-7 ? 2 : t > 1e-7 ? 1 : 0; }), type = types.reduce((a, b) => a | b, 0);
    if (type === 0) {
        (dot(plane.n, polygonNormal(poly.v)) > 0 ? cf : cb).push(poly);
        return;
    }
    if (type === 1) {
        front.push(poly);
        return;
    }
    if (type === 2) {
        back.push(poly);
        return;
    }
    const f = [], b = [];
    for (let i = 0; i < poly.v.length; i++) {
        const j = (i + 1) % poly.v.length, vi = poly.v[i], vj = poly.v[j], ti = types[i], tj = types[j];
        if (ti !== 2)
            f.push(vi);
        if (ti !== 1)
            b.push(vi);
        if ((ti | tj) === 3) {
            const t = (plane.d - dot(plane.n, vi)) / dot(plane.n, sub(vj, vi)), v = mix(vi, vj, t);
            f.push(v);
            b.push(v);
        }
    }
    const fv = cleanPolygon(f), bv = cleanPolygon(b);
    if (fv.length)
        front.push({ ...poly, v: fv });
    if (bv.length)
        back.push({ ...poly, v: bv });
}
class BspNode {
    constructor(polys = [], depth = 0, budget = { ops: 0 }) { this.polys = []; this.front = null; this.back = null; this.plane = null; this.depth = depth; this.budget = budget; if (polys.length)
        this.build(polys); }
    split(p, cf, cb, f, b) { splitBspPolygon(this.plane, p, cf, cb, f, b, this.budget); }
    build(polys) { if (!polys.length)
        return; if (this.depth > 350 || polys.length > 60000)
        throw new Error('原石 BSP 复杂度超限；请简化网格'); if (!this.plane) {
        const p = polys[Math.floor(polys.length / 2)], n = polygonNormal(p.v);
        this.plane = { n, d: dot(n, p.v[0]) };
    } const f = [], b = []; for (const p of polys)
        this.split(p, this.polys, this.polys, f, b); if (f.length) {
        this.front ??= new BspNode([], this.depth + 1, this.budget);
        this.front.build(f);
    } if (b.length) {
        this.back ??= new BspNode([], this.depth + 1, this.budget);
        this.back.build(b);
    } }
    invert() { this.polys = this.polys.map(p => ({ ...p, v: p.v.slice().reverse() })); if (this.plane)
        this.plane = { n: mul(this.plane.n, -1), d: -this.plane.d }; this.front?.invert(); this.back?.invert(); [this.front, this.back] = [this.back, this.front]; }
    clipPolys(polys) { if (!this.plane)
        return polys.slice(); let f = [], b = []; for (const p of polys)
        this.split(p, f, b, f, b); if (this.front)
        f = this.front.clipPolys(f); b = this.back ? this.back.clipPolys(b) : []; return f.concat(b); }
    clipTo(other) { this.polys = other.clipPolys(this.polys); this.front?.clipTo(other); this.back?.clipTo(other); }
    all() { return this.polys.concat(this.front?.all() || [], this.back?.all() || []); }
}
export function intersectSolids(left, right) {
    if (!left.length || !right.length)
        return [];
    const budget = { ops: 0 }, a = new BspNode(left, 0, budget), b = new BspNode(right, 0, budget);
    a.invert();
    b.clipTo(a);
    b.invert();
    a.clipTo(b);
    b.clipTo(a);
    a.build(b.all());
    a.invert();
    return a.all();
}
export function cutSolid(stock, planes, { convex = true } = {}) {
    if (planes.length > 4096)
        throw new Error('切割平面预算超限');
    if (!planes.length)
        return stock.slice();
    if (convex)
        return clipConvex(stock, planes);
    const box = boundingBox(stock), extent = Math.max(...box.size) * 2 + 1, cutter = clipConvex(cubeSolid(extent, box.center), planes);
    return intersectSolids(stock, cutter);
}
export function geometryStats(polys, requested = []) {
    const verts = uniquePoints(polys.flatMap(p => p.v)), ids = new Set(polys.map(p => p.id)), cutIds = new Set(polys.filter(p => p.isCut).map(p => p.id));
    const area = polys.reduce((s, p) => s + polygonArea(p.v), 0), volume = Math.abs(signedVolume(polys)), areas = {};
    for (const p of polys)
        areas[p.id] = (areas[p.id] || 0) + polygonArea(p.v);
    return { vertices: verts.length, polygons: polys.length, facets: ids.size, cutFacets: cutIds.size, volume, area, areas, active: requested.filter(p => ids.has(p.id)).length, inactive: requested.filter(p => !ids.has(p.id)).map(p => p.id), tiny: Object.entries(areas).filter(([, a]) => a < 1e-5).map(([id]) => id), bounds: polys.length ? boundingBox(polys) : null };
}
export function sectionSegments(polys, z = 0) {
    const seg = [];
    for (const p of polys) {
        const pts = [];
        for (let i = 0; i < p.v.length; i++) {
            const a = p.v[i], b = p.v[(i + 1) % p.v.length], da = a[2] - z, db = b[2] - z;
            if (Math.abs(da) < EPS)
                pts.push(a);
            if ((da < -EPS && db > EPS) || (da > EPS && db < -EPS))
                pts.push(mix(a, b, da / (da - db)));
        }
        const u = uniquePoints(pts);
        if (u.length === 2)
            seg.push(u);
    }
    return seg;
}
/** Diagnostic adjacency summary, NOT a graph-isomorphism canonical hash. */
export function topologySignature(polys) {
    const edges = new Map(), faces = new Map(), key = v => v.map(x => Math.round(x * 1e7)).join(',');
    for (const p of polys) {
        if (!faces.has(p.id))
            faces.set(p.id, { role: p.role || 'custom', neighbors: new Set() });
        for (let i = 0; i < p.v.length; i++) {
            const e = [key(p.v[i]), key(p.v[(i + 1) % p.v.length])].sort().join('|');
            if (!edges.has(e))
                edges.set(e, []);
            edges.get(e).push(p.id);
        }
    }
    for (const ids of edges.values())
        for (const a of ids)
            for (const b of ids)
                if (a !== b)
                    faces.get(a).neighbors.add(b);
    return [...faces.values()].map(f => `${f.role}:${f.neighbors.size}`).sort().join('|');
}
