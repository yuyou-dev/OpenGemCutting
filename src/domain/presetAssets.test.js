import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { importFacetingJSON } from "./faceting.js";
import { CURATION_EXCLUSIONS } from "./presetLibrary.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const presetRoot = path.join(repoRoot, "public", "presets");

test("ships a curated 50–100 item preset catalog with unique source geometry", async () => {
  const catalog = JSON.parse(await readFile(path.join(presetRoot, "catalog.json"), "utf8"));
  assert.equal(catalog.count, catalog.presets.length);
  assert.ok(catalog.count >= 50 && catalog.count <= 100);
  assert.equal(new Set(catalog.presets.map((preset) => preset.id)).size, catalog.count);
  assert.equal(new Set(catalog.presets.map((preset) => preset.sourceSha256)).size, catalog.count);
});

test("does not reintroduce presets rejected during final visual curation", async () => {
  const catalog = JSON.parse(await readFile(path.join(presetRoot, "catalog.json"), "utf8"));
  const rejectedPostIds = [...CURATION_EXCLUSIONS].map((postId) => `${postId}-`);
  assert.ok(catalog.presets.every((preset) => rejectedPostIds.every((postId) => !preset.id.startsWith(postId))));
});

test("every preset has an importable document, four generated views, and traceable public provenance", async () => {
  const catalog = JSON.parse(await readFile(path.join(presetRoot, "catalog.json"), "utf8"));
  for (const preset of catalog.presets) {
    const documentText = await readFile(path.join(presetRoot, preset.document), "utf8");
    const document = importFacetingJSON(documentText);
    assert.equal(document.name, preset.name);
    assert.ok(document.facets.length > 0);
    assert.match(preset.sourcePageUrl, /^https:\/\/facetdiagrams\.org\/diagram\//);
    assert.ok(preset.openDeclaration);
    assert.deepEqual(Object.keys(preset.previews).sort(), ["bottom", "front", "isometric", "top"]);
    for (const preview of Object.values(preset.previews)) {
      const svg = await readFile(path.join(presetRoot, preview), "utf8");
      assert.match(svg, /^<svg[^>]+viewBox="0 0 320 240"/);
      assert.match(svg, /<rect width="100%" height="100%" fill="#fff"\/>/);
      assert.doesNotMatch(svg, /\/Users\/|target_file|file:\/\//);
    }
    assert.doesNotMatch(documentText, /\/Users\/|target_file|file:\/\//);
  }
});
