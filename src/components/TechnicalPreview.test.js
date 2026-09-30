import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// The mesh preview resizes its pixel buffer to its CSS box (ResizeObserver).
// An inline `height: 100%` once overrode the cutting assistant's fixed side-view
// height; in that auto-height flex item the box followed the buffer, grew every
// frame and exhausted GPU memory until every WebGL context on the page was lost.
test("mesh preview canvas takes its size from each context's stylesheet", async () => {
  const component = await readFile(new URL("./TechnicalPreview.jsx", import.meta.url), "utf8");
  const canvas = component.match(/<canvas\b[^>]*>/)?.[0];
  assert.ok(canvas, "the mesh preview renders a canvas");
  assert.doesNotMatch(canvas, /\bstyle=/, "an inline size would override every context height");
  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(styles, /canvas\.technical-preview\s*\{[^}]*height:\s*100%/, "default: fill a sized container");
  assert.match(styles, /\.assistant-side-view \.technical-preview\s*\{[^}]*height:\s*130px/, "the side view has a fixed height");
});
