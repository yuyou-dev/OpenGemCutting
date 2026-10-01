import { useCallback, useEffect, useRef, useState } from "react";
import { createProjectDatabase } from "../application/projectDatabase.js";

import { loadStarterProjects } from "../application/starterProjects.js";

export function useProjects(library) {
  const refreshRef = useRef(null);
  const storeRef = useRef(null), channel = useRef(null), refreshAgain = useRef(false);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState("");
  const [listing, setListing] = useState({ records: [], unreadableCount: 0, error: "" });
  const getStore = useCallback(() => {
    storeRef.current ??= createProjectDatabase({ indexedDB: window.indexedDB, legacyStorage: window.localStorage, onChange: () => channel.current?.postMessage({ changed: true }) });
    return storeRef.current;
  }, []);

  const refresh = useCallback(() => {
    if (refreshRef.current) { refreshAgain.current = true; return refreshRef.current; }
    refreshRef.current = (async () => {
      do {
        refreshAgain.current = false;
        try {
          const store = getStore();
          let legacyUnreadable = 0;
          let error = "";
          try {
            const migration = await store.migrateLegacy();
            legacyUnreadable = migration.unreadableCount;
            if (migration.imported) setNotice(migration.copies ? "已保留旧版更新副本，请在项目列表核对；当前项目未被覆盖。" : "旧项目已升级，原记录仍保留。新版修改请导出 JSON 后再交给旧版工作台。");
          }
          catch { error = "旧设计迁移未完成，请重试；原有本地备份仍保留。"; }
          if (!error && !legacyUnreadable && await store.needsStarterProjects()) {
            try { await store.seedStarterProjects(await loadStarterProjects(library)); }
            catch { error = "初始切型项目准备失败，请重试；仍可新建自己的项目。"; }
          }
          const next = await store.list();
          setListing({ ...next, unreadableCount: next.unreadableCount + legacyUnreadable, error });
          if (!refreshAgain.current) return !error;
        } catch {
          setListing((current) => ({ ...current, error: "无法读取或迁移本地项目，请重试；原有设计仍保留在浏览器中。" }));
          return false;
        }
      } while (refreshAgain.current);
    })().finally(() => { refreshRef.current = null; });
    return refreshRef.current;
  }, [getStore, library]);

  useEffect(() => {
    if (typeof BroadcastChannel !== 'undefined') {
      channel.current = new BroadcastChannel('facet96:projects');
      channel.current.onmessage = () => refresh();
    }
    refresh();
    const onStorage = (event) => {
      if (event.key === null || event.key.startsWith("facet96:")) refresh();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", refresh);
    return () => { window.removeEventListener("storage", onStorage); window.removeEventListener("focus", refresh); channel.current?.close(); channel.current = null; };
  }, [refresh]);

  const acceptRecord = (record) => setListing((current) => ({
    ...current,
    error: "",
    records: [record, ...current.records.filter((item) => item.id !== record.id)]
      .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)),
  }));
  const create = useCallback(async (document, options) => {
    setCreating(true);
    try {
      const record = await getStore().create(document, options);
      acceptRecord(record);
      return record;
    } catch (error) {
      if (error.name === "AbortError") return null;
      if (error.code === "STALE_REVISION" || error.code === "REQUEST_EXPIRED") throw error;
      setListing((current) => ({ ...current, error: "创建项目失败：空间不足或存储不可用，请重试或导出 JSON。" }));
      return null;
    } finally { setCreating(false); }
  }, [getStore]);
  const save = useCallback(async (id, document, { expectedRevision } = {}) => {
    try {
      const record = await getStore().save(id, document, { expectedRevision });
      acceptRecord(record);
      return { ok: true, record };
    } catch (error) {
      const known = error.code === "PROJECT_CONFLICT" || error.code === "PROJECT_DELETED";
      setListing((current) => ({ ...current, error: known
        ? error.message : "项目保存失败：空间不足或存储不可用，请重试或导出 JSON。" }));
      return { ok: false, code: error.code ?? "PROJECT_SAVE_FAILED", message: error.message };
    }
  }, [getStore]);
  const read = useCallback((id) => getStore().read(id), [getStore]);
  const remove = useCallback(async (id) => {
    try {
      await getStore().remove(id);
      setListing((current) => ({ ...current, records: current.records.filter((record) => record.id !== id), error: "" }));
      return true;
    } catch {
      setListing((current) => ({ ...current, error: "删除项目失败，原记录仍保留。" }));
      return false;
    }
  }, [getStore]);
  const recordsRef = useRef(listing.records); recordsRef.current = listing.records;
  const peek = useCallback(id => recordsRef.current.find(record => record.id === id) ?? null, []);
  return { ...listing, notice, creating, create, save, read, peek, refresh, remove };
}
