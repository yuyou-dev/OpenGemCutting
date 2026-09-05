import { exportFacetingJSON, importFacetingJSON } from "./faceting.js";

const PREFIX = "opengemcutting:recovery:v1:";

/** Each record contains only a validated committed document, never UI or CUT state. */
export function createLocalRecoveryStore(storage) {
  const read = (id) => {
    const raw = storage.getItem(`${PREFIX}${id}`);
    if (!raw) return null;
    const record = JSON.parse(raw);
    if (record.schemaVersion !== 1 || !Number.isFinite(record.savedAt)) {
      throw new Error("本地备份格式不受支持。");
    }
    return { id, savedAt: record.savedAt, document: importFacetingJSON(record.document) };
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
      return { records: records.sort((a, b) => b.savedAt - a.savedAt), unreadableCount };
    },
    save(id, document, savedAt = Date.now()) {
      const snapshot = JSON.parse(exportFacetingJSON(document));
      if (snapshot.metadata?.optics) delete snapshot.metadata.optics.view;
      storage.setItem(`${PREFIX}${id}`, JSON.stringify({
        schemaVersion: 1,
        savedAt,
        document: snapshot,
      }));
      return savedAt;
    },
    remove(id) { storage.removeItem(`${PREFIX}${id}`); },
  };
}
