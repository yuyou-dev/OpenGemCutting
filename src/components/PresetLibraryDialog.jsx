import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { IconSearch, IconX } from "@tabler/icons-react";
import { filterPresetCatalog, PRESET_FACET_RANGES, PRESET_RATIO_RANGES } from "../domain/presetLibrary.js";

const PAGE_SIZE = 60;
const presetKey = (preset) => `${preset.providerId}:${preset.id}`;

const VIEW_LABELS = { isometric: "45° 轴测", top: "顶视", bottom: "底视", front: "正视" };

export function PresetLibraryDialog({ library, onClose, onLoad, discardingDraft = false }) {
  const [presets, setPresets] = useState([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [filters, setFilters] = useState({ query: "", shape: "all", facets: "all", ratio: "all" });
  const [page, setPage] = useState(1);
  const listRef = useRef(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const deferredQuery = useDeferredValue(filters.query);

  useEffect(() => {
    let active = true;
    library.list().then((items) => {
      if (!active) return;
      setPresets(items);
      setSelectedKey(items[0] ? presetKey(items[0]) : "");
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
  const appliedFilters = useMemo(() => ({ ...filters, query: deferredQuery }), [deferredQuery, filters]);
  const visiblePresets = useMemo(() => filterPresetCatalog(presets, appliedFilters), [appliedFilters, presets]);
  const filterCounts = useMemo(() => Object.fromEntries([
    ["shape", shapes.map(([id]) => ({ id }))],
    ["facets", PRESET_FACET_RANGES],
    ["ratio", PRESET_RATIO_RANGES],
  ].map(([key, options]) => [key, Object.fromEntries(options.map(({ id }) => [
    id, filterPresetCatalog(presets, { ...appliedFilters, [key]: id }).length,
  ]))])), [appliedFilters, presets, shapes]);
  const pageCount = Math.max(1, Math.ceil(visiblePresets.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pagePresets = visiblePresets.slice(pageStart, pageStart + PAGE_SIZE);
  const selected = pagePresets.find((preset) => presetKey(preset) === selectedKey) ?? pagePresets[0];
  const hasFilters = filters.query || [filters.shape, filters.facets, filters.ratio].some((value) => value !== "all");

  const updateFilters = (patch) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
    setSelectedKey("");
  };
  const changePage = (nextPage) => {
    setPage(nextPage);
    setSelectedKey("");
  };

  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
  }, [currentPage, visiblePresets]);

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
          <span>{presets.length} 个可用琢型</span>
          <button type="button" onClick={onClose} aria-label="关闭预设琢型"><IconX size={17} /></button>
        </header>

        <div className="preset-library-toolbar">
          <label className="preset-search"><IconSearch size={14} /><input autoFocus value={filters.query} onChange={(event) => updateFilters({ query: event.target.value })} placeholder="搜索名称、作者或来源，可组合关键词" aria-label="搜索预设琢型" /></label>
          <label><span>外形</span><select value={filters.shape} onChange={(event) => updateFilters({ shape: event.target.value })} aria-label="按外形筛选"><option value="all">全部外形</option>{shapes.map(([value, label]) => <option value={value} key={value}>{label} · {filterCounts.shape[value]}</option>)}</select></label>
          <label><span>刻面</span><select value={filters.facets} onChange={(event) => updateFilters({ facets: event.target.value })} aria-label="按有效刻面数筛选"><option value="all">全部面数</option>{PRESET_FACET_RANGES.map(({ id, label }) => <option value={id} key={id}>{label} · {filterCounts.facets[id]}</option>)}</select></label>
          <label><span>L/W</span><select value={filters.ratio} onChange={(event) => updateFilters({ ratio: event.target.value })} aria-label="按长宽比筛选"><option value="all">全部比例</option>{PRESET_RATIO_RANGES.map(({ id, label }) => <option value={id} key={id}>{label} · {filterCounts.ratio[id]}</option>)}</select></label>
          <div className="preset-filter-summary"><span aria-live="polite">找到 <strong>{visiblePresets.length}</strong> / {presets.length} 个琢型</span><button type="button" onClick={() => updateFilters({ query: "", shape: "all", facets: "all", ratio: "all" })} disabled={!hasFilters}>清除筛选</button></div>
        </div>

        {status === "loading" ? <div className="preset-library-state">正在读取预设索引…</div> : null}
        {status === "error" ? <div className="preset-library-state is-error">{error}</div> : null}
        {status !== "loading" && status !== "error" ? (
          <div className="preset-library-body">
            <div className="preset-list-column">
            <div className="preset-list" ref={listRef} role="listbox" aria-label="预设琢型列表">
              {pagePresets.map((preset) => (
                <button type="button" role="option" aria-selected={presetKey(preset) === (selected && presetKey(selected))} className={presetKey(preset) === (selected && presetKey(selected)) ? "is-selected" : ""} onClick={() => setSelectedKey(presetKey(preset))} key={`${preset.providerId}:${preset.id}`}>
                  <img src={preset.previews.isometric} loading="lazy" alt={`${preset.name} 45° 轴测预览`} />
                  <span><strong>{preset.name}</strong><small>{preset.shape} · {preset.facetCount} 面 · L/W {preset.lengthToWidth.toFixed(2)}</small></span>
                </button>
              ))}
              {visiblePresets.length === 0 ? <p>没有符合当前条件的预设。</p> : null}
            </div>
            <nav className="preset-pagination" aria-label="预设列表分页">
              <span>{visiblePresets.length ? `${pageStart + 1}–${Math.min(pageStart + PAGE_SIZE, visiblePresets.length)}` : "0"} / {visiblePresets.length}</span>
              <div><button type="button" onClick={() => changePage(currentPage - 1)} disabled={currentPage === 1}>上一页</button><span>{currentPage} / {pageCount}</span><button type="button" onClick={() => changePage(currentPage + 1)} disabled={currentPage === pageCount}>下一页</button></div>
            </nav>
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
