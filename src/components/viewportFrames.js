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

// Stop only once the remaining movement is below a screen-visible amount.
// Snapping that last fraction also gives fixed orthographic views exact poses.
export function advanceViewportCamera(camera, now = performance.now()) {
  let moving = false;
  const transition = camera.transition;
  if (transition) {
    const t = transition.duration > 0 ? Math.min(1, Math.max(0, (now - transition.start) / transition.duration)) : 1;
    const eased = t * t * (3 - 2 * t);
    camera.yaw = transition.yaw + (camera.targetYaw - transition.yaw) * eased;
    camera.pitch = transition.pitch + (camera.targetPitch - transition.pitch) * eased;
    moving = t < 1;
    if (!moving) camera.transition = null;
  }
  for (const [key, target, rate, tolerance] of [
    ["yaw", "targetYaw", 0.16, 1e-6],
    ["pitch", "targetPitch", 0.16, 1e-6],
    ["zoom", "targetZoom", 0.16, 1e-6],
    ["panX", "targetPanX", 0.18, 1e-3],
    ["panY", "targetPanY", 0.18, 1e-3],
  ]) {
    if (transition && (key === "yaw" || key === "pitch")) continue;
    const remaining = camera[target] - camera[key];
    if (Math.abs(remaining) <= tolerance) camera[key] = camera[target];
    else {
      camera[key] += remaining * rate;
      moving = true;
    }
  }
  return moving;
}

// Orient the actual cutting normal toward the observer, from the appropriate
// hemisphere. The p5 viewport maps domain (x,y,z) to (x,-z,y).
export function cuttingCameraPose(step, currentYaw = 0) {
  const n = step.plane.normal;
  const azimuth = Math.hypot(n.x, n.y) < 1e-8 ? currentYaw + Math.PI / 2 : Math.atan2(n.y, n.x);
  const target = azimuth - Math.PI / 2;
  const delta = Math.atan2(Math.sin(target - currentYaw), Math.cos(target - currentYaw));
  return { yaw: currentYaw + delta, pitch: step.region === "pavilion" ? Math.PI / 4 : -Math.PI / 4 };
}

export function startCameraTransition(camera, pose, duration, now) {
  camera.targetYaw = pose.yaw;
  camera.targetPitch = pose.pitch;
  camera.transition = { start: now, duration, yaw: camera.yaw, pitch: camera.pitch };
}
