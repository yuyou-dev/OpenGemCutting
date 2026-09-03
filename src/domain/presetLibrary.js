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

function normalizeSummary(item, providerId) {
  if (!item?.id || !item?.name || !item?.document) {
    throw new TypeError(`preset provider ${providerId} returned an invalid summary`);
  }
  return {
    ...item,
    providerId,
    searchText: [item.name, item.designer, item.shape, item.sourceReference]
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

export function filterPresetCatalog(presets, { query = "", shape = "all" } = {}) {
  const needle = query.trim().toLocaleLowerCase("zh-CN");
  return presets.filter((preset) => (
    (shape === "all" || preset.shapeKey === shape)
    && (!needle || preset.searchText.includes(needle))
  ));
}
