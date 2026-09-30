/** Keep the edit camera/document outside GPU lifecycle changes. p5 cannot
 * rebuild its shaders and buffers on a restored WebGL context, so a lost
 * context pauses drawing until the browser restores it (or `fallbackDelay`
 * passes without a restore); a fresh p5 instance then draws the latest scene. */
export function createViewportLifecycle({
  createInstance, releaseInstance, onLost, onRestore, onError,
  fallbackDelay = 3000, setTimer = setTimeout, clearTimer = clearTimeout,
}) {
  let instance = null;
  let canvas = null;
  let fallback = null;
  let lost = false;
  let disposed = false;
  const unwatch = () => {
    clearTimer(fallback);
    fallback = null;
    canvas?.removeEventListener("webglcontextlost", onContextLost);
    canvas?.removeEventListener("webglcontextrestored", replace);
    canvas = null;
  };
  function onContextLost(event) {
    event.preventDefault(); // Otherwise the browser never restores the context.
    lost = true;
    onLost();
    fallback = setTimer(replace, fallbackDelay);
  }
  function replace() {
    unwatch();
    if (instance) releaseInstance(instance, { contextLost: true });
    instance = null;
    create();
  }
  function fail() {
    if (disposed) return;
    unwatch();
    if (instance) releaseInstance(instance, { contextLost: true });
    instance = null;
    lost = true;
    onError();
  }
  function create() {
    try { instance = createInstance(); }
    catch { fail(); }
  }
  create();
  return {
    /** The drawable p5 instance; null while its context is lost. */
    get instance() { return lost ? null : instance; },
    /** p5 setup reports each new canvas; a replacement's canvas ends the pause. */
    attach(nextCanvas) {
      if (!instance) return;
      unwatch();
      canvas = nextCanvas;
      canvas.addEventListener("webglcontextlost", onContextLost);
      canvas.addEventListener("webglcontextrestored", replace);
      if (lost) {
        lost = false;
        onRestore();
      }
    },
    // p5 setup is asynchronous: the integration reports creation failures here.
    fail,
    retry() {
      if (disposed) return;
      lost = true;
      onLost();
      replace();
    },
    destroy() {
      disposed = true;
      unwatch();
      if (instance) releaseInstance(instance, { contextLost: lost });
      instance = null;
    },
  };
}
