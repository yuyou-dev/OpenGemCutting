import { t } from '../i18n/locale.js';
import { useState } from "react";
import { TechnicalPreview } from "./TechnicalPreview.jsx";
import "./orthographic-previews.css";

export function OrthographicPreviews({ solid, activeOperationId, previewOperationId, highlightOperationId }) {
  const [axialView, setAxialView] = useState("top");
  const shared = { solid, activeOperationId, previewOperationId, highlightOperationId };
  return (
    <section className="orthographic-previews" aria-label={t("实时正交预览")}>
      <div className="orthographic-preview-panel">
        <header>
          <div className="orthographic-view-switch" role="group" aria-label={t("垂直观察方向")}>
            <button type="button" aria-pressed={axialView === "top"} onClick={() => setAxialView("top")}>{t("冠部")}</button>
            <button type="button" aria-pressed={axialView === "bottom"} onClick={() => setAxialView("bottom")}>{t("亭部")}</button>
          </div>
          <span>{axialView === "top" ? t("顶视图") : t("底视图")}</span>
        </header>
        <TechnicalPreview {...shared} view={axialView} label={axialView === "top" ? t("冠部实时顶视图") : t("亭部实时底视图")} />
      </div>
      <div className="orthographic-preview-panel">
        <header><strong>{t("侧视图")}</strong><span>{t("正交预览")}</span></header>
        <TechnicalPreview {...shared} view="side" label={t("当前琢型实时侧视图")} />
      </div>
    </section>
  );
}
