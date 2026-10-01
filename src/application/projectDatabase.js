import { createLocalDatabase, resultOf } from './localDatabase.js';
import { projectSnapshot, parseProjectRecord, copyRecord } from '../domain/projectLibrary.js';
import { createLocalRecoveryStore } from '../domain/localRecovery.js';

export const PROJECT_DATABASE = 'facet96-projects';
const PREFIX = 'facet96:project:v1:';
const RECOVERY = 'facet96:recovery:v1:';
const STARTED = 'facet96:projects-started:v1';
const fail = (code, message) => Object.assign(new Error(message), { code });
/** All live project writes use IndexedDB transactions. localStorage is an
 * import-only source, never a fallback writer or a mirror of current projects. */
export function createProjectDatabase({ indexedDB, legacyStorage, name = PROJECT_DATABASE, onChange = () => {} }) {
  const { transaction, close } = createLocalDatabase({ indexedDB, name, recordsName: 'projects' });
  const cache = new Map();
  const decode = stored => {
    if (!stored) return null;
    let entry = cache.get(stored.id);
    if (entry?.raw !== stored.raw) {
      cache.delete(stored.id);
      entry = { raw: stored.raw, record: parseProjectRecord(stored.id, stored.raw) };
      cache.set(stored.id, entry);
    }
    return copyRecord(entry.record);
  };
  const encode = record => ({ id: record.id, raw: JSON.stringify({ schemaVersion: 1, ...record }) });
  const store = {
    async read(id) { return decode(await transaction('readonly', projects => resultOf(projects.get(id)))); },
    async list() {
      const stored = await transaction('readonly', projects => resultOf(projects.getAll()));
      const records = []; let unreadableCount = 0;
      for (const item of stored) { try { records.push(decode(item)); } catch { unreadableCount++; } }
      return { records: records.sort((a,b) => b.updatedAt-a.updatedAt || a.id.localeCompare(b.id)), unreadableCount };
    },
    async create(document, { id = crypto.randomUUID(), now = Date.now(), ...options } = {}) {
      const record = { id, createdAt: now, updatedAt: now, revision: 1, document: projectSnapshot(document) };
      const stored = encode(record);
      await transaction('readwrite', async (projects, meta) => {
        if (await resultOf(projects.get(id))) throw fail('PROJECT_EXISTS', '项目已存在，请打开原项目。');
        options.assertCurrent?.();
        projects.add(stored); meta.put({ key: 'started', value: true });
      }, options);
      onChange(); return decode(stored);
    },
    async save(id, document, { expectedRevision, updatedAt = Date.now(), ...options } = {}) {
      const snapshot = projectSnapshot(document);
      const stored = await transaction('readwrite', async projects => {
        const existing = decode(await resultOf(projects.get(id)));
        if (!existing) throw fail('PROJECT_DELETED', '项目已被删除，请将当前设计另存为新项目或导出 JSON。');
        if (expectedRevision !== existing.revision) throw fail('PROJECT_CONFLICT', '该项目已在其他窗口被修改，自动保存已停止。请重新载入最新版本、另存为新项目或导出 JSON。');
        const next = encode({ ...existing, document: snapshot, revision: existing.revision + 1, updatedAt });
        projects.put(next); return next;
      }, options);
      onChange(); return decode(stored);
    },
    async remove(id) {
      await transaction('readwrite', (projects, meta) => { projects.delete(id); meta.put({ key: 'started', value: true }); });
      cache.delete(id); onChange();
    },
    async needsStarterProjects() {
      return transaction('readonly', async (projects, meta) => !(await resultOf(meta.get('started'))) && !(await resultOf(projects.count())));
    },
    async seedStarterProjects(documents) {
      const now = Date.now();
      const records = documents.map((document,index) => encode({ id: `starter-${index+1}`, createdAt: now, updatedAt: now-index, revision: 1, document: projectSnapshot(document) }));
      const seeded = await transaction('readwrite', async (projects, meta) => {
        if (await resultOf(meta.get('started')) || await resultOf(projects.count())) return false;
        for (const record of records) projects.add(record);
        meta.put({ key: 'started', value: true }); return true;
      });
      if (seeded) onChange();
    },
    async migrateLegacy() {
      const entries = []; let unreadableCount = 0;
      const recovery = createLocalRecoveryStore(legacyStorage);
      let hasLegacy = Boolean(legacyStorage.getItem(STARTED));
      const keys = Array.from({ length: legacyStorage.length }, (_, i) => legacyStorage.key(i)).filter(Boolean).sort();
      for (const key of keys) {
        if (!key?.startsWith(PREFIX) && !key?.startsWith(RECOVERY)) continue;
        hasLegacy = true;
        const raw = legacyStorage.getItem(key);
        try {
          let record;
          if (key.startsWith(PREFIX)) record = parseProjectRecord(key.slice(PREFIX.length), raw);
          else {
            const old = recovery.read(key.slice(RECOVERY.length));
            const id = `legacy-${encodeURIComponent(old.id)}`;
            // Earlier versions explicitly migrated or deleted this backup.
            if (legacyStorage.getItem(`facet96:project-migration:v1:${id}`) || entries.some(entry => entry.record.id === id)) continue;
            record = { id, createdAt: old.savedAt, updatedAt: old.savedAt, revision: 1, document: projectSnapshot(old.document) };
          }
          entries.push({ key, raw, record });
        } catch { unreadableCount++; }
      }
      const counts = await transaction('readwrite', async (projects, meta) => {
        let imported = 0, copies = 0;
        for (const entry of entries) {
          const previous = await resultOf(meta.get(entry.key));
          if (previous?.raw === entry.raw) continue;
          let record = entry.record;
          if (previous || await resultOf(projects.get(record.id))) {
            record = { ...record, id: crypto.randomUUID(), document: { ...record.document, name: `${record.document.name}（旧版更新副本）` } };
            copies++;
          }
          projects.add(encode(record));
          meta.put({ key: entry.key, raw: entry.raw, projectId: record.id });
          imported++;
        }
        if (hasLegacy) meta.put({ key: 'started', value: true });
        return { imported, copies };
      });
      if (counts.imported) onChange();
      return { ...counts, unreadableCount };
    },
    close,
  };
  return store;
}
