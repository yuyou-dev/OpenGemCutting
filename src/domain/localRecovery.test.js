import assert from "node:assert/strict";
import test from "node:test";
import { createLocalRecoveryStore } from "./localRecovery.js";
import { createWorkbenchDocument } from "./document.js";
import { applyOpticalPreset, DEFAULT_OPTICS_SETTINGS } from "./optics.js";

function memoryStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test("local recovery preserves full document and material with isolated, time-ordered records", () => {
  const store = createLocalRecoveryStore(memoryStorage());
  const document = createWorkbenchDocument("蓝宝石设计");
  document.metadata.optics = applyOpticalPreset(DEFAULT_OPTICS_SETTINGS, "sapphire");
  store.save("first", document, 100);
  store.save("second", createWorkbenchDocument("另一个设计"), 200);
  const records = store.list().records;
  assert.deepEqual(records.map((record) => record.id), ["second", "first"]);
  assert.equal(records[1].document.metadata.optics.material.ior, 1.77);
  assert.deepEqual(records[1].document.facets, document.facets);
  assert.deepEqual(Object.keys(records[1]).sort(), ["document", "id", "savedAt"]);
  assert.equal(store.read("missing"), null);
  assert.equal(records[1].document.metadata.optics.view, undefined);
  store.remove("second");
  assert.equal(store.list().records.length, 1);
  assert.equal(store.read("first").document.name, "蓝宝石设计");
});

test("unreadable recovery records do not hide valid records or get silently deleted", () => {
  const storage = memoryStorage();
  const store = createLocalRecoveryStore(storage);
  storage.setItem("opengemcutting:recovery:v1:broken", "{");
  store.save("valid", createWorkbenchDocument("有效设计"), 20);
  assert.equal(store.list().unreadableCount, 1);
  assert.equal(store.list().records.length, 1);
  assert.equal(storage.getItem("opengemcutting:recovery:v1:broken"), "{");
});

test("storage quota failures propagate rather than claim a successful backup", () => {
  const store = createLocalRecoveryStore({ setItem() { throw new Error("QuotaExceededError"); } });
  assert.throws(() => store.save("full", createWorkbenchDocument()), /QuotaExceededError/);
});

test("OpenGemCutting recovery leaves other same-origin applications' records untouched", () => {
  const storage = memoryStorage();
  const foreignKey = "another-app:recovery:v1:shared-id";
  storage.setItem(foreignKey, "another application's backup");
  const store = createLocalRecoveryStore(storage);
  store.save("shared-id", createWorkbenchDocument("公开版设计"), 100);
  assert.deepEqual(store.list().records.map((record) => record.document.name), ["公开版设计"]);
  assert.equal(store.list().unreadableCount, 0);
  store.remove("shared-id");
  assert.equal(storage.getItem(foreignKey), "another application's backup");
  assert.equal(store.list().records.length, 0);
});
