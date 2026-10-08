import { polygonNormal, sub } from '../domain/math.js';

const cache = new WeakMap();
const vertexKey = v => v.map(n => Math.round(n * 1e7)).join(',');
const sameSurface = (a, b) => !a.isCut && !b.isCut ||
    a.isCut && b.isCut && a.id === b.id && a.instanceId === b.instanceId;

/** Display creases and CUT boundaries, never a surface's internal triangulation.
 * Input polygon lists are immutable; caching is shared by GL and CPU views. */
export function meshEdges(polys) {
    if (cache.has(polys)) return cache.get(polys);
    const edges = new Map();
    for (const face of polys) {
        const normal = polygonNormal(face.v);
        for (let i = 0; i < face.v.length; i++) {
            const a = face.v[i], b = face.v[(i + 1) % face.v.length];
            const key = [vertexKey(a), vertexKey(b)].sort().join('|');
            if (!edges.has(key)) edges.set(key, { a, b, faces: [] });
            edges.get(key).faces.push({ face, normal });
        }
    }
    const result = [];
    for (const { a, b, faces } of edges.values()) {
        if (faces.length === 2 && sameSurface(faces[0].face, faces[1].face) &&
            Math.hypot(...sub(faces[0].normal, faces[1].normal)) < 1e-7) continue;
        result.push({ a, b, draft: faces.some(({ face }) => face.instanceId === 'draft') });
    }
    cache.set(polys, result);
    return result;
}
