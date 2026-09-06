import { exportFacetingJSON, importFacetingJSON } from "./faceting.js";
import { createLocalRecoveryStore } from "./localRecovery.js";

const PREFIX = "opengemcutting:project:v1:";
const MIGRATED_PREFIX = "opengemcutting:project-migration:v1:";
const legacyProjectId = (id) => `legacy-${encodeURIComponent(id)}`;

// Only the committed document crosses this boundary; viewport and CUT state do not.
function projectSnapshot(document) {
  const validated = importFacetingJSON(exportFacetingJSON(document));
  const { $schema, schemaVersion, kind, name, indexGear, stock, facets, metadata } = validated;
  if (metadata?.optics) delete metadata.optics.view;
  return { $schema, schemaVersion, kind, name, indexGear, stock, facets, ...(metadata ? { metadata } : {}) };
}

export function createProjectStore(storage) {
  const read = (id) => {
    const raw = storage.getItem(`${PREFIX}${id}`);
    if (raw === null) return null;
    const record = JSON.parse(raw);
    if (record.schemaVersion !== 1 || !Number.isFinite(record.createdAt) || !Number.isFinite(record.updatedAt)) {
      throw new Error("本地项目格式不受支持。");
    }
    return { id, createdAt: record.createdAt, updatedAt: record.updatedAt, document: projectSnapshot(record.document) };
  };
  const write = (record) => {
    const document = projectSnapshot(record.document);
    storage.setItem(`${PREFIX}${record.id}`, JSON.stringify({
      schemaVersion: 1,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      document,
    }));
    return { ...record, document };
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
      return write({ id, createdAt: now, updatedAt: now, document });
    },
    save(id, document, updatedAt = Date.now()) {
      const existing = read(id);
      if (!existing) throw new Error("项目已被删除，请将当前设计另存为新项目或导出 JSON。");
      return write({ ...existing, updatedAt, document });
    },
    remove(id) {
      // The marker survives deletion, including a previously interrupted migration.
      if (id.startsWith("legacy-")) storage.setItem(`${MIGRATED_PREFIX}${id}`, "1");
      storage.removeItem(`${PREFIX}${id}`);
    },
    migrateLegacy() {
      const legacy = createLocalRecoveryStore(storage).list();
      for (const record of legacy.records) {
        const id = legacyProjectId(record.id);
        if (storage.getItem(`${MIGRATED_PREFIX}${id}`) !== null) continue;
        // Write first: a quota failure must not mark an unsaved design as migrated.
        // If the marker write was interrupted, retry without overwriting later edits.
        if (storage.getItem(`${PREFIX}${id}`) === null) {
          write({ id, createdAt: record.savedAt, updatedAt: record.savedAt, document: record.document });
        }
        storage.setItem(`${MIGRATED_PREFIX}${id}`, "1");
      }
      return { unreadableCount: legacy.unreadableCount };
    },
  };
}
