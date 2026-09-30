import { transformPoint, transformPlane, dot, clamp, deg } from './math.js';
import { componentPreview } from './generators.js';
/** Reference-rim diagnostics, not minimum finished girdle thickness certification. */
export function interfaceReport(a, b) {
    if (a.component.part === b.component.part)
        return { status: 'same-part', messages: ['请选择一冠一亭进行参考腰口比较'] };
    const crown = a.component.part === 'crown' ? a : b, pavilion = a.component.part === 'pavilion' ? a : b;
    const normal = g => transformPlane({ n: [0, 0, 1], d: 0 }, g.transform).n, nc = normal(crown), np = normal(pavilion), tilt = Math.max(deg(Math.acos(clamp(nc[2], -1, 1))), deg(Math.acos(clamp(np[2], -1, 1))));
    if (tilt > 1e-5)
        return { status: 'tilted', tilt, messages: ['参考腰口已倾斜，需检查跨腰切割与重定向加工；不报告水平腰厚'] };
    const rim = g => { const cap = componentPreview(g.component).find(p => p.role === 'interface'); return cap?.v.map(v => transformPoint(v, g.transform)); }, c = rim(crown), p = rim(pavilion);
    if (!c || !p)
        return { status: 'open', messages: ['自定义组件没有可识别的闭合参考腰口'] };
    const distance = (v, ring) => Math.min(...ring.map((a, i) => { const b = ring[(i + 1) % ring.length], d = [b[0] - a[0], b[1] - a[1]], q = [v[0] - a[0], v[1] - a[1]], l = dot(d, d), t = l ? clamp(dot(q, d) / l, 0, 1) : 0; return Math.hypot(q[0] - t * d[0], q[1] - t * d[1]); }));
    const gap = c[0][2] - p[0][2], rimVertexDeviation = Math.max(...c.map(v => distance(v, p)), ...p.map(v => distance(v, c))), messages = [];
    if (gap < 0)
        messages.push('冠亭参考腰口高度倒置，切面可能互相侵入');
    if (rimVertexDeviation > 1e-4)
        messages.push('参考腰口轮廓不一致；这是组件边界检查，不代表实际实体裂缝');
    return { status: messages.length ? 'warning' : 'aligned', gap, rimVertexDeviation, messages };
}
