import { createStudioStore } from './studioStore.js';
import { makeNativeDocument, startGirdleFacets } from '../adapters/opengemcutting.js';
import { cubeSolid } from '../domain/geometry.js';
import { moduleInfo } from '../lab/info.js';

function abortable(work, signal) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        Promise.resolve(work).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
}
// Drafts saved under an earlier public contract stay loadable; the workspace format did not change.
const PUBLISHED_DRAFT_CONTRACTS = Object.freeze(['1.1.0']);

export { abortable };

/** Independent experimental copy. The host owns persistence and the returned
 * project's transaction; this module never receives a project-store handle. */
export async function createPresetStudioSession({ source, newDesign, persistence, onResult, signal } = {}) {
    signal?.throwIfAborted();
    if (!!source === !!newDesign) throw Error('请提供来源快照或新建请求，两者只能选择一种。');
    if (source && (!source.projectId || source.revision == null)) throw Error('来源快照缺少项目身份或修订。');
    const origin = source ? structuredClone(source) : null;
    const lifetime = new AbortController(), context = { signal: lifetime.signal };
    let disposed = false, paused = false, store, unsubscribe, returning, queue = Promise.resolve(), saveError = null;
    let lastModel, pending;
    function dispose() {
        if (disposed) return;
        disposed = true;
        signal?.removeEventListener('abort', dispose);
        returning?.abort(); lifetime.abort(); unsubscribe?.(); store?.destroy();
    }
    signal?.addEventListener('abort', dispose, { once: true });
    try {
        const saved = await abortable(persistence?.load?.(context), context.signal);
        if (saved && (saved.labId !== moduleInfo.id || ![moduleInfo.moduleVersion, '0.5.0-rc.1', '0.5.0-rc.2', '0.5.0-rc.3', '0.5.0-rc.4', '0.5.0-rc.5', '0.5.0-rc.6', '0.5.0-rc.7', '0.5.0-rc.8'].includes(saved.moduleVersion) || ![moduleInfo.contractVersion, ...PUBLISHED_DRAFT_CONTRACTS].includes(saved.contractVersion)
            || JSON.stringify(saved.source) !== JSON.stringify(origin))) throw Error('实验稿版本或来源不匹配，原实验稿保留；请使用对应版本恢复。');
        let document = origin?.document;
        if (!source) {
            if (!Number.isFinite(newDesign.sizeMm) || newDesign.sizeMm <= 0) throw Error('请输入有效的初始宽度。');
            const teeth = newDesign.teeth ?? 96, stock = { kind: 'cube', size: 2.4, center: [0, 0, 0] };
            document = makeNativeDocument({ polys: cubeSolid(2.4), convex: true, nativeStock: stock }, null, [], [], { teeth });
            document.facets = startGirdleFacets(stock, teeth);
            document.name = newDesign.name || '冠亭设计实验';
            document.metadata = { ...document.metadata, physicalScale: { millimetersPerModelUnit: newDesign.sizeMm / 2 } };
        }
        // Constructor validates before opening any viewport; failure never shows a default design.
        store = createStudioStore({ initialDocument: document, workspace: saved?.workspace, embedded: true });
        const payload = () => structuredClone({ labId: moduleInfo.id, moduleVersion: moduleInfo.moduleVersion,
            contractVersion: moduleInfo.contractVersion, source: origin, workspace: store.api.exportWorkspace() });
        function save() {
            pending = payload(); const current = pending;
            queue = queue.catch(() => {}).then(async () => {
                context.signal.throwIfAborted();
                try { await abortable(persistence?.save?.(current, context), context.signal); if (pending === current) pending = null; saveError = null; }
                catch (e) { saveError = e; throw e; }
            });
            // Keep asynchronous autosave rejection observable by flush, without an unhandled rejection.
            queue.catch(() => {});
        }
        lastModel = store.getState().model;
        unsubscribe = store.subscribe(() => {
            const next = store.getState().model;
            if (next === lastModel || disposed) return;
            lastModel = next; returning?.abort(); save();
        });
        save();
        const flush = async () => {
            context.signal.throwIfAborted();
            if (saveError && pending) save();
            let current;
            do { current = queue; await abortable(current, context.signal); } while (current !== queue);
        };
        return { store, flush,
            async returnResult() {
                if (disposed || paused || returning) return;
                const request = new AbortController(); returning = request;
                try {
                    const document = store.candidateDocument();
                    await abortable(flush(), request.signal); request.signal.throwIfAborted();
                    const result = structuredClone({ document, source: origin, moduleVersion: moduleInfo.moduleVersion,
                        contractVersion: moduleInfo.contractVersion, diagnostics: { warnings: [] } });
                    await abortable(onResult?.(structuredClone(result), { signal: request.signal }), request.signal);
                    return result;
                } catch (error) { if (!disposed && !paused) throw error; } finally { if (returning === request) returning = null; }
            },
            pause() { if (!disposed && !paused) { paused = true; returning?.abort(); store.setSuspended(true); } },
            resume() { if (!disposed && paused) { paused = false; store.setSuspended(false); } },
            dispose,
        };
    } catch (error) { dispose(); throw error; }
}
