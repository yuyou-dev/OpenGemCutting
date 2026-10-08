import { transformPlane, clone, dot, polygonNormal, boundingBox } from './math.js';
import { sectionSegments, cutSolid } from './geometry.js';
import { machineReport } from './machine.js';

/** Actual vertical boundary, including any girdle cuts already in the workspace. */
export function currentGirdleStock(stock, planes = []) {
    const vertical = planes.filter(p => Math.abs(p.n[2]) < 1e-9);
    return { ...stock, polys: cutSolid(stock.polys, vertical, { convex: stock.convex ?? true }).map(f =>
        Math.abs(polygonNormal(f.v)[2]) < 1e-9 ? { ...f, part: 'girdle' } : f) };
}

function clipSection(lines, extent) {
    let polygon = [[-extent, -extent], [extent, -extent], [extent, extent], [-extent, extent]];
    for (const p of lines) {
        const next = [];
        for (let i = 0; i < polygon.length; i++) {
            const a = polygon[i], b = polygon[(i + 1) % polygon.length];
            const da = p.n[0] * a[0] + p.n[1] * a[1] - p.d, db = p.n[0] * b[0] + p.n[1] * b[1] - p.d;
            if (da <= 0) next.push(a);
            if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
                const t = da / (da - db);
                next.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
            }
        }
        polygon = next;
    }
    return polygon.filter((v, i) => Math.hypot(v[0] - polygon[(i + 1) % polygon.length][0], v[1] - polygon[(i + 1) % polygon.length][1]) > 1e-8);
}

/** The largest horizontal section of the unchanged component inside the current
 * girdle. Signed Z increases toward the tip/table, so the sections are nested.
 * Each surviving contour edge becomes one vertical cut: rho=(d-nz*z)/|nxy|.
 */
export function planGirdleRecut({ component, transform, stock, currentPlanes = [], otherPlanes = [], teeth = 96 }) {
    if (stock.convex === false) throw new Error('腰棱重整需要具有封闭竖直腰棱的圆形底胚');
    const fixed = currentGirdleStock(stock, currentPlanes), bounds = boundingBox(fixed.polys);
    const boundary = fixed.polys.filter(f => f.part === 'girdle').map(f => { const n = polygonNormal(f.v); return { n, d: dot(n, f.v[0]) }; });
    if (boundary.length < 3 || boundary.some(p => p.d <= 0)) throw new Error('当前腰棱没有围住固定 Z 轴');
    const sign = component.part === 'crown' ? 1 : -1;
    const source = component.planes.filter(p => p.role !== 'interface').map(p => transformPlane(p, transform));
    if (source.some(p => p.n[2] * sign < -1e-9)) throw new Error('组件含反向切面，不能计算单一平腰交线');
    const sides = source.filter(p => Math.hypot(p.n[0], p.n[1]) > 1e-9);
    const angles = sides.map(p => Math.atan2(p.n[1], p.n[0])).sort((a, b) => a - b);
    if (angles.length < 3 || angles.some((a, i) => (i + 1 < angles.length ? angles[i + 1] : angles[0] + Math.PI * 2) - a >= Math.PI - 1e-9))
        throw new Error('冠／亭外延无法围成封闭腰棱');
    const extent = Math.max(...bounds.size) * 4;
    const contour = u => {
        const z = u * sign;
        const lines = sides.map(p => { const r = Math.hypot(p.n[0], p.n[1]); return { n: [p.n[0] / r, p.n[1] / r], d: (p.d - p.n[2] * z) / r, source: p }; });
        return { lines, polygon: clipSection(lines, extent) };
    };
    const inside = polygon => polygon.length >= 3 && polygon.every(v => boundary.every(p => p.n[0] * v[0] + p.n[1] * v[1] <= p.d));
    const tips = source.filter(p => p.n[2] * sign > 1e-9).map(p => p.d / (p.n[2] * sign));
    if (!tips.length) throw new Error('组件没有冠／亭斜切面');
    let low = Math.min(sign * bounds.lo[2], sign * bounds.hi[2]);
    let high = Math.min(Math.max(sign * bounds.lo[2], sign * bounds.hi[2]), ...tips) - 1e-6;
    if (high <= low || !inside(contour(high).polygon)) throw new Error('在当前底胚范围内找不到封闭平腰截面');
    if (inside(contour(low).polygon)) high = low;
    else for (let i = 0; i < 60; i++) {
        const mid = (low + high) / 2;
        if (inside(contour(mid).polygon)) high = mid; else low = mid;
    }
    const datumZ = high * sign, { lines, polygon } = contour(high);
    const active = polygon.map((a, i) => {
        const b = polygon[(i + 1) % polygon.length];
        return lines.find(p => [a, b].every(v => Math.abs(p.n[0] * v[0] + p.n[1] * v[1] - p.d) < 1e-7));
    });
    if (active.some(p => !p || Math.abs(p.source.n[2]) < 1e-9)) throw new Error('截面含无冠／亭交线的竖直边，不能整圈重整');
    const edges = [...new Set(active)];
    const oldVertices = fixed.polys.filter(f => f.part === 'girdle').flatMap(f => f.v);
    const distanceReport = edges.map(p => {
        const previous = Math.max(...oldVertices.map(v => p.n[0] * v[0] + p.n[1] * v[1]));
        return { sourcePlaneId: p.source.id, previous, next: p.d, reduction: Math.max(0, previous - p.d), relativeReduction: Math.max(0, (previous - p.d) / previous) };
    });
    const planes = edges.map((p, i) => ({ id: `girdle-recut-${i}`, n: [...p.n, 0], d: p.d, part: 'girdle', role: 'girdle', tier: 'girdle-recut', isCut: true, sourcePlaneId: p.source.id }));
    const maxRelativeReduction = Math.max(...distanceReport.map(r => r.relativeReduction));
    const report = machineReport(planes, teeth), reasons = [];
    if (!report.exact) reasons.push(`${report.incompatible} 个腰棱面不落当前整数分度；不能自动取整`);
    if (!machineReport(source, teeth).exact) reasons.push('当前冠亭或原有工序未通过整齿检查，请先适配分度');
    if (polygon.some(v => otherPlanes.some(p => dot(p.n, [...v, datumZ]) > p.d + 1e-7))) reasons.push('另一组件或原有工序已切入目标交线，无法形成完整平腰');
    return { planes, datumZ, polygon, distanceReport, maxRelativeReduction, previousFacets: boundary.length, facets: planes.length, canApply: reasons.length === 0, reasons };
}

