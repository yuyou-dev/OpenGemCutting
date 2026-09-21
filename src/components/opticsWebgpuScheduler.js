/** Coalesce input while one WebGPU submission is in flight. Unlike the GL fence
 * scheduler, queue completion is asynchronous and needs no rAF polling at idle. */
export function createWebgpuOpticsScheduler({ render, onError, requestFrame = requestAnimationFrame, cancelFrame = cancelAnimationFrame }) {
  let latest = null, frame = 0, busy = false, disposed = false, failed = false;
  const schedule = () => {
    if (!disposed && !failed && !busy && !frame && latest) frame = requestFrame(tick);
  };
  async function tick() {
    frame = 0;
    if (disposed || failed || !latest) return;
    const options = latest;
    latest = null;
    busy = true;
    try { await render(options); }
    catch (error) { failed = true; if (!disposed) onError(error); }
    finally { busy = false; schedule(); }
  }
  return {
    draw(options) {
      if (disposed || failed) return;
      latest = { ...options, camera: { ...options.camera } };
      schedule();
    },
    destroy() {
      disposed = true;
      cancelFrame(frame);
      latest = null;
    },
  };
}
