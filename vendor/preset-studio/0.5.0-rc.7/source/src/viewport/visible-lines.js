// Orthographic screen coordinates: smaller Z is nearer the viewer.
export function projectedTriangles(polys, project) {
    const triangles = [];
    for (const face of polys) {
        const points = face.v.map(project);
        for (let i = 1; i < points.length - 1; i++) {
            const [a, b, c] = [points[0], points[i], points[i + 1]];
            const area = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
            if (Math.abs(area) < 1e-10) continue;
            triangles.push({ a, b, c, area,
                loX: Math.min(a[0], b[0], c[0]), hiX: Math.max(a[0], b[0], c[0]),
                loY: Math.min(a[1], b[1], c[1]), hiY: Math.max(a[1], b[1], c[1]) });
        }
    }
    return triangles;
}

/** Exact visible parameter intervals along a projected segment, including partial occlusion. */
export function visibleLineIntervals(start, end, triangles, depthBias = 1e-5) {
    const hidden = [];
    for (const { a, b, c, area, loX, hiX, loY, hiY } of triangles) {
        if (Math.max(start[0], end[0]) < loX || Math.min(start[0], end[0]) > hiX ||
            Math.max(start[1], end[1]) < loY || Math.min(start[1], end[1]) > hiY) continue;
        const constraints = p => {
            const u = ((b[1] - c[1]) * (p[0] - c[0]) + (c[0] - b[0]) * (p[1] - c[1])) / area;
            const v = ((c[1] - a[1]) * (p[0] - c[0]) + (a[0] - c[0]) * (p[1] - c[1])) / area;
            const w = 1 - u - v;
            return [u, v, w, p[2] - (u * a[2] + v * b[2] + w * c[2]) - depthBias];
        };
        const from = constraints(start), to = constraints(end);
        let lo = 0, hi = 1;
        for (let i = 0; i < from.length; i++) {
            if (from[i] < 0 && to[i] < 0) { hi = -1; break; }
            if (from[i] < 0) lo = Math.max(lo, from[i] / (from[i] - to[i]));
            else if (to[i] < 0) hi = Math.min(hi, from[i] / (from[i] - to[i]));
        }
        if (hi > lo) hidden.push([lo, hi]);
    }
    hidden.sort((a, b) => a[0] - b[0]);
    const visible = [];
    let cursor = 0;
    for (const [lo, hi] of hidden) {
        if (lo > cursor) visible.push([cursor, lo]);
        cursor = Math.max(cursor, hi);
    }
    if (cursor < 1) visible.push([cursor, 1]);
    return visible;
}

export function strokeVisibleLine(ctx, start, end, triangles) {
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
    for (const [lo, hi] of visibleLineIntervals(start, end, triangles)) {
        // Preserve the dash phase across portions hidden by the solid.
        ctx.lineDashOffset = -lo * length;
        ctx.beginPath();
        ctx.moveTo(start[0] + (end[0] - start[0]) * lo, start[1] + (end[1] - start[1]) * lo);
        ctx.lineTo(start[0] + (end[0] - start[0]) * hi, start[1] + (end[1] - start[1]) * hi);
        ctx.stroke();
    }
    ctx.lineDashOffset = 0;
}
