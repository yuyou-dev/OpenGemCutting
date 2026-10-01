// The 3D renderer (p5, about 1.1 MB) loads on demand. Starting the download while
// the designer is still on the home page usually hides the wait entirely.
let pending = null;

/** The p5 constructor; one shared download, retried after a failure. */
export function loadViewportRenderer() {
  pending ??= import("p5").then((module) => module.default).catch((error) => {
    pending = null;
    throw error;
  });
  return pending;
}

/** Fetch the renderer when the browser is idle; failures surface later in the viewport. */
export function preloadViewportRenderer() {
  const whenIdle = globalThis.requestIdleCallback ?? ((callback) => setTimeout(callback, 1500));
  whenIdle(() => { loadViewportRenderer().catch(() => {}); });
}
