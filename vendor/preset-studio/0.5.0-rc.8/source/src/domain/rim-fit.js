import { componentPreview } from './generators.js';
import { currentGirdleStock } from './girdle.js';
import { sectionSegments } from './geometry.js';
import { clone, transformPoint } from './math.js';

// Convex boundary expressed as outward support lines around the fixed axis.
function supports(segments) {
    const center = segments.flat().reduce((s, p) => [s[0] + p[0] / (segments.length * 2), s[1] + p[1] / (segments.length * 2)], [0, 0]);
    return segments.map(([a, b]) => {
        let nx = b[1] - a[1], ny = a[0] - b[0];
        const length = Math.hypot(nx, ny);
        nx /= length; ny /= length;
        let d = nx * a[0] + ny * a[1];
        if (nx * center[0] + ny * center[1] > d) { nx = -nx; ny = -ny; d = -d; }
        if (!(d > 1e-9)) throw Error('腰口轮廓必须围住固定轴线，无法自动缩放贴腰');
        return { nx, ny, d };
    });
}
const radius = (lines, x, y) => Math.min(...lines.map(p => {
    const cosine = p.nx * x + p.ny * y;
    return cosine > 1e-12 ? p.d / cosine : Infinity;
}));

/** Minimax relative radial mismatch. Between consecutive vertex directions the
 * radius ratio is a ratio of linear trigonometric forms, hence monotonic.
 * Testing both polygons' vertex rays therefore bounds the entire perimeter.
 */
export function fitReferenceRim(component, transform, stock, planes = []) {
    if (stock.convex === false) throw Error('缩放贴腰需要封闭的凸底胚腰棱');
    const rim = componentPreview(component).find(f => f.role === 'interface');
    if (!rim) throw Error('当前组件没有闭合参考腰口');
    const vertices = rim.v.map(v => transformPoint(v, transform));
    const target = sectionSegments(currentGirdleStock(stock, planes).polys, transform.translation[2]);
    if (target.length < 3) throw Error('当前腰口高度没有可贴合的腰棱，请先调整升降 Z');
    const source = supports(vertices.map((v, i) => [v, vertices[(i + 1) % vertices.length]]));
    const boundary = supports(target);
    const ratios = [...vertices, ...target.flat()].map(v => {
        const length = Math.hypot(v[0], v[1]), x = v[0] / length, y = v[1] / length;
        return radius(source, x, y) / radius(boundary, x, y);
    });
    const low = Math.min(...ratios), high = Math.max(...ratios);
    const factor = 2 / (low + high), deviation = (high - low) / (high + low);
    const next = clone(transform);
    next.scale = next.scale.map(s => s * factor);
    return { transform: next, factor, deviation, exact: deviation < 1e-7 };
}
