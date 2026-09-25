import { createLabController, LAB_VERSION } from './labController.js';
import { importEditor96 } from '../core/application/import96.js';
import { createPattern } from '../core/application/patternPlan.js';
import { LAB_CONTRACT_VERSION } from '../core/application/labContract.js';
import { untilAborted } from './hostLifecycle.js';

/** Persistence belongs to one host-allocated experiment, never its source project.
 * All values crossing that boundary are snapshots, including origin metadata. */
export async function createLabSession({ source, newDesign, persistence, onResult, signal }) {
  signal?.throwIfAborted();
  if (!source && !newDesign) throw new Error('请提供来源快照或明确的新建请求。');
  if (source && newDesign) throw new Error('来源和新建请求只能选择一种。');
  if (source && (typeof source.projectId !== 'string' || !source.projectId || source.revision == null))
    throw new Error('来源快照需要项目身份与修订。');
  const origin = source ? structuredClone(source) : null;
  const initial = source ? importEditor96(origin.document) : createPattern(newDesign);
  const lifetime = new AbortController(), context = { signal: lifetime.signal };
  let disposed = false, paused = false, epoch = 0, queue = Promise.resolve(), returning = null, controller;
  function dispose() {
    if (disposed) return;
    disposed = true; epoch++;
    signal?.removeEventListener('abort', dispose);
    lifetime.abort();
    controller?.dispose();
  }
  signal?.addEventListener('abort', dispose, { once: true });
  try {
    const saved = await untilAborted(persistence?.load?.(context), context.signal);
    if (saved && (saved.labId !== 'facet-pattern-lab' || saved.contractVersion !== LAB_CONTRACT_VERSION ||
      ![LAB_VERSION, '0.6.0-rc.3', '0.6.0-rc.3.main.92ee082cc1e1', '0.6.0-rc.2', '0.6.0-rc.1', '0.5.1-alpha'].includes(saved.moduleVersion) ||
      saved.source?.projectId !== origin?.projectId || saved.source?.revision !== origin?.revision))
      throw new Error('实验稿版本或来源修订不匹配，原实验稿保留。');
    const wrap = plan => structuredClone({ labId: 'facet-pattern-lab', moduleVersion: LAB_VERSION,
      contractVersion: LAB_CONTRACT_VERSION, source: origin, plan });
    controller = createLabController({ initialPlan: saved?.plan ?? initial, registerGlobal: false, sessionStorage: null,
      persistence: { load: () => null, save: plan => {
        if (!persistence?.save) return;
        const draft = wrap(plan);
        queue = queue.catch(() => {}).then(() => { if (!disposed) return persistence.save(draft, context); });
        return queue;
      } } });
    async function flush(signal = context.signal) {
      if (disposed) return;
      let pending;
      do { pending = queue; await untilAborted(pending, signal); } while (pending !== queue);
    }
    return { controller, flush,
      async returnResult() {
        if (disposed || paused || returning) return;
        returning = new AbortController();
        const responseSignal = returning.signal;
        const cancelReturn = () => returning?.abort();
        context.signal.addEventListener('abort', cancelReturn, { once: true });
        const started = epoch;
        try {
          // An edit can enqueue another save while an earlier save is in flight.
          await flush(responseSignal);
          if (disposed || paused || started !== epoch) return;
          const snap = controller.getSnapshot();
          const result = structuredClone({ document: controller.exportDocument(), source: origin,
            contractVersion: LAB_CONTRACT_VERSION, moduleVersion: LAB_VERSION,
            diagnostics: { warnings: snap.compiled.audit.warnings, compatibility: snap.compatibility } });
          await untilAborted(onResult?.(structuredClone(result), { signal: responseSignal }), responseSignal);
          return disposed || paused || started !== epoch ? undefined : result;
        } catch (error) { if (!disposed && started === epoch) throw error; }
        finally { context.signal.removeEventListener('abort', cancelReturn); returning = null; }
      },
      pause() { if (!disposed) { paused = true; epoch++; returning?.abort(); controller.setSuspended(true); } },
      resume() { if (!disposed) { paused = false; controller.setSuspended(false); } },
      dispose,
    };
  } catch (error) { dispose(); throw error; }
}
