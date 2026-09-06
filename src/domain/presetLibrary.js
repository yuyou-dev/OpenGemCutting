function basePath(value = "/") {
  return `${value}`.replace(/\/*$/, "/");
}

/**
 * facetdiagrams.org post ids excluded during final visual curation: the ASC
 * parses, but the resolved solid shows visibly broken faces. Regenerated
 * catalogs must never reintroduce them.
 */
export const CURATION_EXCLUSIONS = new Set([
  "96655", // PC 02.276 Small OMNI Oval 1.4: incomplete pavilion
  "100855", // PC 08.087B Chevron Cushion CC Brilliant 1.10: incomplete facets
]);

// Keep exclusions effective when a later archive contains only an alias page.
export const CURATION_EXCLUSION_HASHES = new Set([
  "1e154c244a637edad1e90dff3f13322fbcc005bd27316ec91d43a741faa11058", // 96655
  "48f42fc3e2d08c090cef56f70ba4eec490f8914368fb67331ea13b51d8bea403", // 100855
]);

function normalizeSummary(item, providerId) {
  if (!item?.id || !item?.name || !item?.document) {
    throw new TypeError(`preset provider ${providerId} returned an invalid summary`);
  }
  return {
    ...item,
    providerId,
    searchText: [item.id, item.name, item.designer, item.shape, item.sourceReference, item.sourcePageUrl, ...(item.duplicateSources ?? []).flatMap((source) => [source.name, source.sourcePageUrl])]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase("zh-CN"),
  };
}

/** Providers only need `id`, `list()` and `load(summary)`, so future local JSON presets share the same UI. */
export function createPresetLibrary(providers) {
  const providerMap = new Map(providers.map((provider) => [provider.id, provider]));
  return Object.freeze({
    sources: Object.freeze(providers.map((provider) => Object.freeze({
      id: provider.id,
      label: provider.label ?? provider.id,
      canSave: typeof provider.save === "function",
    }))),
    async list() {
      const groups = await Promise.all(providers.map(async (provider) => (
        (await provider.list()).map((item) => normalizeSummary(item, provider.id))
      )));
      return groups.flat();
    },
    async load(summary) {
      const provider = providerMap.get(summary.providerId);
      if (!provider) throw new Error(`预设来源“${summary.providerId}”不可用。`);
      return provider.load(summary);
    },
    async save(providerId, document, metadata = {}) {
      const provider = providerMap.get(providerId);
      if (!provider?.save) throw new Error(`预设来源“${providerId}”不支持保存。`);
      return provider.save(document, metadata);
    },
  });
}

export function createStaticPresetProvider({ fetcher = fetch, publicBase = "/" } = {}) {
  const root = `${basePath(publicBase)}presets/`;
  let catalogPromise;
  async function readJson(url) {
    const response = await fetcher(url);
    if (!response.ok) throw new Error(`无法读取预设资源：${response.status}`);
    return response.json();
  }
  return Object.freeze({
    id: "builtin",
    label: "内置精选",
    async list() {
      catalogPromise ??= readJson(`${root}catalog.json`).catch((error) => {
        catalogPromise = undefined;
        throw error;
      });
      const catalog = await catalogPromise;
      return catalog.presets.map((preset) => ({
        ...preset,
        document: `${root}${preset.document}`,
        previews: Object.fromEntries(
          Object.entries(preset.previews).map(([view, url]) => [view, `${root}${url}`]),
        ),
      }));
    },
    load(summary) {
      return readJson(summary.document);
    },
  });
}

export const PRESET_FACET_RANGES = [
  { id: "up-to-60", label: "≤ 60 面", min: 0, max: 60 },
  { id: "61-100", label: "61–100 面", min: 60, max: 100 },
  { id: "101-160", label: "101–160 面", min: 100, max: 160 },
  { id: "over-160", label: "> 160 面", min: 160, max: Infinity },
];

export const PRESET_RATIO_RANGES = [
  { id: "up-to-1.05", label: "≤ 1.05", min: 0, max: 1.05 },
  { id: "1.05-1.30", label: "> 1.05 至 1.30", min: 1.05, max: 1.3 },
  { id: "1.30-1.60", label: "> 1.30 至 1.60", min: 1.3, max: 1.6 },
  { id: "over-1.60", label: "> 1.60", min: 1.6, max: Infinity },
];

function matchesRange(value, rangeId, ranges) {
  if (rangeId === "all") return true;
  const range = ranges.find((candidate) => candidate.id === rangeId);
  return Boolean(range && Number.isFinite(value) && value > range.min && value <= range.max);
}

export function filterPresetCatalog(presets, { query = "", shape = "all", facets = "all", ratio = "all" } = {}) {
  const words = query.trim().toLocaleLowerCase("zh-CN").split(/\s+/).filter(Boolean);
  return presets.filter((preset) => (
    (shape === "all" || preset.shapeKey === shape)
    && matchesRange(preset.facetCount, facets, PRESET_FACET_RANGES)
    && matchesRange(preset.lengthToWidth, ratio, PRESET_RATIO_RANGES)
    && words.every((word) => preset.searchText.includes(word))
  ));
}
