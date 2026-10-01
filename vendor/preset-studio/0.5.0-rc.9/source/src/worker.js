import { cutSolid, geometryStats } from './domain/geometry.js';
self.onmessage = event => { const { version, stock, planes, convex } = event.data, start = performance.now(); try {
    const polys = cutSolid(stock, planes, { convex });
    self.postMessage({ version, polys, stats: geometryStats(polys, planes), ms: performance.now() - start });
}
catch (e) {
    self.postMessage({ version, error: e.message });
} };
