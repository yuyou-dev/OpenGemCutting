import { dot, cross, unit } from '../core/domain/math.js';

/** Orbit camera shared by the software solid view and the WebGL optical view. */
export function cameraFrame(theta, phi) {
  const eye = [Math.sin(phi) * Math.cos(theta), Math.sin(phi) * Math.sin(theta), Math.cos(phi)];
  // Analytic azimuth tangent stays defined at exact top and bottom views.
  const right = [-Math.sin(theta), Math.cos(theta), 0];
  return { eye, right, up: cross(eye, right), span: 1.1 };
}

export function solidScale(w, h) {
  return Math.min(w, h) / 2.42;
}

export function projectSolid(w, h, C, p) {
  const s = solidScale(w, h) * (C.zoom ?? 1);
  return [w / 2 + dot(p, C.right) * s + (C.panX ?? 0), h / 2 - dot(p, C.up) * s + (C.panY ?? 0)];
}

const LIGHT = unit([-0.3, -0.5, 1]);

/** Back-face culled, painter-sorted faces with the original flat shading. */
export function solidFaces(compiled, C) {
  return compiled.faces
    .filter((f) => dot(f.normal, C.eye) > 1e-8)
    .sort((a, b) => dot(a.points[0], C.eye) - dot(b.points[0], C.eye))
    .map((face) => ({ face, brightness: Math.round(236 + 15 * dot(face.normal, LIGHT)) }));
}

export const SOLID_COLORS = Object.freeze({
  selectedFill: '#f6ccd8',
  frostedFill: '#e7c6d2',
  stroke: '#697277',
});

/** Adapter from cutting-view yaw/pitch into the laboratory's Z-up coordinates.
 * Film offsets affect the camera rays only, never geometry or physical scale. */
export function viewportFrame(camera, width = 400, height = 400) {
  const frame = cameraFrame(-camera.yaw - Math.PI / 2, Math.PI / 2 + camera.pitch);
  const scale = solidScale(Math.max(1, width), Math.max(1, height)) * camera.zoom;
  return { ...frame, zoom: camera.zoom, panX: camera.panX, panY: camera.panY,
    span: Math.max(1, height) / (2 * scale),
    offset: frame.right.map((r, i) => (-r * camera.panX + frame.up[i] * camera.panY) / scale),
  };
}
