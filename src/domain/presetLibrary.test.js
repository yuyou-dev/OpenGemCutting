import assert from "node:assert/strict";
import test from "node:test";
import { createPresetLibrary, createStaticPresetProvider, filterPresetCatalog } from "./presetLibrary.js";

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
