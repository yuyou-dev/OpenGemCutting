import { backgroundColor, OPTICAL_ENVIRONMENTS } from "../domain/optics.js";
import { opticsMeshFraming } from "../domain/opticsGeometry.js";
import { normalizeVector } from "../utils/vector3.js";
import { opticsCameraFrame } from "./viewportOrbit.js";

export function hexToRgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

/** Shader environment ids follow the domain list order. */
export function environmentIndex(id) {
  return Math.max(0, OPTICAL_ENVIRONMENTS.findIndex(environment => environment.id === id));
}

export function opticsRenderStage(renderScale) {
  return renderScale === 1 ? "complete" : renderScale < .7 ? "interactive" : "refining";
}

/** Host view shared by every optics backend: pixel budget, camera, framing and
 * lighting inputs. Backends differ only in how they transport and trace rays. */
export function opticsViewFrame(canvas, { geometry, settings, camera, focusOffset = 0, renderScale = 1 }) {
  const ratio = Math.min(window.devicePixelRatio || 1, 1.5, 1100 / Math.max(canvas.clientWidth, canvas.clientHeight)) * renderScale;
  const width = Math.max(2, Math.round(canvas.clientWidth * ratio));
  const height = Math.max(2, Math.round(canvas.clientHeight * ratio));
  const frame = opticsCameraFrame(camera);
  let meshFraming;
  // Convex solids keep the fixed centered framing, whether traced by planes or triangles.
  if (geometry.mesh && geometry.framing !== "convex") {
    const inspector = focusOffset ? canvas.parentElement?.parentElement?.querySelector(".optics-inspector") : null;
    const covered = inspector ? Math.max(0, canvas.getBoundingClientRect().right - inspector.getBoundingClientRect().left + 24) : 0;
    meshFraming = opticsMeshFraming(geometry.mesh, { width: canvas.clientWidth, height: canvas.clientHeight, occludedRight: covered });
  }
  return {
    width, height, frame,
    cameraScale: (meshFraming?.cameraScale ?? 0.34) / camera.zoom,
    focusOffset: meshFraming?.focusOffset ?? focusOffset,
    bodyColor: hexToRgb(settings.material.bodyColor),
    background: hexToRgb(backgroundColor(settings)),
    environment: environmentIndex(settings.view.environment),
    observer: normalizeVector(frame.position),
    stage: opticsRenderStage(renderScale),
  };
}
