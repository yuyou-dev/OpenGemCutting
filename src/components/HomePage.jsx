import { memo, useMemo, useState } from "react";
import { IconArrowRight, IconDots, IconFlask, IconPlus, IconSearch, IconX } from "@tabler/icons-react";
import { buildConstructionStages } from "../domain/constructionHistory.js";
import { createCenteredCube } from "../domain/geometry.js";
import { RepositoryLink } from "./RepositoryLink.jsx";
import { TechnicalPreview } from "./TechnicalPreview.jsx";
import "./workspace-pages.css";

const dateFormat = new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

const ProjectCard = memo(function ProjectCard({ project, active, onOpen }) {
  const solid = useMemo(() => buildConstructionStages(project.document).at(-1)?.afterSolid
    ?? createCenteredCube(project.document.stock.size, { center: project.document.stock.center }), [project.document]);
  return (
    <button type="button" className={`project-card${active ? " is-current" : ""}`} onClick={() => onOpen(project.id)} aria-label={`打开项目 ${project.document.name}`}>
      <div className="project-card-drawing">
        <TechnicalPreview solid={solid} view="isometric" className="project-card-preview" label={`${project.document.name}的轴测预览`} />
        <span className="project-card-view">45° / AXON</span>
        {active && <span className="project-card-current">当前项目</span>}
      </div>
      <div className="project-card-caption">
        <strong title={project.document.name}>{project.document.name}</strong>
        <IconArrowRight size={16} stroke={1.6} aria-hidden="true" />
        <span>更新于 <time dateTime={new Date(project.updatedAt).toISOString()}>{dateFormat.format(new Date(project.updatedAt))}</time></span>
      </div>
    </button>
  );
});

export function HomePage({ projects, activeProjectId, onOpenProject, onNewProject, onOpenLab, onResume, error, onRetry, onOpenHelp }) {
  const [query, setQuery] = useState("");
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matchingProjects = projects.filter((project) => words.every((word) => project.document.name.toLocaleLowerCase().includes(word)));
  const activeProject = projects.find((project) => project.id === activeProjectId);
  return (
    <main className="workspace-home">
      <header className="home-topbar">
        <span className="workspace-product-mark">SUVA <span>／</span> FACET 96</span>
        <div className="home-topbar-actions">
          <span className="home-local-label">此浏览器的项目 <b>{projects.length}</b></span>
          <RepositoryLink />
          <details className="workspace-page-tools">
            <summary aria-label="更多工具"><IconDots size={18} stroke={1.6} /></summary>
            <div className="workspace-page-tools-menu"><button type="button" onClick={(event) => { event.currentTarget.closest("details").open = false; onOpenHelp(); }}>帮助中心</button></div>
          </details>
        </div>
      </header>

      <section className="home-introduction" aria-labelledby="home-title">
        <img className="home-brand-logo" src={`${import.meta.env.BASE_URL}brand/logo-header.webp`} alt="苏哇品牌标志" />
        <div className="home-title-line"><h1 id="home-title">切磨工作台</h1><span>Alpha</span></div>
        <p>从一个切型，开始下一次设计。</p>
        <div className="home-search">
          <IconSearch size={19} stroke={1.5} aria-hidden="true" />
          <input type="search" aria-label="搜索项目" placeholder="搜索项目名称" value={query} onChange={(event) => setQuery(event.target.value)} />
          {query && <button type="button" aria-label="清除项目搜索" onClick={() => setQuery("")}><IconX size={16} stroke={1.6} /></button>}
        </div>
      </section>

      <section className="home-projects" aria-labelledby="home-projects-title">
        <div className="home-projects-heading">
          <div className="home-projects-label"><h2 id="home-projects-title">我的项目</h2><span>{words.length ? `${matchingProjects.length} / ${projects.length}` : projects.length}</span></div>
          <div className="home-projects-actions">
            <button type="button" className="workspace-page-button" onClick={onOpenLab}><IconFlask size={16} stroke={1.6} />光学实验室</button>
            {activeProject && <button type="button" className="workspace-page-button home-resume" onClick={onResume}>继续当前设计<IconArrowRight size={15} stroke={1.6} /></button>}
            <button type="button" className="workspace-page-button is-create" onClick={onNewProject}><IconPlus size={17} stroke={1.8} />新建项目</button>
          </div>
        </div>
        {error && <div className="workspace-page-error" role="alert"><span>{error}</span><button type="button" onClick={onRetry}>重试</button></div>}
        {projects.length === 0 ? (
          <div className="home-empty">
            <span className="home-empty-index" aria-hidden="true">01</span>
            <h3>开始你的第一个切型</h3>
            <p>新建项目进入工作台，或在工作台的文件菜单中导入已有设计。</p>
            <button type="button" className="workspace-page-button is-create" onClick={onNewProject}><IconPlus size={17} />新建项目</button>
          </div>
        ) : matchingProjects.length === 0 ? (
          <div className="home-empty home-search-empty"><h3>没有找到匹配的项目</h3><p>试试其他名称，或清除搜索查看全部项目。</p><button type="button" className="workspace-page-button" onClick={() => setQuery("")}>清除搜索</button></div>
        ) : (
          <div className="home-project-grid">{matchingProjects.map((project) => <ProjectCard key={project.id} project={project} active={project.id === activeProjectId} onOpen={onOpenProject} />)}</div>
        )}
        <p className="home-storage-note">项目保存在此浏览器。重要设计请在文件菜单中导出 JSON 留存。</p>
      </section>
    </main>
  );
}
