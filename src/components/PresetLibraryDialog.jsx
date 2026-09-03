import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { IconSearch, IconX } from "@tabler/icons-react";
import { filterPresetCatalog } from "../domain/presetLibrary.js";

const VIEW_LABELS = { isometric: "45° 轴测", top: "顶视", bottom: "底视", front: "正视" };

export function PresetLibraryDialog({ library, onClose, onLoad, discardingDraft = false }) {
  const [presets, setPresets] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [shape, setShape] = useState("all");
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    let active = true;
    library.list().then((items) => {
      if (!active) return;
      setPresets(items);
      setSelectedId(items[0]?.id ?? "");
      setStatus("ready");
    }).catch((reason) => {
      if (!active) return;
      setError(reason.message);
      setStatus("error");
    });
    return () => { active = false; };
  }, [library]);

  const shapes = useMemo(() => [...new Map(
    presets.map((preset) => [preset.shapeKey, preset.shape]),
  ).entries()].sort((left, right) => left[1].localeCompare(right[1], "zh-CN")), [presets]);
  const visiblePresets = useMemo(() => filterPresetCatalog(presets, {
    query: deferredQuery,
    shape,
  }), [deferredQuery, presets, shape]);
  const selected = visiblePresets.find((preset) => preset.id === selectedId) ?? visiblePresets[0];

  useEffect(() => {
    if (visiblePresets.length && !visiblePresets.some((preset) => preset.id === selectedId)) {
      setSelectedId(visiblePresets[0].id);
    }
  }, [selectedId, visiblePresets]);

  const loadSelected = async () => {
    if (!selected || status === "loading-preset") return;
    setStatus("loading-preset");
    setError("");
    try {
      await onLoad(await library.load(selected), selected);
    } catch (reason) {
      setError(reason.message);
      setStatus("ready");
    }
  };

  return (
    <div className="modal-backdrop preset-library-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="preset-library-panel" role="dialog" aria-modal="true" aria-label="预设琢型" onMouseDown={(event) => event.stopPropagation()}>
        <header className="preset-library-heading">
          <div><small>PRESET CUTS</small><h2>预设琢型</h2></div>
          <span>{presets.length} 个内置精选</span>
          <button type="button" onClick={onClose} aria-label="关闭预设琢型"><IconX size={17} /></button>
        </header>

        <div className="preset-library-toolbar">
          <label className="preset-search"><IconSearch size={14} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、作者或来源" aria-label="搜索预设琢型" /></label>
          <label><span>外形</span><select value={shape} onChange={(event) => setShape(event.target.value)} aria-label="按外形筛选"><option value="all">全部外形</option>{shapes.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <small>{visiblePresets.length} RESULTS</small>
        </div>

        {status === "loading" ? <div className="preset-library-state">正在读取预设索引…</div> : null}
        {status === "error" ? <div className="preset-library-state is-error">{error}</div> : null}
        {status !== "loading" && status !== "error" ? (
          <div className="preset-library-body">
            <div className="preset-list" role="listbox" aria-label="预设琢型列表">
              {visiblePresets.map((preset) => (
                <button type="button" role="option" aria-selected={preset.id === selected?.id} className={preset.id === selected?.id ? "is-selected" : ""} onClick={() => setSelectedId(preset.id)} key={`${preset.providerId}:${preset.id}`}>
                  <img src={preset.previews.isometric} loading="lazy" alt={`${preset.name} 45° 轴测预览`} />
                  <span><strong>{preset.name}</strong><small>{preset.shape} · {preset.facetCount} F</small></span>
                </button>
              ))}
              {visiblePresets.length === 0 ? <p>没有符合当前条件的预设。</p> : null}
            </div>

            {selected ? <article className="preset-detail">
              <div className="preset-detail-title"><div><small>{selected.shape.toUpperCase()}</small><h3>{selected.name}</h3><p>{selected.designer || "设计者未署名"}</p></div><span>VALIDATED</span></div>
              <div className="preset-preview-grid">
                {Object.entries(VIEW_LABELS).map(([view, label]) => <figure key={view}><img src={selected.previews[view]} alt={`${selected.name} ${label}`} /><figcaption>{label}</figcaption></figure>)}
              </div>
              <dl className="preset-specs">
                <div><dt>刻面</dt><dd>{selected.facetCount} F</dd></div>
                <div><dt>层数</dt><dd>{selected.tierCount}</dd></div>
                <div><dt>分度</dt><dd>{selected.sourceGear} → 96</dd></div>
                <div><dt>L / W</dt><dd>{selected.lengthToWidth.toFixed(3)}</dd></div>
              </dl>
              <div className="preset-provenance"><strong>来源与开放声明</strong><p>{selected.openDeclaration} · {selected.sourceReference || "FacetDiagrams.org"}</p><a href={selected.sourcePageUrl} target="_blank" rel="noreferrer">查看来源页面</a></div>
              {error ? <p className="preset-load-error">{error}</p> : null}
              <footer>
                <p>{discardingDraft
                  ? "当前未保存 CUT 动作会被放弃；已保存文档仍可用一次撤销恢复。"
                  : "载入会替换当前文档，并作为一次命令写入，可用撤销恢复。"}</p>
                <button type="button" className="primary-action" onClick={loadSelected} disabled={status === "loading-preset"}>
                  {status === "loading-preset" ? "正在载入…" : discardingDraft ? "放弃当前动作并载入" : "载入此琢型"}
                </button>
              </footer>
            </article> : <div className="preset-library-state">请选择一个预设。</div>}
          </div>
        ) : null}
      </section>
    </div>
  );
}
