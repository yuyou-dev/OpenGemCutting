import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { LabWorkspace } from '../components/LabWorkspace.jsx';
import { createLabSession } from '../state/labSession.js';
import { untilAborted } from '../state/hostLifecycle.js';

const mounted = new WeakMap();

/** Owns one React root; hosts exchange documents and callbacks, never React nodes.
 * In Vite development CSS is managed by HMR; the distribution owns its CSS link. */
export async function mountPatternLab(element, options) {
  if (!element?.ownerDocument) throw new Error('请提供实验室挂载元素。');
  if (mounted.has(element)) throw new Error('该容器已有实验室实例，请先释放。');
  const lifetime = new AbortController(), { signal } = lifetime;
  const doc = element.ownerDocument;
  let session, root, container, style, disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    options.signal?.removeEventListener('abort', dispose);
    lifetime.abort();
    session?.dispose();
    root?.unmount();
    container?.remove();
    style?.remove();
    mounted.delete(element);
  }
  mounted.set(element, dispose);
  options.signal?.addEventListener('abort', dispose, { once: true });
  try {
    options.signal?.throwIfAborted();
    if (import.meta.env.LAB_MODULE_BUILD) {
      style = doc.createElement('link');
      style.rel = 'stylesheet';
      style.dataset.patternLabStyle = '';
      const relative = './style.css';
      style.href = new URL(relative, import.meta.url).href;
      const ready = new Promise((resolve, reject) => {
        style.onload = resolve;
        style.onerror = () => reject(new Error('实验室样式未加载，请核对交付目录。'));
      });
      doc.head.append(style);
      await untilAborted(ready, signal);
    }
    session = await createLabSession({ ...options, signal });
    signal.throwIfAborted();
    container = doc.createElement('div');
    const presentation = { layout: 'embedded', resultAction: 'module', ...options.presentation };
    if (!['embedded', 'standalone'].includes(presentation.layout) || !['host', 'module'].includes(presentation.resultAction)) throw new Error('无效的工作区布局选项。');
    container.className = 'facet-pattern-lab';
    container.dataset.presentation = presentation.layout;
    element.append(container);
    root = createRoot(container);
    session.controller.start(container);
    flushSync(() => root.render(<LabWorkspace controller={session.controller} hostActions={session} presentation={presentation} />));
    return { ...session,
      pause() { if (!disposed) { container.inert = true; session.pause(); } },
      resume() { if (!disposed) { session.resume(); container.inert = false; } },
      dispose,
    };
  } catch (error) { dispose(); throw error; }
}
