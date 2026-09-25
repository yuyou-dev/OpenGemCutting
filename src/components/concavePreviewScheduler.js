/** One calculation in flight, one latest pending position. Finished previews
 * may be shown during a drag; only the exact released position can be committed. */
export function createConcavePreviewScheduler({ createWorker, onPreview, onCommit, onError }) {
  let worker, workerBase, active, pending, last, generation = 0;
  const keyOf = operation => JSON.stringify(operation);
  function warmup() {
    if (!worker) {
      worker = createWorker();
      worker.onmessage = ({ data }) => {
        const job = active; active = null;
        if (!job) return;
        if (job.generation === generation) {
          if (data.error) { if (!pending) onError(data.error); }
          else {
            last = { ...job, result: data.result };
            if (job.commit && !pending) onCommit(job.base, data.result);
            else onPreview(job.base, data.result);
          }
        }
        start();
      };
      worker.onerror = () => {
        worker.terminate(); worker = null; workerBase = null;
        active = pending = last = null; generation++;
        onError('凹切计算暂时中断，请重新调整参数。');
      };
    }
  }
  function start() {
    if (active || !pending) return;
    active = pending; pending = null;
    warmup();
    worker.postMessage({ ...(workerBase === active.base ? {} : { document: active.base }), operation: active.operation });
    workerBase = active.base;
  }
  return {
    warmup,
    preview(base, operation) {
      pending = { base, operation, key: keyOf(operation), generation, commit: false };
      start();
    },
    finish(base, operation) {
      const key = keyOf(operation);
      if (!pending && active?.generation === generation && active.base === base && active.key === key) active.commit = true;
      else if (!active && last?.generation === generation && last.base === base && last.key === key) onCommit(base, last.result);
      else { pending = { base, operation, key, generation, commit: true }; start(); }
    },
    cancel() { generation++; pending = last = null; },
    destroy() { generation++; worker?.terminate(); worker = null; workerBase = null; active = pending = last = null; },
  };
}
