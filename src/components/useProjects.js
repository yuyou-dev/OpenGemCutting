import { useCallback, useEffect, useRef, useState } from "react";
import { createProjectStore } from "../domain/projectLibrary.js";

export function useProjects() {
  const storeRef = useRef(null);
  const [listing, setListing] = useState({ records: [], unreadableCount: 0, error: "" });
  const getStore = useCallback(() => {
    storeRef.current ??= createProjectStore(window.localStorage);
    return storeRef.current;
  }, []);

  const refresh = useCallback(() => {
    try {
      const store = getStore();
      let legacyUnreadable = 0;
      let error = "";
      try { legacyUnreadable = store.migrateLegacy().unreadableCount; }
      catch { error = "旧设计迁移未完成，请重试；原有本地备份仍保留。"; }
      const next = store.list();
      setListing({ ...next, unreadableCount: next.unreadableCount + legacyUnreadable, error });
      return !error;
    } catch {
      setListing((current) => ({ ...current, error: "无法读取或迁移本地项目，请重试；原有设计仍保留在浏览器中。" }));
      return false;
    }
  }, [getStore]);

  useEffect(() => {
    refresh();
    const onStorage = (event) => {
      if (event.key === null || event.key.startsWith("facet96:")) refresh();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [refresh]);

  const acceptRecord = (record) => setListing((current) => ({
    ...current,
    error: "",
    records: [record, ...current.records.filter((item) => item.id !== record.id)]
      .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)),
  }));
  const create = useCallback((document) => {
    try {
      const record = getStore().create(document);
      acceptRecord(record);
      return record;
    } catch {
      setListing((current) => ({ ...current, error: "创建项目失败：空间不足或存储不可用，请重试或导出 JSON。" }));
      return null;
    }
  }, [getStore]);
  const save = useCallback((id, document) => {
    try {
      const record = getStore().save(id, document);
      acceptRecord(record);
      return true;
    } catch (error) {
      setListing((current) => ({ ...current, error: error.message.includes("已被删除")
        ? error.message : "项目保存失败：空间不足或存储不可用，请重试或导出 JSON。" }));
      return false;
    }
  }, [getStore]);
  const remove = useCallback((id) => {
    try {
      getStore().remove(id);
      setListing((current) => ({ ...current, records: current.records.filter((record) => record.id !== id), error: "" }));
      return true;
    } catch {
      setListing((current) => ({ ...current, error: "删除项目失败，原记录仍保留。" }));
      return false;
    }
  }, [getStore]);
  return { ...listing, create, save, refresh, remove };
}
