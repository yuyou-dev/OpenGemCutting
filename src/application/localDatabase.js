const fail = (code, message) => Object.assign(new Error(message), { code });
export const resultOf = request => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

/** Native transactions shared by project and experiment stores. Actions may
 * await IDB requests only; success means the entire transaction committed. */
export function createLocalDatabase({ indexedDB, name, recordsName }) {
  let connection;
  function open() {
    if (!connection) connection = new Promise((resolve, reject) => {
      if (!indexedDB) { reject(fail('LOCAL_STORAGE_UNAVAILABLE', '本地存储不可用，请允许浏览器本地存储后重试。')); return; }
      const request = indexedDB.open(name, 1);
      let rejected = false;
      request.onupgradeneeded = () => {
        request.result.createObjectStore(recordsName, { keyPath: 'id' });
        request.result.createObjectStore('meta', { keyPath: 'key' });
      };
      request.onblocked = () => { rejected = true; reject(fail('LOCAL_STORAGE_BLOCKED', '请关闭旧版工作台窗口，再重试打开本地存储。')); };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        if (rejected) { db.close(); return; }
        db.onversionchange = () => { db.close(); connection = null; };
        resolve(db);
      };
    }).catch(error => { connection = null; throw error; });
    return connection;
  }
  // The action awaits IDB requests only; the returned promise resolves at
  // transaction completion, never at the individual put's success event.
  async function transaction(mode, action, { signal, assertCurrent } = {}) {
    const db = await open();
    signal?.throwIfAborted(); assertCurrent?.();
    const tx = db.transaction([recordsName, 'meta'], mode);
    const abort = () => tx.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const done = new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error ?? fail('LOCAL_WRITE_ABORTED', '本地保存已中断，原记录仍保留，请重试。'));
    });
    // Handle a transaction abort even while the action is still awaiting a request.
    done.catch(() => {});
    try {
      const value = await action(tx.objectStore(recordsName), tx.objectStore('meta'));
      assertCurrent?.();
      await done;
      return value;
    } catch (error) {
      try { tx.abort(); } catch { /* Already completed or aborted. */ }
      await done.catch(() => {});
      throw error;
    } finally { signal?.removeEventListener('abort', abort); }
  }
  return { transaction, async close() { const pending = connection; connection = null; if (pending) (await pending).close(); } };
}
