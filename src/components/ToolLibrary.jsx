import { t } from "../i18n/locale.js";
import "./composite-tools.css";
import { COMPOSITE_CATEGORIES } from "../domain/compositeTools.js";
import { toolPreviewHood, toolsForRegion } from "../application/compositeToolSession.js";
import { ToolSketch } from "./ToolSketch.jsx";

/** Region-filtered tool cards grouped by category, with real hood previews.
 * toolsDisabled keeps the current tool and ordinary cut reachable while editing.
 */
export const NORMAL_SUMMARY = "单一角度、深度与分度的对称或自定义切割";

/** The ordinary cut's mark: one flat facet across a round stone, drawn like a tool top view. */
export function NormalCutIcon({ size = 38 }) {
  return (
    <svg className="tool-library-normal-mark" viewBox="-1.08 -1.08 2.16 2.16" width={size} height={size} aria-hidden="true">
      <circle className="tool-library-normal-rim" cx="0" cy="0" r="1" />
      <path className="tool-library-normal-facet" d="M 0.38 -0.925 A 1 1 0 0 1 0.38 0.925 Z" />
    </svg>
  );
}

export function ToolLibrary({ region, indexTeeth = 96, activeToolId = null, onPick, normal = null, disabled = false, toolsDisabled = false }) {
  const tools = toolsForRegion(region);
  const thumb = 84;
  const card = (tool) => (
    <button
      key={tool.id}
      type="button"
      className={`tool-library-item${activeToolId === tool.id ? " is-active" : ""}`}
      aria-pressed={activeToolId === tool.id}
      disabled={disabled || (toolsDisabled && activeToolId !== tool.id)}
      onClick={() => onPick?.(tool.id)}
      title={t(tool.summary)}
    >
      <ToolSketch hood={toolPreviewHood(tool.id, { region, indexTeeth })} size={thumb} outline={false} title={t(tool.label)} />
      <span className="tool-library-text">
        <strong>{t(tool.label)}{tool.experimental ? <em>{t("实验")}</em> : null}</strong>
        <small>{t(tool.summary)}</small>
      </span>
    </button>
  );
  const normalCard = normal ? (
    <button type="button" className={`tool-library-item is-normal${activeToolId === null ? " is-active" : ""}`} aria-pressed={activeToolId === null} disabled={disabled} onClick={normal.onPick} title={t(NORMAL_SUMMARY)}>
      <NormalCutIcon size={thumb} />
      <span className="tool-library-text"><strong>{t("普通切")}</strong><small>{t(NORMAL_SUMMARY)}</small></span>
    </button>
  ) : null;
  return (
    <div className="tool-library is-grid">
      {normal ? (
        <section className="tool-library-group" data-category="normal">
          <h3>{t("普通切")}<small>{t("一组行业角、深度与分度；可用 Meet／Jump 让刻面经过指定交点")}</small></h3>
          <div className="tool-library-items">{normalCard}</div>
        </section>
      ) : null}
      {COMPOSITE_CATEGORIES.map((category) => {
        const members = tools.filter((tool) => tool.category === category.id);
        if (!members.length) return null;
        return (
          <section className="tool-library-group" key={category.id} data-category={category.id}>
            <h3>{t(category.label)}<small>{t(category.hint)}</small></h3>
            <div className="tool-library-items">{members.map(card)}</div>
          </section>
        );
      })}
    </div>
  );
}
