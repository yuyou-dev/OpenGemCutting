// Retained, vertex-colored tool ghosts: one GPU draw for the selected group,
// rather than one immediate-mode draw for every polygon of every repetition.
const caches = new WeakMap();
export function releaseConcaveToolMeshes(p) {
  const cache = caches.get(p);
  if (cache) p.freeGeometry(cache.mesh);
  caches.delete(p);
}

export function drawConcaveTools(p, tools, sceneScale, transformPoint) {
  if (!tools.length) { releaseConcaveToolMeshes(p); return; }
  let cache = caches.get(p);
  if (!cache || cache.tools !== tools || cache.sceneScale !== sceneScale || cache.transformPoint !== transformPoint) {
    releaseConcaveToolMeshes(p);
    const mesh = new p.constructor.Geometry();
    tools.forEach((tool, toolIndex) => {
      const color = (toolIndex === 0 ? [90, 153, 117, 42] : [150, 162, 157, 12]).map(v => v / 255);
      tool.geometry.polygons.forEach(polygon => {
        const start = mesh.vertices.length;
        for (const point of polygon.vertices) {
          mesh.vertices.push(p.createVector(...transformPoint(point, sceneScale)));
          mesh.vertexColors.push(...color);
        }
        for (let i = 1; i < polygon.vertices.length - 1; i++) mesh.faces.push([start, start + i, start + i + 1]);
      });
    });
    mesh.computeNormals();
    cache = { tools, sceneScale, transformPoint, mesh };
    caches.set(p, cache);
  }
  const gl = p.drawingContext;
  const depthWrite = gl.getParameter(gl.DEPTH_WRITEMASK);
  const offsetEnabled = gl.isEnabled(gl.POLYGON_OFFSET_FILL);
  const factor = gl.getParameter(gl.POLYGON_OFFSET_FACTOR);
  const units = gl.getParameter(gl.POLYGON_OFFSET_UNITS);
  // The cutter skin coincides with the Boolean walls. Bias only this ghost
  // toward the camera, retaining solid occlusion and leaving geometry intact.
  gl.depthMask(false);
  gl.enable(gl.POLYGON_OFFSET_FILL);
  gl.polygonOffset(-1, -1);
  p.push(); p.noStroke(); p.fill(255); p.model(cache.mesh); p.pop();
  gl.polygonOffset(factor, units);
  if (!offsetEnabled) gl.disable(gl.POLYGON_OFFSET_FILL);
  gl.depthMask(depthWrite);
}
