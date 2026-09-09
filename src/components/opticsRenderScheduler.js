/** Keep one GPU submission in flight and coalesce updates to the latest camera.
 * This deterministic tracer already produces a complete image per draw: repeating
 * it at idle adds no detail. Preserve the same quality during and after dragging. */
export function createOpticsRenderScheduler({ gl, render, onError, requestFrame = requestAnimationFrame, cancelFrame = cancelAnimationFrame }) {
  let latest, frame = 0, fence = null, disposed = false;
  const schedule = () => { if (!frame && !disposed) frame = requestFrame(tick); };
  function tick() {
    frame = 0;
    if (disposed) return;
    if (fence) {
      const status = gl.clientWaitSync(fence, 0, 0);
      if (status === gl.TIMEOUT_EXPIRED) { schedule(); return; }
      gl.deleteSync(fence);
      fence = null;
      if (status === gl.WAIT_FAILED) {
        onError('光学渲染暂时中断，请退出仿真后重试。');
        return;
      }
    }
    if (!latest) return;
    const options = latest;
    latest = null;
    try {
      render(options);
    } catch (error) {
      onError(`光学渲染失败：${error.message}`);
      return;
    }
    fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    // Poll only while newer input is pending; an idle image needs no extra work.
  }
  return {
    draw(options) {
      if (disposed) return;
      latest = { ...options, camera: { ...options.camera } };
      schedule();
    },
    destroy() {
      disposed = true;
      cancelFrame(frame);
      if (fence) gl.deleteSync(fence);
      latest = null;
      fence = null;
    },
  };
}
