// p5 2 redraw is asynchronous. Serialize draws and coalesce invalidations so
// a React update arriving during a draw is presented on the following frame.
export function createViewportFrames({ draw, requestFrame = requestAnimationFrame, cancelFrame = cancelAnimationFrame }) {
  let pending = null;
  let drawing = false;
  let dirty = false;
  let suspended = false;
  let disposed = false;

  const schedule = () => {
    if (disposed || suspended || drawing || pending !== null || !dirty) return;
    pending = requestFrame(async () => {
      pending = null;
      dirty = false;
      drawing = true;
      try {
        if (await draw()) dirty = true;
      } finally {
        drawing = false;
        schedule();
      }
    });
  };

  return {
    invalidate() {
      dirty = true;
      schedule();
    },
    setSuspended(value) {
      suspended = value;
      if (suspended && pending !== null) {
        cancelFrame(pending);
        pending = null;
      }
      schedule();
    },
    dispose() {
      disposed = true;
      if (pending !== null) cancelFrame(pending);
      pending = null;
    },
  };
}

export { advanceViewportCamera } from './viewportNavigation.js';

// Keep the gem upright, with the current cut seen obliquely from 45° to its side.
// A shallow view from above preserves both crown and pavilion proportions.
export function cuttingCameraPose(step, currentYaw = 0) {
  const n = step.plane.normal;
  const azimuth = Math.hypot(n.x, n.y) < 1e-8 ? currentYaw + Math.PI / 2 : Math.atan2(n.y, n.x);
  const target = azimuth - Math.PI / 2 - (Math.hypot(n.x, n.y) < 1e-8 ? 0 : Math.PI / 4);
  const delta = Math.atan2(Math.sin(target - currentYaw), Math.cos(target - currentYaw));
  return { yaw: currentYaw + delta, pitch: step.region === "pavilion" ? -Math.PI / 36 : -Math.PI / 12 };
}

export function startCameraTransition(camera, pose, duration, now, onComplete) {
  camera.targetYaw = pose.yaw;
  camera.targetPitch = pose.pitch;
  camera.transition = { start: now, duration, yaw: camera.yaw, pitch: camera.pitch, onComplete };
}
