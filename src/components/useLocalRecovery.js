import { useState } from "react";
import { createLocalRecoveryStore } from "../domain/localRecovery.js";

/**
 * Read/delete surface for legacy per-tab backups. Automatic backup writes
 * were retired with the project store; this hook only lists old records so
 * the RecoveryDialog can restore or delete them.
 */
export function useLocalRecovery() {
  const [boot] = useState(() => {
    try {
      const store = createLocalRecoveryStore(window.localStorage);
      return { store, ...store.list(), error: "" };
    } catch {
      return { store: null, records: [], unreadableCount: 0, error: "浏览器无法读取本地备份，请导出 JSON 保存设计。" };
    }
  });
  const [listing, setListing] = useState(boot);

  const refresh = () => {
    try {
      if (!boot.store) throw new Error("Storage unavailable");
      setListing({ ...boot.store.list(), error: "" });
    } catch {
      setListing((current) => ({ ...current, error: "无法读取本地备份；现有备份未被修改。" }));
    }
  };
  const remove = (recordId) => {
    try { boot.store.remove(recordId); refresh(); }
    catch { setListing((current) => ({ ...current, error: "删除备份失败，原记录仍保留。" })); }
  };
  return { ...listing, refresh, remove };
}
