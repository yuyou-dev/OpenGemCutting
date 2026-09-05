import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_OPTICS_SETTINGS,
  applyOpticalPreset,
  criticalAngleDegrees,
  resolveOpticsSettings,
} from "./optics.js";

test("diamond defaults use the published optical constants", () => {
  const settings = resolveOpticsSettings();
  assert.equal(settings.material.ior, 2.417);
  assert.equal(settings.material.dispersion, 0.044);
  assert.ok(Math.abs(criticalAngleDegrees(settings.material.ior) - 24.45) < 0.05);
});

test("optical presets and settings overrides remain normalized", () => {
  const sapphire = applyOpticalPreset(DEFAULT_OPTICS_SETTINGS, "sapphire");
  assert.equal(sapphire.material.ior, 1.77);
  assert.equal(sapphire.material.preset, "sapphire");
  assert.equal(resolveOpticsSettings({ material: { ior: 9 } }).material.ior, 3.5);
  assert.equal(resolveOpticsSettings({ material: { preset: "custom", ior: 2.1 } }).material.preset, "custom");
  assert.equal(resolveOpticsSettings({ view: { environment: "hearts" } }).view.environment, "hearts");
});

test("ASC legacy refractive index and material IOR resolve with current-field precedence", () => {
  assert.equal(resolveOpticsSettings({ refractiveIndex: 1.54 }).material.ior, 1.54);
  assert.equal(resolveOpticsSettings({ refractiveIndex: 1.54 }).material.preset, "custom");
  assert.equal(resolveOpticsSettings({ refractiveIndex: 1.54, material: { ior: 1.77 } }).material.ior, 1.77);
});

test("material survives preset replacement undo, redo, JSON, and ASC export", async () => {
  const { createDocumentOpticsCommand } = await import("./optics.js");
  const { createWorkbenchDocument } = await import("./document.js");
  const { createCommandHistory, executeFacetingCommand, createReplaceDocumentCommand, undoFacetingCommand, redoFacetingCommand, exportFacetingJSON, importFacetingJSON } = await import("./faceting.js");
  const { serializeGemCadAsc } = await import("./gemcadAsc.js");
  const original = createWorkbenchDocument("original");
  let history = createCommandHistory(original);
  const sapphire = applyOpticalPreset(DEFAULT_OPTICS_SETTINGS, "sapphire");
  const originalFacets = history.present.facets;
  history = executeFacetingCommand(history, createDocumentOpticsCommand(sapphire));
  assert.equal(history.present.facets, originalFacets, "material-only updates must not rebuild geometry");
  history = executeFacetingCommand(history, createReplaceDocumentCommand(createWorkbenchDocument("replacement")));
  history = undoFacetingCommand(history);
  assert.equal(history.present.name, "original");
  assert.equal(resolveOpticsSettings(history.present.metadata.optics).material.ior, 1.77);
  assert.equal(history.present.metadata.optics.view, undefined);
  const imported = importFacetingJSON(exportFacetingJSON(history.present));
  assert.equal(resolveOpticsSettings(imported.metadata.optics).material.ior, 1.77);
  assert.equal(serializeGemCadAsc(imported).summary.refractiveIndex, 1.77);
  history = redoFacetingCommand(history);
  assert.equal(history.present.name, "replacement");
  assert.equal(resolveOpticsSettings(history.present.metadata.optics).material.ior, 2.417);
});
