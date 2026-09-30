import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { PresetStudioApp } from '../App.jsx';
import { createPresetStudioSession, abortable } from '../application/labSession.js';
import '../styles.css';
import '@fontsource-variable/noto-sans-sc';
import '@fontsource/ibm-plex-mono/400.css';

const mounts = new WeakMap();
export async function mountPresetStudio(element, options = {}) {
    if (!element?.ownerDocument || mounts.has(element)) throw Error('请提供空闲的实验室容器。');
    const lifetime = new AbortController(), doc = element.ownerDocument;
    let session, root, container, style, disposed = false;
    function dispose() {
        if (disposed) return;
        disposed = true; options.signal?.removeEventListener('abort', dispose);
        lifetime.abort(); session?.dispose(); root?.unmount(); container?.remove(); style?.remove(); mounts.delete(element);
    }
    mounts.set(element, dispose);
    options.signal?.addEventListener('abort', dispose, { once: true });
    try {
        options.signal?.throwIfAborted();
        if (import.meta.env.LAB_MODULE_BUILD) {
            style = doc.createElement('link'); style.rel = 'stylesheet'; style.dataset.presetStudioStyle = '';
            const filename = './style.css'; style.href = new URL(filename, import.meta.url).href;
            const ready = new Promise((resolve, reject) => { style.onload = resolve; style.onerror = () => reject(Error('实验室样式加载失败，请核对固定交付包。')); });
            doc.head.append(style); await abortable(ready, lifetime.signal);
        }
        session = await createPresetStudioSession({ ...options, signal: lifetime.signal });
        lifetime.signal.throwIfAborted();
        container = doc.createElement('div'); container.className = 'ps-host'; element.append(container);
        root = createRoot(container);
        flushSync(() => root.render(<PresetStudioApp store={session.store} presentation={{ layout: 'embedded', ...options.presentation }} />));
        return { ...session,
            pause() { if (!disposed) { container.inert = true; session.pause(); } },
            resume() { if (!disposed) { session.resume(); container.inert = false; } },
            dispose };
    } catch (e) { dispose(); throw e; }
}
