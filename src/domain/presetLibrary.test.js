import assert from "node:assert/strict";
import test from "node:test";
import { createPresetLibrary, createStaticPresetProvider, filterPresetCatalog, PRESET_FACET_RANGES, PRESET_RATIO_RANGES } from "./presetLibrary.js";

const summary = {
  id: "astryx-star",
  name: "Astryx Star",
  designer: "Gautam Popli",
  shape: "Square Emerald",
  shapeKey: "square-emerald",
  document: "documents/astryx-star.json",
  previews: { top: "previews/astryx-star-top.svg" },
};

test("static provider resolves catalog assets below an arbitrary public base", async () => {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    return { ok: true, json: async () => url.endsWith("catalog.json") ? { presets: [summary] } : { name: "Astryx Star" } };
  };
  const library = createPresetLibrary([createStaticPresetProvider({ fetcher, publicBase: "/facet-96/" })]);
  const [preset] = await library.list();
  await library.list();
  assert.equal(preset.document, "/facet-96/presets/documents/astryx-star.json");
  assert.equal(preset.previews.top, "/facet-96/presets/previews/astryx-star-top.svg");
  assert.deepEqual(await library.load(preset), { name: "Astryx Star" });
  assert.deepEqual(calls, ["/facet-96/presets/catalog.json", "/facet-96/presets/documents/astryx-star.json"]);
});

test("catalog filtering is provider-agnostic and searches metadata", async () => {
  const library = createPresetLibrary([{ id: "personal", list: async () => [summary], load: async () => ({}) }]);
  const presets = await library.list();
  assert.equal(filterPresetCatalog(presets, { query: "popli" }).length, 1);
  assert.equal(filterPresetCatalog(presets, { shape: "round" }).length, 0);
  assert.equal(filterPresetCatalog(presets, { shape: "square-emerald" }).length, 1);
});

test("provider capabilities reserve one save path for future personal JSON presets", async () => {
  const saved = [];
  const library = createPresetLibrary([{
    id: "personal",
    label: "我的预设",
    list: async () => [],
    load: async () => null,
    save: async (document) => saved.push(document),
  }]);
  assert.deepEqual(library.sources, [{ id: "personal", label: "我的预设", canSave: true }]);
  await library.save("personal", { name: "Current design" });
  assert.equal(saved[0].name, "Current design");
});


test("multiword search combines name, author and source with numeric filters", async () => {
  const library = createPresetLibrary([{ id: "personal", list: async () => [{
    ...summary, facetCount: 73, lengthToWidth: 1.24, sourceReference: "Open Collection",
  }], load: async () => ({}) }]);
  const presets = await library.list();
  assert.equal(filterPresetCatalog(presets, {
    query: "  STAR   POPLI open  ", shape: "square-emerald", facets: "61-100", ratio: "1.05-1.30",
  }).length, 1);
  assert.equal(filterPresetCatalog(presets, { query: "star missing" }).length, 0);
  assert.equal(filterPresetCatalog(presets, { query: "popli", facets: "up-to-60" }).length, 0);
  assert.equal(filterPresetCatalog(presets, { facets: "61-100", ratio: "over-1.60" }).length, 0);
});

test("numeric ranges cover valid summaries once, including exact boundaries", () => {
  const facets = [1, 60, 61, 100, 101, 160, 161, 400];
  const ratios = [1, 1.05, 1.050001, 1.3, 1.300001, 1.6, 1.600001, 3];
  const presets = facets.map((facetCount, index) => ({
    id: String(index), facetCount, lengthToWidth: ratios[index], searchText: "",
  }));
  for (const [key, ranges] of [["facets", PRESET_FACET_RANGES], ["ratio", PRESET_RATIO_RANGES]]) {
    const groups = ranges.map(({ id }) => filterPresetCatalog(presets, { [key]: id }).map((preset) => preset.id));
    assert.deepEqual(groups, [["0", "1"], ["2", "3"], ["4", "5"], ["6", "7"]]);
  }
});

test("missing metrics remain discoverable but do not enter numeric categories", () => {
  const presets = [{ id: "no-metrics", searchText: "legacy" }];
  assert.equal(filterPresetCatalog(presets).length, 1);
  assert.equal(filterPresetCatalog(presets, { facets: "up-to-60" }).length, 0);
  assert.equal(filterPresetCatalog(presets, { ratio: "up-to-1.05" }).length, 0);
});
