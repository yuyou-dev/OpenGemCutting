import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("./", import.meta.url));
const modules = readdirSync(root, { recursive: true })
  .filter(name => /\.(js|jsx)$/.test(name) && !name.endsWith(".test.js"))
  .map(name => name.split(path.sep).join("/"));
const names = new Set(modules);
const graph = new Map();

// Production modules use literal ESM imports. Include re-exports and lazy
// literal imports so moving an implementation behind a facade keeps its edge.
for (const name of modules) {
  const source = readFileSync(path.join(root, name), "utf8");
  const specifiers = [
    ...source.matchAll(/^\s*(?:import\s+(?:[\w*{},\s]+\s+from\s+)?|export\s+(?:\*|\{[^}]*\})\s+from\s+)["']([^"']+)["']/gm),
    ...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']/g),
  ].map(match => match[1]);
  graph.set(name, specifiers.map(specifier => specifier.startsWith(".")
    ? path.posix.normalize(path.posix.join(path.posix.dirname(name), specifier)) : specifier));
}

test("domain and mesh modules keep their rendering-independent dependency boundary", () => {
  for (const [name, dependencies] of graph) {
    if (!name.startsWith("domain/")) continue;
    for (const dependency of dependencies) {
      assert.ok(dependency.startsWith("domain/") || dependency.startsWith("utils/"),
        `${name} must not depend on the UI, renderer, or a runtime package: ${dependency}`);
      if (name.startsWith("domain/mesh/")) {
        assert.ok(dependency.startsWith("domain/mesh/"),
          `The mesh kernel must not depend on document or CUT state: ${name} → ${dependency}`);
      }
    }
  }
});

test("production ESM modules have no circular imports", () => {
  const complete = new Set();
  const active = new Set();
  function visit(name, trail = []) {
    assert.ok(!active.has(name), `Circular import: ${[...trail, name].join(" → ")}`);
    if (complete.has(name)) return;
    active.add(name);
    for (const dependency of graph.get(name)) {
      if (names.has(dependency)) visit(dependency, [...trail, name]);
    }
    active.delete(name);
    complete.add(name);
  }
  for (const name of modules) visit(name);
});
