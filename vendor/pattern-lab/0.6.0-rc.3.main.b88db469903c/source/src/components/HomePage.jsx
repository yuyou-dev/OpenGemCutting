import brandLogo from '../assets/logo-header.webp';
import { memo, useEffect, useMemo, useState } from 'react';
import {
  listProjects,
  projectPreview,
  renameProject,
  duplicateProject,
  deleteProject,
  migrateLegacyProject,
} from '../state/projectLibrary.js';
import { PLAN_COLORS } from '../ui/planView.js';
import { Button, Icon, IconButton } from './controls.jsx';
import { Modal } from './dialogs/Modal.jsx';
import { NewProjectDialog } from './NewProjectDialog.jsx';

function formatUpdated(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const ProjectCard = memo(function ProjectCard({ project, onOpen, onAction }) {
  const preview = useMemo(() => projectPreview(project.id), [project.id, project.updatedAt]);
  return (
    <div className="project-card">
      <button type="button" className="project-card-open" onClick={() => onOpen(project.id)} aria-label={`打开工程 ${project.name}`}>
        <div className="project-card-preview">
          {preview.ok ? (
            <svg viewBox={`0 0 ${preview.viewBox} ${preview.viewBox}`} role="img" aria-label={`${project.name} 俯视预览`}>
              {preview.polygons.map((poly, i) => (
                <polygon
                  key={i}
                  points={poly.map((pt) => `${pt[0].toFixed(2)},${pt[1].toFixed(2)}`).join(' ')}
                  fill={PLAN_COLORS.faceFill}
                  stroke={PLAN_COLORS.faceStroke}
                  strokeWidth="0.8"
                />
              ))}
            </svg>
          ) : (
            <span className="project-card-fallback">预览不可用，工程仍可打开</span>
          )}
        </div>
        <div className="project-card-caption">
          <strong title={project.name}>{project.name}</strong>
          <span className="project-card-meta">
            {project.teeth ? `${project.teeth} 齿` : '—'}{project.sizeMm ? ` · ${project.sizeMm} mm` : ''}
          </span>
          <span className="project-card-meta">更新于 <time dateTime={project.updatedAt}>{formatUpdated(project.updatedAt)}</time></span>
        </div>
      </button>
      <div className="project-card-actions">
        <IconButton icon="edit" label={`重命名 ${project.name}`} onClick={() => onAction('rename', project)} />
        <IconButton icon="copy" label={`复制 ${project.name}`} onClick={() => onAction('duplicate', project)} />
        <IconButton icon="trash" label={`删除 ${project.name}`} onClick={() => onAction('delete', project)} />
      </div>
    </div>
  );
});

function CreateCard({ onClick }) {
  return (
    <button type="button" className="home-create-card" onClick={onClick}>
      <span className="home-create-icon"><Icon name="plus" size={26} /></span>
      <strong>新建工程</strong>
      <span>对称模板 · 琢型库 · 本地 JSON</span>
    </button>
  );
}

function RenameDialog({ project, onClose, onDone }) {
  const [name, setName] = useState(project.name);
  const clean = name.trim();
  function submit() {
    if (!clean) return;
    renameProject(undefined, project.id, clean);
    onDone();
    onClose();
  }
  return (
    <Modal controller={{ closeModal: onClose }} title="重命名工程" subtitle={project.name}
      footer={<>
        <Button onClick={onClose} label="取消" className="subtle" />
        <Button onClick={submit} label="重命名" className="primary" disabled={!clean} />
      </>}>
      <label className="select-field">
        <span>工程名称</span>
        <input type="text" value={name} maxLength={80} autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
      </label>
    </Modal>
  );
}

function DeleteDialog({ project, onClose, onDone }) {
  return (
    <Modal controller={{ closeModal: onClose }} title="删除工程" subtitle={project.name}
      footer={<>
        <Button onClick={onClose} label="取消" className="subtle" />
        <Button onClick={() => { deleteProject(undefined, project.id); onDone(); onClose(); }} label="删除" className="danger" />
      </>}>
      <p>「{project.name}」将从本机浏览器中移除，此操作不可撤销。已导出的 JSON 文件不受影响。</p>
    </Modal>
  );
}

export function HomePage({ onOpen, onCreated }) {
  const [projects, setProjects] = useState([]);
  const [dialog, setDialog] = useState(null); // {kind:'new'} | {kind:'rename'|'delete', project}
  const openCreated = onCreated ?? onOpen;

  const refresh = () => setProjects(listProjects());
  useEffect(() => {
    migrateLegacyProject();
    refresh();
  }, []);

  function onCardAction(kind, project) {
    if (kind === 'duplicate') {
      duplicateProject(undefined, project.id);
      refresh();
    } else {
      setDialog({ kind, project });
    }
  }

  return (
    <main className="home">
      <header className="home-topbar">
        <span className="brand">
          <span className="brand-mark"><img src={brandLogo} alt="" width={30} height={30} /></span>
          <span className="brand-text">
            <span className="brand-title"><strong>图案实验室</strong><em>Alpha</em></span>
            <small>SUVA · FACET 96 专业版</small>
          </span>
        </span>
        <span className="home-count">本机工程 <b>{projects.length}</b></span>
      </header>

      <section className="home-intro" aria-labelledby="home-title">
        <img className="home-brand-logo" src={brandLogo} alt="苏哇品牌标志" />
        <h1 id="home-title">图案实验室</h1>
        <p>每个工程是一份独立的琢型设计，自动保存在本机。</p>
      </section>

      <section className="home-projects" aria-labelledby="home-projects-title">
        <div className="home-projects-label"><h2 id="home-projects-title">我的工程</h2><span>{projects.length}</span></div>
        {projects.length === 0 ? (
          <div className="home-empty">
            <CreateCard onClick={() => setDialog({ kind: 'new' })} />
            <h3>还没有工程</h3>
            <p>从对称模板、Facet 96 琢型库或本地 JSON 计划开始第一份设计。</p>
          </div>
        ) : (
          <div className="home-project-grid">
            <CreateCard onClick={() => setDialog({ kind: 'new' })} />
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} onOpen={onOpen} onAction={onCardAction} />
            ))}
          </div>
        )}
        <p className="home-storage-note">工程保存在此浏览器；重要设计请在编辑器内「文件 → 下载计划 JSON」留存。</p>
      </section>

      {dialog?.kind === 'new' ? (
        <NewProjectDialog onClose={() => setDialog(null)} onCreated={(id) => { setDialog(null); openCreated(id); }} />
      ) : dialog?.kind === 'rename' ? (
        <RenameDialog project={dialog.project} onClose={() => setDialog(null)} onDone={refresh} />
      ) : dialog?.kind === 'delete' ? (
        <DeleteDialog project={dialog.project} onClose={() => setDialog(null)} onDone={refresh} />
      ) : null}
    </main>
  );
}
