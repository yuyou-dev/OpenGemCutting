import { useCallback, useEffect, useRef, useState } from "react";
import { WorkbenchEditor } from "./WorkbenchEditor.jsx";
import { HomePage } from "./components/HomePage.jsx";
import { OpticalLabPage } from "./components/OpticalLabPage.jsx";
import { HelpCenterDialog } from "./components/HelpCenterDialog.jsx";
import { Modal } from "./components/Modal.jsx";
import { useProjects } from "./components/useProjects.js";
import { createWorkbenchDocument } from "./domain/document.js";
import { exportFacetingJSON } from "./domain/faceting.js";
import { downloadBlob } from "./utils/download.js";

export function App() {
  const projects = useProjects();
  const [page, setPage] = useState("home");
  const [active, setActive] = useState(null);
  const [latestDocument, setLatestDocument] = useState(null);
  const [hasPreview, setHasPreview] = useState(false);
  const [pendingSwitch, setPendingSwitch] = useState(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState({ state: "idle", message: "已保存的切割会自动保存到本机项目" });
  const pendingSave = useRef(null);
  const savedDocument = useRef(null);
  const saveTimer = useRef(null);

  const flush = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    const pending = pendingSave.current;
    if (!pending || pending.document === savedDocument.current) return true;
    if (!projects.save(pending.id, pending.document)) {
      setSaveStatus({ state: "error", message: "项目尚未保存，请重试或导出 JSON。" });
      return false;
    }
    savedDocument.current = pending.document;
    pendingSave.current = null;
    setSaveStatus({ state: "saved", savedAt: Date.now(), message: "已保存到本机项目 · 不含未保存切割预览" });
    return true;
  }, [projects.save]);

  const receiveDocument = useCallback((document) => {
    setLatestDocument(document);
    if (!active || document === savedDocument.current) return;
    pendingSave.current = { id: active.id, document };
    setSaveStatus({ state: "saving", message: "正在保存已提交的切割…" });
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(flush, 300);
  }, [active, flush]);

  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(saveTimer.current);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [flush]);

  const activate = (record, startWithDraft = false) => {
    pendingSave.current = null;
    savedDocument.current = record.document;
    setLatestDocument(record.document);
    setHasPreview(false);
    setActive({ ...record, startWithDraft });
    setSaveStatus({ state: "saved", savedAt: record.updatedAt, message: "已保存到本机项目 · 不含未保存切割预览" });
    setPage("editor");
  };
  const switchProject = (action) => {
    if (!flush()) return;
    if (hasPreview) setPendingSwitch({ action });
    else action();
  };
  const createProject = () => switchProject(() => {
    const record = projects.create(createWorkbenchDocument(`未命名切型 ${String(projects.records.length + 1).padStart(2, "0")}`));
    if (record) activate(record, true);
  });
  const openProject = (id) => {
    if (id === active?.id) { setPage("editor"); return; }
    const record = projects.records.find((item) => item.id === id);
    if (record) switchProject(() => activate(record));
  };
  const navigate = (nextPage) => {
    flush();
    if (nextPage === "home") projects.refresh();
    setPage(nextPage);
  };
  const exportCurrent = () => {
    if (!latestDocument) return;
    downloadBlob(new Blob([exportFacetingJSON(latestDocument)], { type: "application/json" }), `${latestDocument.name.replace(/[^\p{L}\p{N}-]+/gu, "-") || "facet-96"}.json`);
  };
  const projectList = projects.records.map((record) => record.id === active?.id && latestDocument
    ? { ...record, document: latestDocument } : record);
  const projectError = projects.error || (projects.unreadableCount ? `${projects.unreadableCount} 份本地设计暂时无法读取，原记录仍保留。` : "");

  return (
    <>
      {page === "home" ? <HomePage projects={projectList} activeProjectId={active?.id} onOpenProject={openProject} onNewProject={createProject} onOpenLab={() => navigate("lab")} onResume={() => setPage("editor")} error={projectError} onRetry={projects.refresh} onOpenHelp={() => setHelpOpen(true)} /> : null}
      {active ? <WorkbenchEditor key={active.id} initialDocument={active.document} startWithDraft={active.startWithDraft} visible={page === "editor"} interactionPaused={Boolean(pendingSwitch) || helpOpen} onDocumentChange={receiveDocument} onPreviewChange={setHasPreview} onHome={() => navigate("home")} onLab={() => navigate("lab")} onNewProject={createProject} projectStatus={saveStatus} /> : null}
      {page === "lab" ? <OpticalLabPage projectName={latestDocument?.name} hasProject={Boolean(active)} onHome={() => navigate("home")} onEditor={() => setPage("editor")} /> : null}
      {saveStatus.state === "error" ? <div className="project-save-error" role="alert"><div><strong>项目尚未保存</strong><p>{projects.error || saveStatus.message}</p></div><button onClick={flush}>重试保存</button><button onClick={exportCurrent}>导出 JSON</button></div> : null}
      {pendingSwitch ? <Modal title="切换项目前保留切割预览" confirmLabel="放弃预览并继续" closeLabel="保留当前预览" destructive onClose={() => setPendingSwitch(null)} onConfirm={() => { const { action } = pendingSwitch; setPendingSwitch(null); action(); }}><p>当前项目还有未保存的切割预览。切换项目会放弃这部分预览；已经保存的图层仍保留在原项目中。</p><p>如需继续调整，可保留预览并返回当前项目。</p></Modal> : null}
      {helpOpen ? <HelpCenterDialog onClose={() => setHelpOpen(false)} /> : null}
    </>
  );
}
