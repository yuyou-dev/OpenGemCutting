import { t } from '../i18n/locale.js';
import { LanguageSelector } from './LanguageSelector.jsx';
import { APP_VERSION } from "../version.js";
import { IconArrowLeft, IconHome } from "@tabler/icons-react";
import { RepositoryLink } from "./RepositoryLink.jsx";
import "./workspace-pages.css";

export function OpticalLabPage({ projectName, hasProject, onHome, onEditor }) {
  return (
    <main className="workspace-lab">
      <header className="lab-topbar">
        <button type="button" className="workspace-page-brand" onClick={onHome} aria-label={t("返回主页")}>
          <img src={`${import.meta.env.BASE_URL}brand/logo-header.webp`} alt="" />
          <span><strong>{t("切磨工作台")} <small>{APP_VERSION}</small></strong><em>SUVA · FACET 96</em></span>
        </button>
        <LanguageSelector /><RepositoryLink />
        <nav className="lab-navigation" aria-label={t("工作区导航")}>
          <button type="button" className="workspace-page-button" onClick={onHome}><IconHome size={16} stroke={1.6} />{t("主页")}</button>
          {hasProject && <button type="button" className="workspace-page-button" onClick={onEditor}><IconArrowLeft size={16} stroke={1.6} />{t("返回编辑")}</button>}
        </nav>
      </header>
      <div className="lab-layout">
        <aside className="lab-side-panel" aria-hidden="true" />
        <section className="lab-empty-stage" aria-labelledby="lab-title">
          <div className="lab-project-context"><span>{t("当前设计")}</span><strong>{t(hasProject ? projectName : t("尚未选择项目"))}</strong></div>
          <div className="lab-empty-copy"><span className="lab-eyebrow">OPTICAL LAB</span><h1 id="lab-title">{t("光学实验室")}</h1><p>{t("实验工具准备中")}</p></div>
        </section>
        <aside className="lab-side-panel" aria-hidden="true" />
      </div>
    </main>
  );
}
