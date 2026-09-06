import assert from "node:assert/strict";
import test from "node:test";
import { createProjectStore } from "./projectLibrary.js";
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

test("projects retain identity, creation time and complete committed design while sorting by latest save", () => {
  const storage = memoryStorage();
  const firstTab = createProjectStore(storage);
  const secondTab = createProjectStore(storage);
  const document = createWorkbenchDocument("蓝宝石设计");
  document.metadata.optics = applyOpticalPreset(DEFAULT_OPTICS_SETTINGS, "sapphire");
  document.cutSession = { draft: { depth: 1 } };
  document.camera = { pitch: 2 };
  document.history = [{ type: "undo" }];
  firstTab.create(document, { id: "first", now: 100 });
  secondTab.create(createWorkbenchDocument("另一项目"), { id: "second", now: 200 });
  firstTab.save("first", { ...document, name: "改名后" }, 300);
  const { records } = firstTab.list();
  assert.deepEqual(records.map(({ id }) => id), ["first", "second"]);
  assert.equal(records[0].createdAt, 100);
  assert.equal(records[0].updatedAt, 300);
  assert.equal(records[0].document.name, "改名后");
  assert.deepEqual(records[0].document.facets, document.facets);
  assert.equal(records[0].document.metadata.optics.material.ior, 1.77);
  assert.equal(records[0].document.metadata.optics.view, undefined);
  for (const transient of ["cutSession", "camera", "history"]) assert.equal(records[0].document[transient], undefined);
  assert.ok(document.metadata.optics.view, "saving does not mutate the live document");
  assert.equal(secondTab.read("second").document.name, "另一项目");
  assert.equal(firstTab.read("missing"), null);
});

test("a stale tab cannot resurrect a deleted project or overwrite an existing identity on create", () => {
  const storage = memoryStorage();
  const store = createProjectStore(storage);
  const document = createWorkbenchDocument();
  store.create(document, { id: "one", now: 100 });
  assert.throws(() => store.create(document, { id: "one" }), /已存在/);
  store.remove("one");
  assert.throws(() => store.save("one", document), /已被删除/);
  assert.equal(store.list().records.length, 0);
});

test("unreadable projects remain untouched while valid designs stay available", () => {
  const storage = memoryStorage();
  const store = createProjectStore(storage);
  storage.setItem("opengemcutting:project:v1:broken", "{");
  storage.setItem("opengemcutting:project:v1:future", JSON.stringify({ schemaVersion: 2 }));
  store.create(createWorkbenchDocument(), { id: "valid" });
  assert.equal(store.list().records.length, 1);
  assert.equal(store.list().unreadableCount, 2);
  assert.equal(storage.getItem("opengemcutting:project:v1:broken"), "{");
});

test("quota and validation failures never replace a previously saved document", () => {
  const storage = memoryStorage();
  const store = createProjectStore(storage);
  store.create(createWorkbenchDocument("已保存"), { id: "one" });
  assert.throws(() => store.save("one", { name: "坏文档" }));
  const write = storage.setItem;
  storage.setItem = () => { throw new Error("QuotaExceededError"); };
  assert.throws(() => store.save("one", createWorkbenchDocument("尚未保存")), /QuotaExceededError/);
  assert.throws(() => store.create(createWorkbenchDocument(), { id: "two" }), /QuotaExceededError/);
  storage.setItem = write;
  assert.equal(store.read("one").document.name, "已保存");
  assert.equal(store.read("two"), null);
});

test("legacy recovery migrates once to stable projects, preserving source and later edits or deletion", () => {
  const storage = memoryStorage();
  const recovery = createLocalRecoveryStore(storage);
  const store = createProjectStore(storage);
  recovery.save("old/one", createWorkbenchDocument("旧设计"), 100);
  recovery.save("other", createWorkbenchDocument("另一个旧设计"), 200);
  storage.setItem("opengemcutting:recovery:v1:broken", "{");
  assert.equal(store.migrateLegacy().unreadableCount, 1);
  assert.deepEqual(store.list().records.map(({ id }) => id), ["legacy-other", "legacy-old%2Fone"]);
  assert.equal(store.read("legacy-old%2Fone").createdAt, 100);
  store.save("legacy-old%2Fone", createWorkbenchDocument("新编辑"), 300);
  recovery.save("old/one", createWorkbenchDocument("旧标签页继续写入"), 400);
  store.migrateLegacy();
  assert.equal(store.read("legacy-old%2Fone").document.name, "新编辑");
  store.remove("legacy-old%2Fone");
  store.migrateLegacy();
  assert.equal(store.read("legacy-old%2Fone"), null);
  assert.equal(recovery.read("old/one").document.name, "旧标签页继续写入");
  assert.equal(storage.getItem("opengemcutting:recovery:v1:broken"), "{");
});

test("an interrupted migration can retry without losing a source or overwriting a saved edit", () => {
  const storage = memoryStorage();
  const recovery = createLocalRecoveryStore(storage);
  const store = createProjectStore(storage);
  recovery.save("old", createWorkbenchDocument("旧设计"), 100);
  const write = storage.setItem;
  storage.setItem = (key, value) => {
    if (key.startsWith("opengemcutting:project-migration:")) throw new Error("QuotaExceededError");
    write(key, value);
  };
  assert.throws(() => store.migrateLegacy(), /QuotaExceededError/);
  assert.equal(store.read("legacy-old").document.name, "旧设计");
  store.save("legacy-old", createWorkbenchDocument("新编辑"), 200);
  storage.setItem = write;
  store.migrateLegacy();
  assert.equal(store.read("legacy-old").document.name, "新编辑");
  assert.equal(recovery.read("old").document.name, "旧设计");
  store.remove("legacy-old");
  store.migrateLegacy();
  assert.equal(store.list().records.length, 0);
});

test("a failed migration document write leaves the source eligible for retry", () => {
  const storage = memoryStorage();
  const recovery = createLocalRecoveryStore(storage);
  const store = createProjectStore(storage);
  recovery.save("old", createWorkbenchDocument("旧设计"), 100);
  const write = storage.setItem;
  storage.setItem = () => { throw new Error("QuotaExceededError"); };
  assert.throws(() => store.migrateLegacy(), /QuotaExceededError/);
  assert.equal(store.list().records.length, 0);
  storage.setItem = write;
  store.migrateLegacy();
  assert.equal(store.read("legacy-old").document.name, "旧设计");
});