/** Move only Z to first contact with a fixed horizontal section of the girdle.
 * Envelope extrema include plane crossings along every edge, not just vertices.
 */
export function girdleContact(component, transform, stock, z = 0) {
    if (!Number.isFinite(z)) throw new Error('腰棱基准 Z 必须为有限数值');
    if (stock.convex === false) throw new Error('当前原石没有支持贴合的凸腰棱');
    const segments = sectionSegments(stock.polys.filter(f => f.part === 'girdle'), z);
    if (segments.length < 3) throw new Error('此基准 Z 不在底胚腰棱范围内');
    const planes = component.planes.filter(p => p.role !== 'interface').map(p => transformPlane(p, transform));
    const sign = component.part === 'crown' ? 1 : -1;
    if (planes.some(p => p.n[2] * sign < -1e-9)) throw new Error('组件含反向切面，无法仅沿 Z 求腰棱接触');
    const slopes = planes.filter(p => p.n[2] * sign > 1e-9);
    if (!slopes.length) throw new Error('组件没有可计算接触的冠／亭切面');
    const height = (p, v) => (p.d - p.n[0] * v[0] - p.n[1] * v[1]) / p.n[2];
    const values = [];
    for (const [a, b] of segments) {
        for (const p of planes.filter(p => Math.abs(p.n[2]) <= 1e-9))
            if ([a, b].some(v => p.n[0] * v[0] + p.n[1] * v[1] > p.d + 1e-7))
                throw new Error('竖直切面侵入固定腰棱，沿 Z 移动不能修复');
        // On one edge every signed surface height is affine. A plane can
        // contribute to the lower envelope only where it is <= every other plane.
        const lines = slopes.map(p => {
            const start = sign * height(p, a);
            return { start, slope: sign * height(p, b) - start };
        });
        for (const line of lines) {
            let low = 0, high = 1;
            for (const other of lines) {
                const d = line.slope - other.slope, offset = other.start - line.start;
                if (Math.abs(d) < 1e-12) {
                    if (offset < -1e-10) { high = -1; break; }
                } else if (d > 0) high = Math.min(high, offset / d);
                else low = Math.max(low, offset / d);
                if (low > high) break;
            }
            if (low <= high) values.push(sign * (line.start + line.slope * low), sign * (line.start + line.slope * high));
        }
    }
    const min = Math.min(...values), max = Math.max(...values), spread = max - min;
    const deltaZ = z - (sign === 1 ? min : max), next = clone(transform);
    next.translation[2] += deltaZ;
    if (Math.abs(next.translation[2]) > 100) throw new Error('接触所需 Z 超出可编辑范围');
    return { transform: next, deltaZ, spread, exact: spread <= 1e-6, datumZ: z };
}
