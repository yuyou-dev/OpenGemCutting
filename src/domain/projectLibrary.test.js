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
  storage.setItem("facet96:project:v1:broken", "{");
  storage.setItem("facet96:project:v1:future", JSON.stringify({ schemaVersion: 2 }));
  store.create(createWorkbenchDocument(), { id: "valid" });
  assert.equal(store.list().records.length, 1);
  assert.equal(store.list().unreadableCount, 2);
  assert.equal(storage.getItem("facet96:project:v1:broken"), "{");
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
  storage.setItem("facet96:recovery:v1:broken", "{");
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
  assert.equal(storage.getItem("facet96:recovery:v1:broken"), "{");
});

test("an interrupted migration can retry without losing a source or overwriting a saved edit", () => {
  const storage = memoryStorage();
  const recovery = createLocalRecoveryStore(storage);
  const store = createProjectStore(storage);
  recovery.save("old", createWorkbenchDocument("旧设计"), 100);
  const write = storage.setItem;
  storage.setItem = (key, value) => {
    if (key.startsWith("facet96:project-migration:")) throw new Error("QuotaExceededError");
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

async function meshProject() {
  const { createMeshDocument } = await import("./stockGeometry.js");
  const { uRough } = await import("./mesh/fixtures.js");
  const { resolveFacetPattern, createFacetingDocument } = await import("./faceting.js");
  const document = createMeshDocument({ mesh: uRough(), name: "凹晶体缓存验证" });
  const facets = resolveFacetPattern({ patternId: "C1", region: "crown", industryAngleDeg: 0, depth: 0.2, repeat: 1 }, { stock: document.stock });
  return createFacetingDocument({ ...document, facets });
}

test("cached records isolate mutable fields while sharing only the frozen mesh stock", async () => {
  const document = await meshProject();
  const store = createProjectStore(memoryStorage());
  const created = store.create(document, { id: "mesh", now: 100 });
  const originalName = document.name;
  const originalOffset = document.facets[0].plane.offset;
  assert.equal(created.document.stock, document.stock);
  assert.ok(Object.isFrozen(created.document.stock.mesh.faces[0]));
  assert.throws(() => { created.document.stock.mesh.vertices[0].x = 100; }, TypeError);
  created.document.name = "污染返回值";
  created.document.facets[0].plane.offset = 100;
  created.document.metadata.optics.material.ior = 10;
  created.document.indexGear.teeth = 12;
  document.name = "污染写入源";
  document.facets[0].plane.offset = 200;
  document.metadata.optics.material.ior = 20;
  const read = store.read("mesh");
  assert.equal(read.document.name, originalName);
  assert.equal(read.document.facets[0].plane.offset, originalOffset);
  assert.equal(read.document.indexGear.teeth, 96);
  assert.notEqual(read.document.metadata.optics.material.ior, 10);
  assert.notEqual(read.document.metadata.optics.material.ior, 20);
  assert.equal(read.document.metadata.optics.view, undefined);
  assert.equal(read.document.stock, created.document.stock);
  read.document.facets.length = 0;
  read.document.metadata.optics.material.ior = 30;
  const listed = store.list().records[0];
  assert.equal(listed.document.facets.length, 1);
  assert.notEqual(listed.document.metadata.optics.material.ior, 30);
  assert.equal(listed.document.stock, created.document.stock);
  // Cube stocks remain mutable independent copies, never cache-owned objects.
  const cube = store.create(createWorkbenchDocument(), { id: "cube" });
  cube.document.stock.center[0] = 100;
  assert.equal(store.read("cube").document.stock.center[0], 0);
});

test("exact stored bytes invalidate mesh cache across tabs and reject malformed external mesh or replay", async () => {
  const storage = memoryStorage();
  const first = createProjectStore(storage), second = createProjectStore(storage);
  const document = await meshProject();
  first.create(document, { id: "shared", now: 100 });
  const cold = second.read("shared");
  assert.notEqual(cold.document.stock, document.stock, "a different store validates storage on its first read");
  assert.equal(second.read("shared").document.stock, cold.document.stock, "unchanged bytes reuse the validated stock");
  first.save("shared", { ...document, name: "另一个标签页的更新" }, 200);
  const changed = second.read("shared");
  assert.equal(changed.document.name, "另一个标签页的更新");
  assert.notEqual(changed.document.stock, cold.document.stock);
  const key = "facet96:project:v1:shared";
  const validRaw = storage.getItem(key);
  const corrupt = JSON.parse(validRaw);
  corrupt.document.stock.mesh.faces[0][0] = 99999;
  const corruptRaw = JSON.stringify(corrupt);
  storage.setItem(key, corruptRaw);
  assert.throws(() => second.read("shared"));
  assert.throws(() => createProjectStore(storage).read("shared"));
  assert.equal(second.list().unreadableCount, 1);
  assert.equal(storage.getItem(key), corruptRaw, "unreadable external content remains untouched");
  const { resolveFacetPattern } = await import("./faceting.js");
  const erased = JSON.parse(validRaw);
  erased.document.facets = resolveFacetPattern({ patternId: "erase", region: "crown", industryAngleDeg: 0, depth: 20, repeat: 1 }, { stock: document.stock });
  storage.setItem(key, JSON.stringify(erased));
  assert.throws(() => second.read("shared"), error => error.errors?.some(entry => entry.path === "$.facets"));
  storage.setItem(key, validRaw);
  const restored = second.read("shared");
  assert.equal(restored.document.name, changed.document.name);
  assert.notEqual(restored.document.stock, changed.document.stock, "changed raw data requires fresh validation even after restoration");
  first.remove("shared");
  assert.equal(second.read("shared"), null);
  assert.throws(() => second.save("shared", document), /已被删除/);
});

test("failed mesh writes preserve the validated cache and successful retries return isolated records", async () => {
  const storage = memoryStorage();
  const store = createProjectStore(storage);
  const document = await meshProject();
  const previous = store.create(document, { id: "quota", now: 100 });
  const raw = storage.getItem("facet96:project:v1:quota");
  const write = storage.setItem;
  storage.setItem = () => { throw new Error("QuotaExceededError"); };
  assert.throws(() => store.save("quota", { ...document, name: "尚未落盘" }, 200), /QuotaExceededError/);
  assert.equal(storage.getItem("facet96:project:v1:quota"), raw);
  const retained = store.read("quota");
  assert.equal(retained.document.name, previous.document.name);
  assert.equal(retained.document.stock, previous.document.stock);
  storage.setItem = write;
  const saved = store.save("quota", { ...document, name: "重试成功" }, 300);
  saved.document.metadata.optics.material.ior = 99;
  const reread = store.read("quota");
  assert.equal(reread.document.name, "重试成功");
  assert.equal(reread.createdAt, 100);
  assert.equal(reread.updatedAt, 300);
  assert.notEqual(reread.document.metadata.optics.material.ior, 99);
});

test("revisions increment per save and a stale baseline is rejected without touching storage", () => {
  const storage = memoryStorage();
  const firstTab = createProjectStore(storage);
  const secondTab = createProjectStore(storage);
  const document = createWorkbenchDocument("原始名称");
  const created = firstTab.create(document, { id: "rev", now: 100 });
  assert.equal(created.revision, 1);

  const savedByFirst = firstTab.save("rev", { ...document, name: "第一页改名" }, { expectedRevision: 1, updatedAt: 200 });
  assert.equal(savedByFirst.revision, 2);
  const rawAfterFirst = storage.getItem("facet96:project:v1:rev");

  let staleError;
  assert.throws(
    () => secondTab.save("rev", { ...document, name: "第二页旧基线写入" }, { expectedRevision: 1, updatedAt: 300 }),
    (error) => { staleError = error; return error.code === "PROJECT_CONFLICT"; },
  );
  assert.match(staleError.message, /其他窗口/);
  assert.equal(storage.getItem("facet96:project:v1:rev"), rawAfterFirst, "conflict must not overwrite the newer record");
  assert.equal(secondTab.read("rev").document.name, "第一页改名");

  const latest = secondTab.read("rev");
  const savedBySecond = secondTab.save("rev", { ...latest.document, name: "基于最新版本" }, { expectedRevision: latest.revision, updatedAt: 400 });
  assert.equal(savedBySecond.revision, 3);
  assert.equal(firstTab.read("rev").revision, 3);
});

test("legacy records without a revision upgrade from baseline 0 on first save", () => {
  const storage = memoryStorage();
  const store = createProjectStore(storage);
  const document = createWorkbenchDocument("旧格式");
  store.create(document, { id: "legacy", now: 100 });
  const key = "facet96:project:v1:legacy";
  const legacyRaw = JSON.parse(storage.getItem(key));
  delete legacyRaw.revision;
  storage.setItem(key, JSON.stringify(legacyRaw));

  const record = createProjectStore(storage).read("legacy");
  assert.equal(record.revision, 0, "missing revision reads as baseline 0");
  const saved = store.save("legacy", { ...record.document, name: "升级后" }, { expectedRevision: 0, updatedAt: 200 });
  assert.equal(saved.revision, 1);
  assert.throws(
    () => createProjectStore(storage).save("legacy", document, { expectedRevision: 0 }),
    (error) => error.code === "PROJECT_CONFLICT",
  );
});

test("deletion takes precedence over revision checks and save without a baseline stays unconditional", () => {
  const storage = memoryStorage();
  const store = createProjectStore(storage);
  const document = createWorkbenchDocument();
  store.create(document, { id: "gone", now: 100 });
  store.remove("gone");
  assert.throws(
    () => store.save("gone", document, { expectedRevision: 1 }),
    (error) => error.code === "PROJECT_DELETED",
  );
  store.create(document, { id: "free", now: 100 });
  const saved = store.save("free", { ...document, name: "无基线写入" }, 200);
  assert.equal(saved.revision, 2, "legacy callers keep saving but revisions still advance");
});

test("write operations go through the injected lock manager when provided", async () => {
  const storage = memoryStorage();
  const acquired = [];
  const locks = { request: async (name, action) => { acquired.push(name); return action(); } };
  const store = createProjectStore(storage, { locks });
  const document = createWorkbenchDocument("加锁");
  store.create(document, { id: "locked", now: 100 });
  const saved = await store.save("locked", { ...document, name: "锁内写入" }, { expectedRevision: 1, updatedAt: 200 });
  assert.equal(saved.revision, 2);
  await store.remove("locked");
  assert.deepEqual(acquired, ["facet96:project-lock:locked", "facet96:project-lock:locked"]);
  assert.equal(store.read("locked"), null);
  await assert.rejects(
    store.save("locked", document, { expectedRevision: 2 }),
    (error) => error.code === "PROJECT_DELETED",
  );
});

test("a near-simultaneous cross-tab save loses the race instead of silently overwriting", async () => {
  const storage = memoryStorage();
  const firstTab = createProjectStore(storage);
  const secondTab = createProjectStore(storage);
  const document = createWorkbenchDocument("近同时写入");
  firstTab.create(document, { id: "race", now: 100 });
  const firstBaseline = firstTab.read("race");
  const secondBaseline = secondTab.read("race");
  firstTab.save("race", { ...firstBaseline.document, name: "A 先写" }, { expectedRevision: firstBaseline.revision, updatedAt: 200 });
  assert.throws(
    () => secondTab.save("race", { ...secondBaseline.document, name: "B 后写" }, { expectedRevision: secondBaseline.revision, updatedAt: 300 }),
    (error) => error.code === "PROJECT_CONFLICT",
  );
  assert.equal(secondTab.read("race").document.name, "A 先写");
});
