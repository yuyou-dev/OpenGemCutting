import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_OPTICS_SETTINGS,
  applyOpticalPreset,
  beerLambert,
  criticalAngleDegrees,
  fresnelDielectric,
  materialAbsorptionRgb,
  resolveOpticsSettings,
} from "./optics.js";

test("diamond defaults use the published optical constants", () => {
  const settings = resolveOpticsSettings();
  assert.equal(settings.material.ior, 2.417);
  assert.equal(settings.material.dispersion, 0.044);
  assert.ok(Math.abs(criticalAngleDegrees(settings.material.ior) - 24.45) < 0.05);
});

test("dielectric Fresnel matches the normal-incidence equation", () => {
  const expected = ((1 - 2.417) / (1 + 2.417)) ** 2;
  assert.ok(Math.abs(fresnelDielectric(1, 1, 2.417) - expected) < 1e-12);
  assert.equal(fresnelDielectric(0.1, 2.417, 1), 1);
});

test("Beer-Lambert attenuation and preset changes remain normalized", () => {
  assert.ok(Math.abs(beerLambert(0.5, 2) - Math.exp(-1)) < 1e-12);
  const sapphire = applyOpticalPreset(DEFAULT_OPTICS_SETTINGS, "sapphire");
  assert.equal(sapphire.material.ior, 1.77);
  assert.equal(sapphire.material.preset, "sapphire");
  assert.equal(resolveOpticsSettings({ material: { ior: 9 } }).material.ior, 3.5);
  assert.equal(resolveOpticsSettings({ material: { preset: "custom", ior: 2.1 } }).material.preset, "custom");
});

test("body colour creates chromatic absorption even when neutral absorption is zero", () => {
  assert.deepEqual(materialAbsorptionRgb("#ffffff", 0), [0, 0, 0]);
  const yellow = materialAbsorptionRgb("#f4df73", 0);
  assert.ok(yellow[2] > yellow[1]);
  assert.ok(yellow[1] > yellow[0]);
  assert.equal(resolveOpticsSettings({ view: { environment: "hearts" } }).view.environment, "hearts");
});
