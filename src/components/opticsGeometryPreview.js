import { opticsViewFrame } from './opticsViewFrame.js';

/** Cheap, explicitly geometric preview in the same camera/normalization as optics.
 * Painter ordering is only for interaction feedback, never an optical result. */
export function drawOpticsGeometryPreview(canvas, polyhedron, options) {
  const context = canvas.getContext('2d');
  const { width, height, frame, cameraScale, focusOffset } = opticsViewFrame(canvas, options);
  canvas.width = width; canvas.height = height;
  context.fillStyle = '#f4f6f6'; context.fillRect(0, 0, width, height);
  const vertices = options.geometry.mesh?.vertices ?? options.geometry.vertices ?? [];
  const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
  const projected = vertices.map(vertex => {
    const relative = vertex.map((value, index) => value - frame.position[index]);
    const depth = dot(relative, frame.forward);
    return { x: width / 2 + (dot(relative, frame.right) / depth / cameraScale - focusOffset + options.camera.panX) * height / 2,
      y: height / 2 - (dot(relative, frame.up) / depth / cameraScale + options.camera.panY) * height / 2, depth };
  });
  const faces = polyhedron.faces.map(face => face.vertexIndices.map(index => projected[index]));
  faces.sort((a, b) => b.reduce((sum, p) => sum + p.depth, 0) / b.length - a.reduce((sum, p) => sum + p.depth, 0) / a.length);
  context.lineWidth = Math.max(.6, width / canvas.clientWidth * .65);
  context.strokeStyle = '#6b7c82'; context.fillStyle = '#e2e9eb';
  for (const points of faces) {
    if (points.length < 3) continue;
    context.beginPath();
    points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
    context.closePath(); context.fill(); context.stroke();
  }
}
