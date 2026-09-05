import { useEffect, useRef, useState } from "react";
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconCheck,
  IconChevronDown,
  IconCube,
  IconDiamond,
  IconDeviceFloppy,
  IconDots,
  IconEye,
  IconEyeOff,
  IconFilePlus,
  IconFileTypePdf,
  IconFileUpload,
  IconFolder,
  IconHelpCircle,
  IconHistory,
  IconLayoutGrid,
  IconSettings,
  IconTable,
  IconX,
} from "@tabler/icons-react";

function IconButton({ label, children, onClick, disabled = false }) {
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

const VIEWS = [
  ["perspective", "透视"],
  ["top", "顶视"],
  ["front", "正视"],
  ["side", "侧视"],
];

const OPTICS_VIEWS = [
  ["perspective", "透视"],
  ["top", "台面"],
  ["bottom", "亭部"],
  ["front", "正视"],
  ["side", "侧视"],
];

function runMenuAction(event, action) {
  action();
  event.currentTarget.closest("details")?.removeAttribute("open");
}

export function Header({
  viewMode,
  onViewMode,
  displayMode,
  onDisplayMode,
  onNew,
  onOpenPresets,
  onOpenRecovery,
  backupStatus,
  onImport,
  onImportAsc,
  onExport,
  onExportAsc,
  onExportPdf,
  onUndo,
  onRedo,
  onOpenHistory,
  onOpenLedger,
  onOpenSettings,
  onOpenHelp,
  onOpenAssistant,
  canUndo,
  canRedo,
  projectName,
  onProjectNameChange,
  facetCount,
  opticsActive = false,
  opticsInspectorOpen = true,
  onEnterOptics,
  onOpenOpticsInspector,
  onExitOptics,
}) {
  const activeView = (opticsActive ? OPTICS_VIEWS : VIEWS)
    .find(([value]) => value === viewMode)?.[1] ?? "透视";
  const isXray = displayMode === "xray";
  const projectNameInputRef = useRef(null);
  const cancelNameCommitRef = useRef(false);
  const [projectNameDraft, setProjectNameDraft] = useState(projectName);

  useEffect(() => {
    if (document.activeElement !== projectNameInputRef.current) {
      setProjectNameDraft(projectName);
    }
  }, [projectName]);

  const commitProjectName = () => {
    if (cancelNameCommitRef.current) {
      cancelNameCommitRef.current = false;
      return;
    }
    const nextName = projectNameDraft.trim();
    if (!nextName) {
      setProjectNameDraft(projectName);
      return;
    }
    setProjectNameDraft(nextName);
    if (nextName !== projectName) onProjectNameChange(nextName);
  };

  if (opticsActive) {
    return (
      <header className={`app-header floating-toolbar is-optics-toolbar${opticsInspectorOpen ? "" : " is-inspector-closed"}`} aria-label="光学仿真工具栏">
        <div className="optics-view-switch" role="group" aria-label={`光学观察视角，当前${activeView}`}>
          {OPTICS_VIEWS.map(([value, label]) => (
            <button
              type="button"
              className={viewMode === value ? "is-active" : ""}
              aria-pressed={viewMode === value}
              onClick={() => onViewMode(value)}
              key={value}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="toolbar-project-status is-readonly" title={`${projectName} · 已提交 ${facetCount} 个有效刻面`}>
          <strong>{projectName}</strong><small title="已提交文档的最终有效刻面，不含毛坯面与未保存预览">{facetCount} 有效面</small>
        </div>
        {!opticsInspectorOpen ? (
          <button type="button" className="optics-toolbar-button" onClick={onOpenOpticsInspector}>
            <IconDiamond size={15} stroke={1.7} /><span>光学参数</span>
          </button>
        ) : null}
        <button type="button" className="optics-exit-button" onClick={onExitOptics}>
          <IconX size={15} stroke={1.9} /><span>退出仿真</span>
        </button>
        <span className="optics-live-badge"><i />光学仿真 · 实时</span>
      </header>
    );
  }

  return (
    <header className="app-header floating-toolbar" aria-label="工作区工具栏">
      <details className="toolbar-menu toolbar-view-menu" name="toolbar-menu">
        <summary title={`切换视图 · ${activeView}`} aria-label={`切换视图，当前${activeView}`}>
          <IconCube size={16} stroke={1.7} />
          <IconChevronDown size={13} stroke={1.7} />
        </summary>
        <div className="toolbar-menu-popover" role="menu" aria-label="视图">
          <span className="toolbar-menu-label">VIEW 视图</span>
          {VIEWS.map(([value, label]) => (
            <button
              type="button"
              role="menuitem"
              className={viewMode === value ? "is-active" : ""}
              onClick={(event) => runMenuAction(event, () => onViewMode(value))}
              key={value}
            >
              <span>{label}</span>
              {viewMode === value ? <IconCheck size={14} stroke={1.8} /> : null}
            </button>
          ))}
        </div>
      </details>

      <div className="toolbar-project-status" title={`${projectName} · 已提交 ${facetCount} 个有效刻面`}>
        <input
          ref={projectNameInputRef}
          type="text"
          value={projectNameDraft}
          aria-label="切型名称"
          title="点击编辑切型名称；回车或失焦保存，Esc 取消"
          spellCheck="false"
          onChange={(event) => setProjectNameDraft(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          onBlur={commitProjectName}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.blur();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              cancelNameCommitRef.current = true;
              setProjectNameDraft(projectName);
              event.currentTarget.blur();
            }
          }}
        />
        <small title="已提交文档的最终有效刻面，不含毛坯面与未保存预览">{facetCount} 有效面</small>
      </div>

      <details className="toolbar-menu toolbar-display-menu" name="toolbar-menu">
        <summary className={isXray ? "is-xray" : ""} title="显示模式" aria-label="显示模式">
          {isXray ? <IconEye size={15} stroke={1.8} /> : <IconEyeOff size={15} stroke={1.8} />}
          <IconChevronDown size={12} stroke={1.7} />
        </summary>
        <div className="toolbar-menu-popover" role="menu" aria-label="显示模式">
          <span className="toolbar-menu-label">DISPLAY 显示</span>
          <button type="button" role="menuitem" className={!isXray ? "is-active" : ""} onClick={(event) => runMenuAction(event, () => onDisplayMode("solid"))}>
            <IconEyeOff size={15} /><span>实体</span>{!isXray ? <IconCheck size={14} /> : null}
          </button>
          <button type="button" role="menuitem" className={isXray ? "is-active" : ""} onClick={(event) => runMenuAction(event, () => onDisplayMode("xray"))}>
            <IconEye size={15} /><span>穿透 X-RAY</span>{isXray ? <IconCheck size={14} /> : null}
          </button>
          <button type="button" role="menuitem" className="is-optics-entry" onClick={(event) => runMenuAction(event, onEnterOptics)}>
            <IconDiamond size={15} /><span>光学仿真</span>
          </button>
        </div>
      </details>

      <details className="toolbar-menu toolbar-file-menu" name="toolbar-menu">
        <summary title="文件" aria-label="文件">
          <IconFolder size={16} stroke={1.7} />
          <IconChevronDown size={13} stroke={1.7} />
        </summary>
        <div className="toolbar-menu-popover is-right" role="menu" aria-label="文件">
          <span className="toolbar-menu-label">FILE 文件</span>
          <p className="toolbar-backup-status" role="status">{backupStatus?.message || "提交文档后自动备份；未保存草稿不备份"}{backupStatus?.savedAt ? ` · ${new Date(backupStatus.savedAt).toLocaleTimeString("zh-CN")}` : ""}</p>
          <button type="button" role="menuitem" onClick={(event) => runMenuAction(event, onOpenRecovery)}>
            <IconHistory size={15} /><span>恢复本地设计</span>
          </button>
          <button type="button" role="menuitem" onClick={(event) => runMenuAction(event, onNew)}>
            <IconFilePlus size={15} />
            <span>新建设计</span>
          </button>
          <button type="button" role="menuitem" className="is-preset-entry" onClick={(event) => runMenuAction(event, onOpenPresets)}>
            <IconLayoutGrid size={15} />
            <span>浏览预设琢型</span>
          </button>
          <button type="button" role="menuitem" onClick={(event) => runMenuAction(event, onImport)}>
            <IconFileUpload size={15} />
            <span>导入 JSON</span>
          </button>
          <button type="button" role="menuitem" onClick={(event) => runMenuAction(event, onImportAsc)}>
            <IconFileUpload size={15} />
            <span>导入 GemCad ASC</span>
          </button>
          <button type="button" role="menuitem" onClick={(event) => runMenuAction(event, onExport)}>
            <IconDeviceFloppy size={15} />
            <span>导出 JSON</span>
          </button>
          <button type="button" role="menuitem" onClick={(event) => runMenuAction(event, onExportAsc)}>
            <IconDeviceFloppy size={15} />
            <span>导出 GemCad ASC</span>
          </button>
          <button type="button" role="menuitem" onClick={(event) => runMenuAction(event, onExportPdf)}>
            <IconFileTypePdf size={15} />
            <span>导出 PDF 报告</span>
          </button>
        </div>
      </details>

      <div className="header-actions">
        <IconButton label="撤销" onClick={onUndo} disabled={!canUndo}>
          <IconArrowBackUp size={17} stroke={1.7} />
        </IconButton>
        <IconButton label="重做" onClick={onRedo} disabled={!canRedo}>
          <IconArrowForwardUp size={17} stroke={1.7} />
        </IconButton>
      </div>

      <details className="toolbar-menu toolbar-more-menu" name="toolbar-menu">
        <summary title="更多工具" aria-label="更多工具">
          <IconDots size={18} stroke={1.8} />
        </summary>
        <div className="toolbar-menu-popover is-right" role="menu" aria-label="更多工具">
          <span className="toolbar-menu-label">TOOLS 工具</span>
          <button type="button" role="menuitem" onClick={(event) => runMenuAction(event, onOpenHistory)}>
            <IconHistory size={15} />
            <span>历史记录</span>
          </button>
          <button type="button" role="menuitem" onClick={(event) => runMenuAction(event, onOpenLedger)}>
            <IconTable size={15} />
            <span>刻面表</span>
          </button>
          <button type="button" role="menuitem" onClick={(event) => runMenuAction(event, onOpenSettings)}>
            <IconSettings size={15} />
            <span>设置</span>
          </button>
          <button type="button" role="menuitem" onClick={(event) => runMenuAction(event, onOpenAssistant)}>
            <IconHistory size={15} />
            <span>逐层试切助理</span>
          </button>
          <button type="button" role="menuitem" onClick={(event) => runMenuAction(event, onOpenHelp)}>
            <IconHelpCircle size={15} />
            <span>帮助与操作手册</span>
          </button>
        </div>
      </details>
    </header>
  );
}
