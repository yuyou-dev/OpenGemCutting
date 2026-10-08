import { useEffect, useLayoutEffect, useRef } from "react";
import { IconLock, IconX } from "@tabler/icons-react";
import { t } from "../i18n/locale.js";
import { COMPOSITE_CATEGORIES } from "../domain/compositeTools.js";
import { FACET_REGION_LABELS } from "../domain/faceting.js";
import { toolsForRegion } from "../application/compositeToolSession.js";
import { ToolLibrary } from "./ToolLibrary.jsx";
import "./tool-library-drawer.css";

/**
 * The tool library drawer: opens beside the operation panel over the canvas
 * (the canvas keeps its size) with every tool of the current region as a
 * card, the ordinary cut first. Picking hands the choice to the editor's own
 * pick handlers and closes; ×, Escape (captured, so the CUT session never sees
 * it) and a click outside close it too. It is view chrome, not a session state.
 */
export function ToolLibraryDrawer({
  open, onClose, region, indexTeeth = 96, activeToolId = null, onPickTool, onPickNormal,
  disabled = false, toolsDisabled = false, note = "", browse = false,
}) {
  const drawerRef = useRef(null);
  const bodyRef = useRef(null);
  const tools = toolsForRegion(region);
  const categories = COMPOSITE_CATEGORIES.filter((category) => tools.some((tool) => tool.category === category.id));
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (drawerRef.current?.contains(target) || target.closest("[data-library-toggle]")) return;
      onClose();
    };
    // Capture phase: Escape closes only the drawer and never reaches the editor's CUT Escape.
    const escape = (event) => { if (event.key === "Escape") { event.stopPropagation(); event.preventDefault(); onClose(); } };
    // Capture phase too: the canvas stops its own pointer events from bubbling.
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", escape, true);
    return () => { window.removeEventListener("pointerdown", outside, true); window.removeEventListener("keydown", escape, true); };
  }, [open, onClose]);
  useLayoutEffect(() => {
    if (!open) return;
    // The drawer takes focus (Tab reaches the cards) and the current choice comes into view.
    drawerRef.current?.focus({ preventScroll: true });
    bodyRef.current?.querySelector(".tool-library-item.is-active")?.scrollIntoView({ block: "nearest" });
  }, [open, region]);
  if (!open) return null;
  const jumpTo = (id) => {
    const body = bodyRef.current, section = body?.querySelector(`[data-category="${id}"]`);
    if (section) body.scrollTo({ top: section.offsetTop, behavior: "smooth" });
  };
  const pickTool = (id) => { onPickTool(id); onClose(); };
  const pickNormal = () => { onPickNormal(); onClose(); };
  const plainNote = browse ? t("浏览刀具：点左侧上方的“新增切割”后，再在这里选普通切或一把刀。")
    : region === "girdle" ? t("腰部只列出环形母形刀具。") : "";
  return (
    <section
      ref={drawerRef} className={`tool-library-drawer${browse ? " is-browse" : ""}`} role="dialog" aria-modal="false"
      aria-label={t("刀具库")} tabIndex={-1}
    >
      <header className="tool-drawer-head">
        <div className="tool-drawer-title">
          <strong>{t("刀具库")}</strong><span>TOOLS</span>
          <small>{t("{0} · {1} 项", [t(FACET_REGION_LABELS[region]), tools.length + 1])}</small>
        </div>
        <button type="button" className="tool-drawer-close" onClick={onClose} aria-label={t("关闭刀具库")} title={`${t("关闭刀具库")} · Esc`}>
          <IconX size={16} stroke={1.8} />
        </button>
        <nav className="tool-drawer-jumps" aria-label={t("刀具分类")}>
          <button type="button" onClick={() => jumpTo("normal")}>{t("普通切")}</button>
          {categories.map((category) => (
            <button type="button" key={category.id} title={t(category.hint)} onClick={() => jumpTo(category.id)}>{t(category.label)}</button>
          ))}
        </nav>
      </header>
      {note ? <p className="tool-drawer-note"><IconLock size={14} stroke={1.7} aria-hidden="true" />{t(note)}</p>
        : plainNote ? <p className="tool-drawer-note is-plain">{plainNote}</p> : null}
      <div className="tool-drawer-body" ref={bodyRef}>
        <ToolLibrary
          region={region} indexTeeth={indexTeeth} activeToolId={activeToolId}
          onPick={pickTool} normal={{ onPick: pickNormal }} disabled={disabled} toolsDisabled={toolsDisabled}
        />
      </div>
    </section>
  );
}
