const PREFIX = 'facet96:experiment:v1:';
const copy = value => structuredClone(value);
const failure = (code, message) => Object.assign(new Error(message), { code });
export function validateLabDraftRecord(record) {
  if (record?.schemaVersion !== 1 || typeof record.id !== 'string' || !Number.isInteger(record.revision) ||
    typeof record.labId !== 'string' || !Array.isArray(record.returns) ||
    Boolean(record.source) === Boolean(record.newDesign) ||
    (record.source && (typeof record.source.projectId !== 'string' || !record.source.document || typeof record.source.document.name !== 'string')))
    throw failure('DRAFT_FORMAT', '实验稿格式无法读取，原记录仍保留。请下载恢复文件。');
  return record;
}

/** Independent experiment records. Laboratory plans are opaque recovery data;
 * only public documents enter the project library. No source project is written. */
export function createLabDraftStore(storage, { locks } = {}) {
  const read = id => {
    const raw = storage.getItem(PREFIX + id);
    if (raw === null) return null;
    const record = validateLabDraftRecord(JSON.parse(raw));
    if (record.id !== id)
      throw failure('DRAFT_FORMAT', '实验稿格式无法读取，原记录仍保留。请下载恢复文件。');
    return record;
  };
  const write = record => { storage.setItem(PREFIX + record.id, JSON.stringify(record)); return copy(record); };
  return {
    read,
    raw: id => storage.getItem(PREFIX + id),
    list() {
      const records = [], unreadable = [];
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i); if (!key?.startsWith(PREFIX)) continue;
        const id = key.slice(PREFIX.length);
        try { records.push(read(id)); } catch { unreadable.push(id); }
      }
      return { records: records.sort((a,b) => b.updatedAt - a.updatedAt), unreadable };
    },
    create({ labId, moduleVersion, contractVersion, source = null, newDesign = null, draft = null, recoveredFrom = null }, { id = crypto.randomUUID(), now = Date.now() } = {}) {
      if (read(id)) throw failure('DRAFT_EXISTS', '实验稿已存在。');
      if (Boolean(source) === Boolean(newDesign)) throw failure('DRAFT_SOURCE', '请选择来源设计或新建实验。');
      return write({ schemaVersion: 1, id, revision: 1, labId, moduleVersion, contractVersion, createdAt: now, updatedAt: now,
        source: copy(source), newDesign: copy(newDesign), draft: copy(draft), recoveredFrom, candidate: null, returns: [] });
    },
    async change(id, update, { expectedRevision, signal } = {}) {
      const action = () => {
        signal?.throwIfAborted();
        const current = read(id);
        if (!current) throw failure('DRAFT_MISSING', '实验稿记录已不存在，当前恢复数据仍可下载。');
        if (expectedRevision !== undefined && current.revision !== expectedRevision)
          throw failure('DRAFT_CONFLICT', '实验稿已在另一个窗口更新。当前改动保留在内存，请下载恢复文件后另存恢复。');
        const patch = update(copy(current));
        signal?.throwIfAborted();
        return write({ ...current, ...patch, id, revision: current.revision + 1, updatedAt: Date.now() });
      };
      return locks?.request ? locks.request(`facet96:experiment-lock:${id}`, action) : action();
    },
  };
}
