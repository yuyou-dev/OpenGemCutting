import { solveEdit } from './editOperation.js';

/** One active solve and one latest preview. Cancellation terminates expensive
 * work; document/history ownership stays entirely in the controller. */
export function createEditExecutor() {
  if (typeof Worker === 'undefined') return { run: solveEdit, cancel() {}, dispose() {} };
  let worker = null, active = null, queued = null, serial = 0;

  function launch(job) {
    active = job;
    try {
      if (!worker) {
        worker = new Worker(new URL('./editWorker.js', import.meta.url), { type: 'module' });
        worker.onmessage = ({ data }) => {
          if (data.id !== active?.id) return;
          const finished = active;
          active = null;
          finished.resolve(data.result);
          if (queued) { const next = queued; queued = null; launch(next); }
        };
        worker.onerror = event => {
          const failed = active;
          failed?.resolve({ error: 'EDIT_WORKER', message: `几何计算中断：${event.message || '请重试这次操作'}` });
          cancel();
        };
      }
      worker.postMessage({ id: job.id, ...job.request });
    } catch (error) {
      active = null;
      job.resolve({ error: 'EDIT_WORKER', message: `几何计算未启动：${error.message}` });
    }
  }
  function cancel() {
    // Keep an idle worker warm between drags, including its compiled base mesh.
    if (active) { worker?.terminate(); worker = null; }
    active?.resolve({ cancelled: true }); queued?.resolve({ cancelled: true });
    active = null; queued = null;
  }
  return {
    run(request) {
      return new Promise(resolve => {
        const job = { request, resolve, id: ++serial };
        if (active) { queued?.resolve({ cancelled: true }); queued = job; }
        else launch(job);
      });
    },
    cancel,
    dispose() { cancel(); worker?.terminate(); worker = null; },
  };
}
