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
