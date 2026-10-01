import { createLocalDatabase, resultOf } from './localDatabase.js';
import { validateLabDraftRecord } from '../domain/labDrafts.js';

export const LAB_DATABASE = 'facet96-experiments';
const PREFIX = 'facet96:experiment:v1:';
const copy = value => structuredClone(value);
const fail = (code, message) => Object.assign(new Error(message), { code });
function decode(stored) {
  if (!stored) return null;
  const record = validateLabDraftRecord(JSON.parse(stored.raw));
  if (record.id !== stored.id) throw fail('DRAFT_FORMAT', '实验稿格式无法读取，原记录仍保留。请下载恢复文件。');
  return record;
}
const encode = record => ({ id: record.id, raw: JSON.stringify(record) });

/** Opaque laboratory payloads remain independent of editable projects. Legacy
 * bytes are import-only; every live revision check and write is one transaction. */
export function createLabDatabase({ indexedDB, legacyStorage, name = LAB_DATABASE, onChange = () => {} }) {
  const { transaction, close } = createLocalDatabase({ indexedDB, name, recordsName: 'drafts' });
  return {
    close,
    async read(id) { return decode(await transaction('readonly', drafts => resultOf(drafts.get(id)))); },
    async raw(id) { return (await transaction('readonly', drafts => resultOf(drafts.get(id))))?.raw ?? null; },
    async list() {
      const stored = await transaction('readonly', drafts => resultOf(drafts.getAll()));
      const records = [], unreadable = [];
      for (const entry of stored) { try { records.push(decode(entry)); } catch { unreadable.push(entry); } }
      return { records: records.sort((a,b) => b.updatedAt-a.updatedAt), unreadable };
    },
    async create({ labId, moduleVersion, contractVersion, source = null, newDesign = null, draft = null, recoveredFrom = null }, { id = crypto.randomUUID(), now = Date.now(), ...options } = {}) {
      if (Boolean(source) === Boolean(newDesign)) throw fail('DRAFT_SOURCE', '请选择来源设计或新建实验。');
      const record = validateLabDraftRecord({ schemaVersion: 1, id, revision: 1, labId, moduleVersion, contractVersion,
        createdAt: now, updatedAt: now, source: copy(source), newDesign: copy(newDesign), draft: copy(draft), recoveredFrom, candidate: null, returns: [] });
      await transaction('readwrite', async drafts => {
        if (await resultOf(drafts.get(id))) throw fail('DRAFT_EXISTS', '实验稿已存在。');
        drafts.add(encode(record));
      }, options);
      onChange(); return copy(record);
    },
    async change(id, update, { expectedRevision, ...options } = {}) {
      const next = await transaction('readwrite', async drafts => {
        const current = decode(await resultOf(drafts.get(id)));
        if (!current) throw fail('DRAFT_MISSING', '实验稿记录已不存在，当前恢复数据仍可下载。');
        if (current.revision !== expectedRevision) throw fail('DRAFT_CONFLICT', '实验稿已在另一个窗口更新。当前改动保留在内存，请下载恢复文件后另存恢复。');
        const record = validateLabDraftRecord({ ...current, ...update(copy(current)), id, revision: current.revision+1, updatedAt: Date.now() });
        drafts.put(encode(record)); return record;
      }, options);
      onChange(); return copy(next);
    },
    async migrateLegacy() {
      const entries = [], unreadable = [];
      for (let i=0;i<legacyStorage.length;i++) {
        const key=legacyStorage.key(i); if (!key?.startsWith(PREFIX)) continue;
        const stored={id:key.slice(PREFIX.length),raw:legacyStorage.getItem(key)};
        try { entries.push({key,stored,record:decode(stored)}); } catch { unreadable.push(stored); }
      }
      const counts=await transaction('readwrite',async(drafts,meta)=>{
        let imported=0,copies=0;
        for(const {key,stored,record} of entries){
          const receipt=await resultOf(meta.get(key));if(receipt?.raw===stored.raw)continue;
          let target=record;
          if(receipt || await resultOf(drafts.get(record.id))){
            // A changed old-version record becomes an independent branch. Keep
            // source, draft, candidate, receipts and version backups intact.
            target={...record,id:crypto.randomUUID(),legacyCopy:true,recoveredFrom:record.id};copies++;
          }
          drafts.add(encode(target));meta.put({key,raw:stored.raw,recordId:target.id});imported++;
        }
        return {imported,copies};
      });
      if(counts.imported)onChange();return {...counts,unreadable};
    },
  };
}
