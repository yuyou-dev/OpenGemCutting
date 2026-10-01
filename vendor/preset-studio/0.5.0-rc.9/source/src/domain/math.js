/** Z-up; outward planes retain n dot x <= d. Independent of DOM/rendering. */
export const EPS = 1e-8;
export const rad = d => d * Math.PI / 180;
export const deg = r => r * 180 / Math.PI;
export const add = (a, b) => a.map((v, i) => v + b[i]);
export const sub = (a, b) => a.map((v, i) => v - b[i]);
export const mul = (a, s) => a.map(v => v * s);
export const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = a => Math.hypot(...a);
export const unit = a => { const l = norm(a); if (l < 1e-14)
    throw new Error('零长度向量'); return mul(a, 1 / l); };
export const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const clone = o => JSON.parse(JSON.stringify(o));
export const uid = () => globalThis.crypto?.randomUUID?.() || `cp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
export function finite(x, name = 'number', min = -Infinity, max = Infinity) {
    if (typeof x !== 'number' || !Number.isFinite(x) || x < min || x > max)
        throw new RangeError(`${name} 必须在 ${min} … ${max} 之间`);
    return x;
}
export function vector(v, name = '向量') { if (!Array.isArray(v) || v.length !== 3)
    throw new TypeError(`${name} 需要三个数`); return v.map(x => finite(x, name)); }
export function normalizePlane(p) {
    if (!p)
        throw new TypeError('平面需要 n 与 d');
    const n = vector(p.n, '法线');
    finite(p.d);
    const l = norm(n);
    if (l < 1e-12)
        throw new RangeError('平面法线不可为零');
    if (Math.abs(l - 1) < 1e-12)
        return { ...p, n: n.slice(), d: p.d };
    return { ...p, n: mul(n, 1 / l), d: p.d / l };
}
export function planeBasis(n) { const u = unit(cross(Math.abs(n[2]) < .85 ? [0, 0, 1] : [0, 1, 0], n)); return [u, cross(n, u)]; }
export function rotateVector(v, r = [0, 0, 0]) {
    let [x, y, z] = v;
    const [a, b, c] = r.map(rad);
    [y, z] = [Math.cos(a) * y - Math.sin(a) * z, Math.sin(a) * y + Math.cos(a) * z];
    [x, z] = [Math.cos(b) * x + Math.sin(b) * z, -Math.sin(b) * x + Math.cos(b) * z];
    return [Math.cos(c) * x - Math.sin(c) * y, Math.sin(c) * x + Math.cos(c) * y, z];
}
export function normalizeTransform(t = {}) {
    const out = { translation: vector(t.translation ?? [0, 0, 0], '平移'), rotation: vector(t.rotation ?? [0, 0, 0], '旋转'), scale: vector(t.scale ?? [1, 1, 1], '缩放') };
    out.translation.forEach(v => finite(v, '平移', -10000, 10000));
    out.rotation.forEach(v => finite(v, '旋转', -36000, 36000));
    out.scale.forEach(v => finite(v, '缩放', .001, 1000));
    return out;
}
/** x' = R S x + t. Dual transform is R S^-T, not R S. */
export function transformPlane(input, transform = {}) {
    const p = normalizePlane(input), t = normalizeTransform(transform), q = rotateVector(p.n.map((v, i) => v / t.scale[i]), t.rotation), l = norm(q);
    return { ...p, n: mul(q, 1 / l), d: (p.d + dot(q, t.translation)) / l };
}
function unrotateVector(v, r = [0, 0, 0]) {
    let [x, y, z] = v;
    const [a, b, c] = r.map(value => -rad(value));
    [x, y] = [Math.cos(c) * x - Math.sin(c) * y, Math.sin(c) * x + Math.cos(c) * y];
    [x, z] = [Math.cos(b) * x + Math.sin(b) * z, -Math.sin(b) * x + Math.cos(b) * z];
    [y, z] = [Math.cos(a) * y - Math.sin(a) * z, Math.sin(a) * y + Math.cos(a) * z];
    return [x, y, z];
}
/** The component-frame plane that `transformPlane(result, transform)` maps onto `input`. */
export function inverseTransformPlane(input, transform = {}) {
    const p = normalizePlane(input), t = normalizeTransform(transform);
    const scaled = unrotateVector(p.n, t.rotation).map((v, i) => v * t.scale[i]), n = mul(scaled, 1 / norm(scaled));
    const q = rotateVector(n.map((v, i) => v / t.scale[i]), t.rotation), l = norm(q);
    return { ...p, n, d: p.d * l - dot(q, t.translation) };
}
export function transformPoint(v, transform = {}) { const t = normalizeTransform(transform); return add(rotateVector(v.map((x, i) => x * t.scale[i]), t.rotation), t.translation); }
export function polygonNormal(v) { let n = [0, 0, 0]; for (let i = 0; i < v.length; i++)
    n = add(n, cross(v[i], v[(i + 1) % v.length])); return norm(n) > 1e-14 ? unit(n) : [0, 0, 0]; }
export function polygonArea(v) { let n = [0, 0, 0]; for (let i = 0; i < v.length; i++)
    n = add(n, cross(v[i], v[(i + 1) % v.length])); return norm(n) / 2; }
export function cleanPolygon(v, eps = EPS) {
    const out = [];
    for (const p of v)
        if (!out.length || norm(sub(p, out.at(-1))) > eps)
            out.push(p);
    if (out.length > 1 && norm(sub(out[0], out.at(-1))) <= eps)
        out.pop();
    return out.length >= 3 && polygonArea(out) > eps * eps ? out : [];
}
export function signedVolume(polys) { let v = 0; for (const p of polys)
    for (let i = 1; i < p.v.length - 1; i++)
        v += dot(p.v[0], cross(p.v[i], p.v[i + 1])) / 6; return v; }
export function boundingBox(polys) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const p of polys)
        for (const v of p.v)
            for (let k = 0; k < 3; k++) {
                lo[k] = Math.min(lo[k], v[k]);
                hi[k] = Math.max(hi[k], v[k]);
            }
    return { lo, hi, size: sub(hi, lo), center: mul(add(lo, hi), .5) };
}
export function uniquePoints(points, eps = 1e-7) { const m = new Map(); for (const p of points)
    m.set(p.map(x => Math.round(x / eps)).join(','), p); return [...m.values()]; }
