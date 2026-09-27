import { resizeCanvas, cssCanvasContext } from './canvas-resolution.js';
import { boundingBox, clamp } from '../domain/math.js';
import { sectionSegments } from '../domain/geometry.js';

/** Full gemstone section in the X/Z plane, independent of the orbit camera. */
export function drawAxialProfile(canvas, polys, transform, reference, part = 'crown') {
    const metrics = resizeCanvas(canvas, canvas.getBoundingClientRect());
    const ctx = cssCanvasContext(canvas, metrics), w = metrics.width, h = metrics.height;
    ctx.lineWidth = 1; ctx.lineCap = 'round'; ctx.setLineDash([]);
    if (!polys.length) return [];
    const bounds = boundingBox(reference ?? polys), cx = w / 2 + 8;
    const zoom = Math.min((w - 36) / Math.max(bounds.size[0], .1), (h - 46) / Math.max(bounds.size[2], .1));
    const project = v => [cx + v[0] * zoom, (part === 'pavilion' ? 12 : 42) + (bounds.hi[2] - v[1]) * zoom];
    const section = faces => sectionSegments(faces.map(f => ({ ...f, v: f.v.map(([x, y, z]) => [x, z, y]) })), 0);
    const render = (faces, ghost = false) => {
        const segments = section(faces);
        ctx.strokeStyle = ghost ? '#bdc7d4' : '#8593a5'; ctx.lineWidth = ghost ? 1 : 1.35; ctx.setLineDash(ghost ? [3, 4] : []);
        ctx.beginPath();
        for (const [a, b] of segments) { ctx.moveTo(...project(a)); ctx.lineTo(...project(b)); }
        ctx.stroke(); ctx.setLineDash([]);
        return segments;
    };
    if (reference) render(reference, true);
    const segments = render(polys), points = segments.flat().map(project);
    if (!points.length) return [];
    const left = Math.max(24, Math.min(...points.map(p => p[0]))), right = Math.min(w - 4, Math.max(...points.map(p => p[0])));
    const waistY = clamp(project([0, transform.translation[2]])[1], 48, h - 24);
    const arcY = part === 'pavilion'
        ? Math.min(h - 12, Math.max(waistY + 35, Math.max(...points.map(p => p[1])) + 24))
        : Math.max(12, Math.min(waistY - 35, Math.min(...points.map(p => p[1])) - 24));
    const bottom = Math.min(h - 2, Math.max(...points.map(p => p[1])));
    ctx.lineWidth = 1; ctx.strokeStyle = '#d9e1ea';
    ctx.beginPath(); ctx.moveTo(left, waistY); ctx.lineTo(right, waistY); ctx.stroke();
    ctx.strokeStyle = '#ed225d80'; ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, bottom);
    ctx.moveTo(left, waistY); ctx.quadraticCurveTo((left + cx) / 2, arcY, cx, arcY); ctx.quadraticCurveTo((right + cx) / 2, arcY, right, waistY); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = '#ed225d50';
    ctx.beginPath(); ctx.moveTo(9, waistY - 38); ctx.lineTo(9, waistY + 38); ctx.moveTo(5, waistY - 31); ctx.lineTo(9, waistY - 38); ctx.lineTo(13, waistY - 31); ctx.moveTo(5, waistY + 31); ctx.lineTo(9, waistY + 38); ctx.lineTo(13, waistY + 31); ctx.stroke();
    ctx.strokeStyle = '#ed225d'; ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.roundRect(5, waistY - 17, 8, 34, 3); ctx.stroke();
    ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(15, waistY); ctx.lineTo(left, waistY); ctx.stroke();
    ctx.fillStyle = '#ed225d'; ctx.beginPath(); ctx.arc(cx, arcY, 7.5, 0, 2 * Math.PI); ctx.fill();
    return [{ action: 'scaleZ', x: cx, y: arcY }, { action: 'translateZ', x: 9, y: waistY }];
}

export function drawIndexDial(canvas, index, teeth) {
    const m = resizeCanvas(canvas, canvas.getBoundingClientRect()), ctx = cssCanvasContext(canvas, m);
    const x = m.width / 2, y = m.height / 2, r = Math.min(x, y) - 7;
    // Canvas resize is conditional; every redraw must reset the previous pointer's stroke.
    ctx.lineWidth = 1; ctx.lineCap = 'butt'; ctx.setLineDash([]);
    ctx.strokeStyle = '#e4e7eb'; ctx.beginPath(); ctx.arc(x, y, r - 12, 0, Math.PI * 2); ctx.stroke();
    const majorStep = Math.max(1, Math.round(teeth / 12));
    for (let i = 0; i < teeth; i++) {
        const a = i / teeth * Math.PI * 2 - Math.PI / 2, major = i % majorStep === 0;
        ctx.strokeStyle = major ? '#ed225daa' : '#ed225d50'; ctx.lineWidth = major ? 1.25 : .8; ctx.beginPath();
        ctx.moveTo(x + Math.cos(a) * (r - (major ? 7 : 3.5)), y + Math.sin(a) * (r - (major ? 7 : 3.5)));
        ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); ctx.stroke();
    }
    const a = -index / teeth * Math.PI * 2 - Math.PI / 2;
    ctx.strokeStyle = '#ed225d'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * (r - 7), y + Math.sin(a) * (r - 7)); ctx.lineTo(x + Math.cos(a) * (r + 1), y + Math.sin(a) * (r + 1)); ctx.stroke();
    ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * (r - 17), y + Math.sin(a) * (r - 17)); ctx.lineTo(x + Math.cos(a) * (r - 29), y + Math.sin(a) * (r - 29)); ctx.stroke();
    ctx.fillStyle = '#111111'; ctx.textAlign = 'center'; ctx.font = '14px "IBM Plex Mono", monospace';
    ctx.fillText(`${index || teeth} / ${teeth}`, x, y + 4);
    ctx.font = '11px "IBM Plex Mono", monospace'; ctx.fillStyle = '#888888'; ctx.fillText(`${(index * 360 / teeth).toFixed(2)}°`, x, y + 23);
}
