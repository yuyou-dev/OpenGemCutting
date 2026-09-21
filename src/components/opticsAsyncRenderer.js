/** Queue the latest view while WebGPU initializes. A failed or late instance can
 * never draw again; React owns replacing its canvas for the WebGL2 fallback. */
export function createAsyncOpticsRenderer({ createRenderer, onFallback }) {
  let renderer = null, latest = null, disposed = false, failed = false;
  const fail = () => {
    if (disposed || failed) return;
    failed = true;
    renderer?.destroy();
    renderer = null;
    onFallback();
  };
  const ready = Promise.resolve().then(() => {
    if (!disposed) return createRenderer(fail);
  }).then((instance) => {
    if (disposed || failed) { instance?.destroy(); return; }
    renderer = instance;
    if (!renderer) { fail(); return; }
    if (latest) renderer.draw(latest);
  }).catch(fail);
  return {
    ready,
    draw(options) {
      if (disposed || failed) return;
      latest = { ...options, camera: { ...options.camera } };
      try { renderer?.draw(latest); } catch { fail(); }
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      renderer?.destroy();
      renderer = latest = null;
    },
  };
}
