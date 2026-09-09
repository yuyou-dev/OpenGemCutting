import { RenderBoundary } from "./components/RenderBoundary.jsx";
import { useDismissFloatingMenus } from "./components/useDismissFloatingMenus.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { WorkbenchEditor } from "./WorkbenchEditor.jsx";
import { HomePage } from "./components/HomePage.jsx";
import { OpticalLabPage } from "./components/OpticalLabPage.jsx";
import { HelpCenterDialog } from "./components/HelpCenterDialog.jsx";
import { NewProjectDialog } from "./components/NewProjectDialog.jsx";
import { CrystalImportDialog } from "./components/CrystalImportDialog.jsx";
import { Modal } from "./components/Modal.jsx";
import { useProjects } from "./components/useProjects.js";
import { createWorkbenchDocument } from "./domain/document.js";
import { exportFacetingJSON } from "./domain/faceting.js";
import { downloadBlob } from "./utils/download.js";
import { safeFileStem } from "./utils/format.js";

export function App() {
  useDismissFloatingMenus();
  const projects = useProjects();
  const [page, setPage] = useState("home");
  const [active, setActive] = useState(null);
  const [latestDocument, setLatestDocument] = useState(null);
  const [hasPreview, setHasPreview] = useState(false);
  const [pendingSwitch, setPendingSwitch] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [crystalReturnToNew, setCrystalReturnToNew] = useState(false);
  const [crystalImportOpen, setCrystalImportOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState({ state: "idle", message: "已保存的切割会自动保存到本机项目" });
  const [confirmReload, setConfirmReload] = useState(false);
  const pendingSave = useRef(null);
  const savedDocument = useRef(null);
  const baseRevision = useRef(0);
  const conflictedRef = useRef(false);
  const saveTimer = useRef(null);
  const flushQueue = useRef(Promise.resolve(true));

  const doFlush = useCallback(async () => {
    const pending = pendingSave.current;
    if (!pending || pending.document === savedDocument.current) return true;
    if (conflictedRef.current) return false;
    const result = await projects.save(pending.id, pending.document, { expectedRevision: baseRevision.current });
    if (!result.ok) {
      if (result.code === "PROJECT_CONFLICT") {
        // Stop auto-overwriting: local design stays in memory until the user resolves.
        conflictedRef.current = true;
        setSaveStatus({ state: "conflict", message: result.message });
      } else {
        setSaveStatus({ state: "error", code: result.code, message: "项目尚未保存，请重试或导出 JSON。" });
      }
      return false;
    }
    savedDocument.current = pending.document;
    baseRevision.current = result.record.revision;
    if (pendingSave.current === pending) pendingSave.current = null;
    if (!pendingSave.current) setSaveStatus({ state: "saved", savedAt: Date.now(), message: "已保存到本机项目 · 不含未保存切割预览" });
    return true;
  }, [projects.save]);

  const flush = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    const run = flushQueue.current.then(doFlush);
    flushQueue.current = run.then(() => true, () => false);
    return run;
  }, [doFlush]);

  const receiveDocument = useCallback((document) => {
    setLatestDocument(document);
    if (!active || document === savedDocument.current) return;
    pendingSave.current = { id: active.id, document };
    // A conflicted project holds new edits locally until the user resolves it.
    if (conflictedRef.current) return;
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

  const editorSeq = useRef(0);
  const activate = (record, startWithDraft = false) => {
    pendingSave.current = null;
    savedDocument.current = record.document;
    baseRevision.current = record.revision ?? 0;
    conflictedRef.current = false;
    setLatestDocument(record.document);
    setHasPreview(false);
    setActive({ ...record, startWithDraft, mountSeq: (editorSeq.current += 1) });
    setSaveStatus({ state: "saved", savedAt: record.updatedAt, message: "已保存到本机项目 · 不含未保存切割预览" });
    setPage("editor");
  };
  const switchProject = async (action) => {
    if (!await flush()) return;
    if (hasPreview) setPendingSwitch({ action });
    else action();
  };
  const createProject = () => setNewProjectOpen(true);
  const createDefaultProject = () => {
    setNewProjectOpen(false);
    switchProject(() => {
    const record = projects.create(createWorkbenchDocument(`未命名切型 ${String(projects.records.length + 1).padStart(2, "0")}`));
    if (record) activate(record, true);
    });
  };
  const importCrystal = (document) => {
    setNewProjectOpen(false);
    setCrystalImportOpen(false);
    switchProject(() => {
      const record = projects.create(document);
      if (record) activate(record);
    });
  };
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
  const requestDeleteProject = (record) => setPendingDelete(record);
  const confirmDeleteProject = () => {
    const record = pendingDelete;
    setPendingDelete(null);
    if (!record) return;
    if (record.id === active?.id) {
      // Deleting the open project must not leave a pending save that could revive it.
      window.clearTimeout(saveTimer.current);
      pendingSave.current = null;
      savedDocument.current = null;
      conflictedRef.current = false;
      setActive(null);
      setLatestDocument(null);
      setHasPreview(false);
      setSaveStatus({ state: "idle", message: "已保存的切割会自动保存到本机项目" });
    }
    projects.remove(record.id);
  };
  const saveAsNewProject = (suffix = "（副本）") => {
    if (!latestDocument) return;
    const record = projects.create({ ...latestDocument, name: `${latestDocument.name}${suffix}` });
    if (record) activate(record);
  };
  const reloadLatestVersion = () => {
    if (!active) return;
    const record = projects.read(active.id);
    if (!record) {
      conflictedRef.current = false;
      setSaveStatus({ state: "error", code: "PROJECT_DELETED", message: "项目已被删除，请将当前设计另存为新项目或导出 JSON。" });
      return;
    }
    activate(record);
  };
  const requestReloadLatest = () => {
    if (pendingSave.current || hasPreview) setConfirmReload(true);
    else reloadLatestVersion();
  };
  const exportCurrent = () => {
    if (!latestDocument) return;
    downloadBlob(new Blob([exportFacetingJSON(latestDocument)], { type: "application/json" }), `${safeFileStem(latestDocument.name)}.json`);
  };
  const projectList = projects.records.map((record) => record.id === active?.id && latestDocument
    ? { ...record, document: latestDocument } : record);
  const projectError = projects.error || (projects.unreadableCount ? `${projects.unreadableCount} 份本地设计暂时无法读取，原记录仍保留。` : "");

  return (
    <>
      {page === "home" ? <HomePage projects={projectList} activeProjectId={active?.id} onOpenProject={openProject} onNewProject={createProject} onDeleteProject={requestDeleteProject} onOpenLab={() => navigate("lab")} onResume={() => setPage("editor")} error={projectError} onRetry={projects.refresh} onOpenHelp={() => setHelpOpen(true)} /> : null}
      {active ? <RenderBoundary key={`${active.id}:${active.mountSeq ?? 0}`} hidden={page !== "editor"} onRetry={() => { setHasPreview(false); setActive(current => ({ ...current, document: latestDocument ?? current.document, startWithDraft: false, mountSeq: ++editorSeq.current })); }} onExport={exportCurrent} onHome={() => navigate("home")}><WorkbenchEditor initialDocument={active.document} startWithDraft={active.startWithDraft} visible={page === "editor"} interactionPaused={Boolean(pendingSwitch) || confirmReload || helpOpen || crystalImportOpen || newProjectOpen} onDocumentChange={receiveDocument} onPreviewChange={setHasPreview} onHome={() => navigate("home")} onLab={() => navigate("lab")} onNewProject={createProject} onImportCrystal={() => { setCrystalReturnToNew(false); setCrystalImportOpen(true); }} projectStatus={saveStatus} /></RenderBoundary> : null}
      {page === "lab" ? <OpticalLabPage projectName={latestDocument?.name} hasProject={Boolean(active)} onHome={() => navigate("home")} onEditor={() => setPage("editor")} /> : null}
      {saveStatus.state === "error" ? <div className="project-save-error" role="alert"><div><strong>项目尚未保存</strong><p>{saveStatus.code === "PROJECT_DELETED" ? saveStatus.message : projects.error || saveStatus.message}</p></div><button onClick={flush}>重试保存</button>{saveStatus.code === "PROJECT_DELETED" ? <button onClick={() => saveAsNewProject()}>另存为新项目</button> : null}<button onClick={exportCurrent}>导出 JSON</button><button onClick={() => navigate("home")}>管理本地项目</button></div> : null}
      {saveStatus.state === "conflict" ? <div className="project-save-error" role="alert"><div><strong>该项目已在其他窗口被修改</strong><p>自动保存已暂停，本地未保存的设计仍保留在内存中。请选择如何处理，不会自动合并或覆盖。</p></div><button onClick={requestReloadLatest}>重新载入最新版本</button><button onClick={() => saveAsNewProject("（冲突副本）")}>另存为新项目</button><button onClick={exportCurrent}>导出 JSON</button></div> : null}
      {confirmReload ? <Modal title="重新载入最新保存版本" confirmLabel="放弃本地修改并载入" closeLabel="保留本地修改" destructive onClose={() => setConfirmReload(false)} onConfirm={() => { setConfirmReload(false); reloadLatestVersion(); }}><p>另一窗口保存的版本将替换当前编辑现场；本地未保存的切割与预览会被放弃。如需保留，可先取消并导出 JSON 或另存为新项目。</p></Modal> : null}
      {pendingSwitch ? <Modal title="切换项目前保留切割预览" confirmLabel="放弃预览并继续" closeLabel="保留当前预览" destructive onClose={() => setPendingSwitch(null)} onConfirm={() => { const { action } = pendingSwitch; setPendingSwitch(null); action(); }}><p>当前项目还有未保存的切割预览。切换项目会放弃这部分预览；已经保存的图层仍保留在原项目中。</p><p>如需继续调整，可保留预览并返回当前项目。</p></Modal> : null}
      {pendingDelete ? <Modal title="删除本地项目" confirmLabel="确认删除项目" closeLabel="保留项目" destructive onClose={() => setPendingDelete(null)} onConfirm={confirmDeleteProject}>
        <p>将从此浏览器删除“{pendingDelete.document.name}”，此操作不可撤销。其他窗口中打开的同一项目之后无法再保存。</p>
        {pendingDelete.id === active?.id
          ? <p>该项目正在编辑中：删除后当前未保存的切割与预览会一并放弃。如需保留，请先取消，回到编辑器从文件菜单导出 JSON。</p>
          : <p>如需留存，请先取消，打开项目后从文件菜单导出 JSON 备份。</p>}
      </Modal> : null}
      {newProjectOpen ? <NewProjectDialog onClose={() => setNewProjectOpen(false)} onDefault={createDefaultProject} onPreset={importCrystal} onUpload={() => { setNewProjectOpen(false); setCrystalReturnToNew(true); setCrystalImportOpen(true); }} /> : null}
      {crystalImportOpen ? <CrystalImportDialog onBack={crystalReturnToNew ? () => { setCrystalImportOpen(false); setNewProjectOpen(true); } : undefined} onClose={() => setCrystalImportOpen(false)} onImport={importCrystal} /> : null}
      {helpOpen ? <HelpCenterDialog onClose={() => setHelpOpen(false)} /> : null}
    </>
  );
}
