import { importFacetingJSON } from "./faceting.js";
import { createLocalRecoveryStore } from "./localRecovery.js";

const PREFIX = "facet96:project:v1:";
const MIGRATED_PREFIX = "facet96:project-migration:v1:";
const legacyProjectId = (id) => `legacy-${encodeURIComponent(id)}`;

// Only the committed document crosses this boundary; viewport and CUT state do not.
function projectSnapshot(document) {
  const validated = importFacetingJSON(document);
  const { $schema, schemaVersion, kind, name, indexGear, stock, facets, metadata } = validated;
  if (metadata?.optics) delete metadata.optics.view;
  return { $schema, schemaVersion, kind, name, indexGear, stock, facets, ...(metadata ? { metadata } : {}) };
}

// Callers may edit returned metadata/facets. The cache owns its snapshots;
// only a validated and deeply frozen mesh stock can cross by reference.
function copyRecord(record) {
  const { stock, ...document } = record.document;
  const copy = structuredClone({ ...record, document });
  copy.document.stock = stock.kind === "mesh" ? stock : structuredClone(stock);
  return copy;
}

export function createProjectStore(storage, { locks } = {}) {
  const cache = new Map();
  // Compare-and-write must not be interleaved by another writer: run the
  // read/check/write block under a Web Lock when the platform provides one.
  const withWriteLock = (id, action) => (
    locks?.request ? locks.request(`facet96:project-lock:${id}`, action) : action()
  );
  const read = (id) => {
    const raw = storage.getItem(`${PREFIX}${id}`);
    if (raw === null) { cache.delete(id); return null; }
    const cached = cache.get(id);
    if (cached?.raw === raw) return copyRecord(cached.record);
    // Another tab or external edit changed storage: validate the new bytes.
    cache.delete(id);
    const record = JSON.parse(raw);
    if (record.schemaVersion !== 1 || !Number.isFinite(record.createdAt) || !Number.isFinite(record.updatedAt)) {
      throw new Error("本地项目格式不受支持。");
    }
    // Records written before revisions existed upgrade to baseline 0.
    const revision = Number.isInteger(record.revision) && record.revision >= 0 ? record.revision : 0;
    const validated = { id, createdAt: record.createdAt, updatedAt: record.updatedAt, revision, document: projectSnapshot(record.document) };
    cache.set(id, { raw, record: validated });
    return copyRecord(validated);
  };
  const write = (record) => {
    const document = projectSnapshot(record.document);
    const raw = JSON.stringify({
      schemaVersion: 1,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      revision: record.revision ?? 0,
      document,
    });
    storage.setItem(`${PREFIX}${record.id}`, raw);
    const validated = { ...record, document };
    // Quota failure must leave both storage and the previous cache intact.
    cache.set(record.id, { raw, record: validated });
    return copyRecord(validated);
  };
  return {
    read,
    list() {
      const records = [];
      let unreadableCount = 0;
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (!key?.startsWith(PREFIX)) continue;
        try {
          const record = read(key.slice(PREFIX.length));
          if (record) records.push(record);
        } catch { unreadableCount += 1; }
      }
      return { records: records.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)), unreadableCount };
    },
    create(document, { id = crypto.randomUUID(), now = Date.now() } = {}) {
      if (storage.getItem(`${PREFIX}${id}`) !== null) throw new Error("项目已存在，请打开原项目。");
      return write({ id, createdAt: now, updatedAt: now, revision: 1, document });
    },
    save(id, document, options = {}) {
      const { expectedRevision, updatedAt = Date.now() } = typeof options === "number" ? { updatedAt: options } : options;
      return withWriteLock(id, () => {
        const existing = read(id);
        if (!existing) {
          const error = new Error("项目已被删除，请将当前设计另存为新项目或导出 JSON。");
          error.code = "PROJECT_DELETED";
          throw error;
        }
        if (expectedRevision !== undefined && existing.revision !== expectedRevision) {
          const error = new Error("该项目已在其他窗口被修改，自动保存已停止。请重新载入最新版本、另存为新项目或导出 JSON。");
          error.code = "PROJECT_CONFLICT";
          throw error;
        }
        return write({ ...existing, revision: existing.revision + 1, updatedAt, document });
      });
    },
    remove(id) {
      return withWriteLock(id, () => {
        // The marker survives deletion, including a previously interrupted migration.
        if (id.startsWith("legacy-")) storage.setItem(`${MIGRATED_PREFIX}${id}`, "1");
        storage.removeItem(`${PREFIX}${id}`);
        cache.delete(id);
      });
    },
    migrateLegacy() {
      const legacy = createLocalRecoveryStore(storage).list();
      for (const record of legacy.records) {
        const id = legacyProjectId(record.id);
        if (storage.getItem(`${MIGRATED_PREFIX}${id}`) !== null) continue;
        // Write first: a quota failure must not mark an unsaved design as migrated.
        // If the marker write was interrupted, retry without overwriting later edits.
        if (storage.getItem(`${PREFIX}${id}`) === null) {
          write({ id, createdAt: record.savedAt, updatedAt: record.savedAt, revision: 1, document: record.document });
        }
        storage.setItem(`${MIGRATED_PREFIX}${id}`, "1");
      }
      return { unreadableCount: legacy.unreadableCount };
    },
  };
}
