import { useCallback, useEffect, useRef, useState } from "react";
import { createLocalRecoveryStore } from "../domain/localRecovery.js";

export function useLocalRecovery(document, enabled) {
  const [boot] = useState(() => {
    try {
      const store = createLocalRecoveryStore(window.localStorage);
      return { store, ...store.list(), error: "" };
    } catch {
      return { store: null, records: [], unreadableCount: 0, error: "浏览器无法读取本地备份，请导出 JSON 保存设计。" };
    }
  });
  // A new page always owns a new record, including duplicate-tab and restore flows.
  const [id] = useState(() => crypto.randomUUID());
  const [listing, setListing] = useState(boot);
  const [status, setStatus] = useState({ state: boot.error ? "error" : "idle", message: boot.error });
  const pendingRef = useRef(null);
  const savedDocumentRef = useRef(null);
  pendingRef.current = enabled ? document : null;

  const flush = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending || pending === savedDocumentRef.current) return;
    try {
      if (!boot.store) throw new Error("Storage unavailable");
      const savedAt = boot.store.save(id, pending);
      savedDocumentRef.current = pending;
      setStatus({ state: "saved", savedAt, message: "已自动备份已提交文档与材质" });
    } catch {
      setStatus({ state: "error", message: "本地备份失败：空间不足或存储不可用，请导出 JSON。" });
    }
  }, [boot.store, id]);

  useEffect(() => {
    if (!enabled) return undefined;
    setStatus({ state: "saving", message: "正在备份已提交文档…" });
    const timer = window.setTimeout(flush, 300);
    return () => window.clearTimeout(timer);
  }, [document, enabled, flush]);

  useEffect(() => {
    const onVisibility = () => { if (window.document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    window.document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [flush]);

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
  return { ...listing, status, refresh, remove, retry: flush };
}
