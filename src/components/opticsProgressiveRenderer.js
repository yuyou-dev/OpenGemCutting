/** During movement render fewer pixels with unchanged optics; refine only the
 * latest camera after input settles. The backend still owns GPU backpressure.
 * `stages` lists render scales from motion to complete. A sampling backend
 * skips intermediate scales: each resolution change restarts accumulation. */
export const POLISHED_STAGES = Object.freeze([.45, .7, 1]);
export const SAMPLING_STAGES = Object.freeze([.5, 1]);

export function createProgressiveOpticsRenderer(renderer, { setTimer = setTimeout, clearTimer = clearTimeout, stages = POLISHED_STAGES } = {}) {
  let timer = null, moving = false, disposed = false;
  const clear = () => { if (timer !== null) clearTimer(timer); timer = null; };
  return {
    draw(options) {
      if (disposed) return;
      clear();
      const snapshot = { ...options, camera: { ...options.camera } };
      const refine = (stage) => {
        renderer.draw({ ...snapshot, renderScale: stages[stage] });
        if (stage < stages.length - 1) timer = setTimer(() => { timer = null; refine(stage + 1); }, 120);
      };
      if (options.interactive) {
        renderer.draw({ ...snapshot, renderScale: stages[0] });
        timer = setTimer(() => { timer = null; refine(1); }, 120);
      } else if (moving) {
        refine(1);
      } else renderer.draw({ ...snapshot, renderScale: 1 });
      moving = Boolean(options.interactive);
    },
    destroy() { disposed = true; clear(); renderer.destroy(); },
  };
}
