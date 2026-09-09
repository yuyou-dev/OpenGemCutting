/** Keep the optical camera/document outside GPU lifecycle changes. A restored
 * context gets fresh resources; draws while the context is lost are ignored. */
export function createOpticsRendererLifecycle(canvas, { createRenderer, onError, onRestore }) {
  let renderer = createRenderer(canvas, onError);
  const onContextLost = (event) => {
    event.preventDefault();
    renderer?.destroy();
    renderer = null;
    onError("显卡上下文暂时中断，恢复后将自动重绘光学仿真。");
  };
  const onContextRestored = () => {
    renderer = createRenderer(canvas, onError);
    if (renderer) onRestore();
  };
  canvas.addEventListener("webglcontextlost", onContextLost);
  canvas.addEventListener("webglcontextrestored", onContextRestored);
  return {
    draw(options) { renderer?.draw(options); },
    destroy() {
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      renderer?.destroy();
      renderer = null;
    },
  };
}
