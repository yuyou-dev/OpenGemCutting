import { useState } from "react";
import { TechnicalPreview } from "./TechnicalPreview.jsx";
import "./orthographic-previews.css";

export function OrthographicPreviews({ solid, activeOperationId, previewOperationId, highlightOperationId }) {
  const [axialView, setAxialView] = useState("top");
  const shared = { solid, activeOperationId, previewOperationId, highlightOperationId };
  return (
    <section className="orthographic-previews" aria-label="实时正交预览">
      <div className="orthographic-preview-panel">
        <header>
          <div className="orthographic-view-switch" role="group" aria-label="垂直观察方向">
            <button type="button" aria-pressed={axialView === "top"} onClick={() => setAxialView("top")}>冠部</button>
            <button type="button" aria-pressed={axialView === "bottom"} onClick={() => setAxialView("bottom")}>亭部</button>
          </div>
          <span>{axialView === "top" ? "顶视图" : "底视图"}</span>
        </header>
        <TechnicalPreview {...shared} view={axialView} label={axialView === "top" ? "冠部实时顶视图" : "亭部实时底视图"} />
      </div>
      <div className="orthographic-preview-panel">
        <header><strong>侧视图</strong><span>正交预览</span></header>
        <TechnicalPreview {...shared} view="side" label="当前琢型实时侧视图" />
      </div>
    </section>
  );
}
