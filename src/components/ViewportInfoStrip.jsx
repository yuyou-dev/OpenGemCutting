import { IconChevronDown, IconChevronUp } from "@tabler/icons-react";
import { t } from "../i18n/locale.js";
import { FACET_REGION_LABELS, displayIndex } from "../domain/faceting.js";
import { TechnicalPreview } from "./TechnicalPreview.jsx";
import { CutInstructions } from "./CutInstructions.jsx";
import { ToolSketch } from "./ToolSketch.jsx";
import { RingCutSketch } from "./RingCutSketch.jsx";
import "./cut-column.css";

const TABS = [["ortho", "正交预览"], ["instructions", "切割指令"], ["tool", "刀具报告"]];
const VIEWS = [["top", "冠部", "TOP", "冠部实时顶视图"], ["bottom", "亭部", "BOTTOM", "亭部实时底视图"], ["side", "侧面", "PROFILE", "当前琢型实时侧视图"]];
const pad = (index, teeth) => String(displayIndex(index, teeth)).padStart(2, "0");

function ToolReport({ sessionActive, region, indexTeeth, tool, hood, ring, report, levels, missingIds }) {
  if (!sessionActive) return <p className="info-strip-empty">{t("当前没有进行中的切割。新建或编辑图层并选择复合刀具后，这里显示刀具顶视、加工分组与提示。")}</p>;
  if (!tool) return <p className="info-strip-empty">{t("当前为普通切：一组行业角、深度与分度，参数在左侧操作栏。选择复合刀具后，这里显示刀具顶视与逐级加工分组。")}</p>;
  return (
    <div className="info-strip-tool">
      <figure className="info-strip-tool-sketch">
        {hood ? <ToolSketch hood={hood} size={112} missingIds={missingIds} title={t("{0}顶视示意", [t(tool.label)])} />
          : ring ? <RingCutSketch ring={ring} indexTeeth={indexTeeth} />
            : <span className="info-strip-tool-nohood">{t("刀具尚未成形")}</span>}
        <figcaption>{t(hood ? "顶视 · 空心为未成刻面" : "顶视 · 取整后的环切外形")}</figcaption>
      </figure>
      <div className="info-strip-tool-copy">
        <strong>{t(tool.label)} <small>{t(FACET_REGION_LABELS[region])}</small></strong>
        {report ? <span className="info-strip-tool-total">{t("{0} 面 · {1} 组角度与深度 · {2} 次对称", [report.facets, report.levels, report.order])}</span> : null}
        {report?.warnings.map((warning) => <span key={warning} className="is-warning">{t(warning)}</span>)}
        {report?.notes.map((note) => <span key={note}>{t(note)}</span>)}
      </div>
      <div className="info-strip-levels" role="table" aria-label={t("加工分组")}>
        <div className="info-strip-level is-head" role="row"><span role="columnheader">{t("组")}</span><span role="columnheader">{t("角度")}</span><span role="columnheader">{t("深度")}</span><span role="columnheader">{t("分度")}</span><span role="columnheader">{t("有效")}</span></div>
        {levels.map((level) => (
          <div className="info-strip-level" role="row" key={level.key}>
            <span role="cell"><i className={`info-strip-swatch is-level-${level.order % 8}`} aria-hidden="true" />{level.letter}</span>
            <span role="cell">{level.angle.toFixed(2)}°</span>
            <span role="cell">{level.depth.toFixed(3)}</span>
            <span role="cell" className="info-strip-level-indices">
              {level.indices.map(({ index, effective }, order) => <em key={`${index}-${order}`} className={effective ? "" : "is-missing"}>{pad(index, indexTeeth)}</em>)}
            </span>
            <span role="cell">{level.effective}/{level.indices.length}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The information strip under the canvas: live orthographic views, cutting
 * instructions and the active tool's report. View state only; it reads the
 * same solid, instruction groups and tool report as the rest of the editor.
 */
export function ViewportInfoStrip({
  tab, onTabChange, collapsed, onToggleCollapsed, status,
  solid, activeOperationId, previewOperationId, highlightOperationId, frostedFaceIds,
  instructionGroups, toolActive = false, ...toolProps
}) {
  const shared = { solid, activeOperationId, previewOperationId, highlightOperationId, frostedFaceIds };
  return (
    <section className={`viewport-info-strip${collapsed ? " is-collapsed" : " is-expanded"}`} aria-label={t("画布信息栏")}>
      <header className="info-strip-bar">
        <div className="optics-view-switch info-strip-tabs" role="tablist" aria-label={t("信息栏内容")}>
          {TABS.map(([id, label]) => (
            <button
              type="button" role="tab" key={id} aria-selected={!collapsed && tab === id}
              className={!collapsed && tab === id ? "is-active" : ""}
              onClick={() => { onTabChange(id); if (collapsed) onToggleCollapsed(); }}
            >
              {t(label)}
              {id === "tool" && toolActive ? <i className="info-strip-tool-dot" aria-label={t("复合刀具使用中")} /> : null}
            </button>
          ))}
        </div>
        <span className="info-strip-status" title={t(status)}>{t(status)}</span>
        <button type="button" className="info-strip-toggle" onClick={onToggleCollapsed} aria-expanded={!collapsed} aria-label={t(collapsed ? "展开画布信息栏" : "收起画布信息栏")} title={t(collapsed ? "展开画布信息栏" : "收起画布信息栏")}>
          {collapsed ? <IconChevronUp size={15} stroke={1.8} /> : <IconChevronDown size={15} stroke={1.8} />}
        </button>
      </header>
      {collapsed ? null : (
        <div className="info-strip-body">
          {tab === "ortho" ? (
            <div className="info-strip-ortho">
              {VIEWS.map(([view, label, code, aria]) => (
                <figure className="info-strip-view" key={view}>
                  <figcaption><strong>{t(label)}</strong><span>{code}</span></figcaption>
                  <TechnicalPreview {...shared} view={view} label={t(aria)} />
                </figure>
              ))}
            </div>
          ) : tab === "instructions" ? (
            <div className="info-strip-instructions"><CutInstructions groups={instructionGroups} compact /></div>
          ) : <ToolReport {...toolProps} />}
        </div>
      )}
    </section>
  );
}
