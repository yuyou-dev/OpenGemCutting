import assert from "node:assert/strict";
import test from "node:test";
import { createProjectStore } from "./projectLibrary.js";
import { createLocalRecoveryStore } from "./localRecovery.js";
import { createWorkbenchDocument } from "./document.js";
import { applyOpticalPreset, DEFAULT_OPTICS_SETTINGS } from "./optics.js";
import { createFacetingDocument, exportFacetingJSON, resolveFacetPattern, getCuttingReference } from "./faceting.js";
import { evaluateDocument } from "./documentGeometry.js";
import { createCenteredCube, measurePolyhedron } from "./geometry.js";
import { createMeshDocument } from "./stockGeometry.js";

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

function referenceProject({ legacy = false } = {}) {
  const mesh = createMeshDocument({ mesh: createCenteredCube(3), unit: "mm" });
  delete mesh.metadata.optics.view;
  const { cuttingReference, concaveCuts, ...oldDocument } = mesh;
  const blank = legacy ? { ...oldDocument, schemaVersion: 2 } : mesh;
  return createFacetingDocument({
    ...blank,
    facets: resolveFacetPattern({
      patternId: "C1", region: "crown", baseIndex: 12,
      industryAngleDeg: 35, depth: 0.3, repeat: 1,
    }, { stock: getCuttingReference(blank) }),
  });
}

function assertSameDesign(actual, expected) {
  assert.deepEqual(actual.cuttingReference, expected.cuttingReference);
  assert.deepEqual(actual.stock, expected.stock);
  assert.deepEqual(actual.facets, expected.facets);
  assert.ok(Math.abs(measurePolyhedron(evaluateDocument(actual)).volume -
    measurePolyhedron(evaluateDocument(expected)).volume) < 1e-12);
  assert.equal(exportFacetingJSON(actual), exportFacetingJSON(expected));
}

test("fixed cutting coordinates survive create, save and cold project reads without changing planes or volume", () => {
  const storage = memoryStorage();
  const store = createProjectStore(storage);
  const document = referenceProject();
  assert.notDeepEqual(document.cuttingReference, document.stock);
  const created = store.create(document, { id: "fixed", now: 100 });
  assertSameDesign(created.document, document);
  assertSameDesign(JSON.parse(storage.getItem("facet96:project:v1:fixed")).document, document);
  // Returned coordinates belong to the caller, never the cache.
  created.document.cuttingReference.center[0] = 99;
  assertSameDesign(store.read("fixed").document, document);
  const updated = { ...document, name: "fixed coordinates after save" };
  const saved = store.save("fixed", updated, { expectedRevision: 1, updatedAt: 200 });
  assert.equal(saved.revision, 2);
  assertSameDesign(saved.document, updated);
  const cold = createProjectStore(storage);
  assertSameDesign(cold.read("fixed").document, updated);
  assertSameDesign(cold.list().records[0].document, updated);
  assert.equal(cold.list().unreadableCount, 0);
});

test("fixed coordinates survive starter seeding and legacy recovery migration without modifying the backup", () => {
  const document = referenceProject();
  const seeded = memoryStorage();
  createProjectStore(seeded).seedStarterProjects([document]);
  assertSameDesign(createProjectStore(seeded).list().records[0].document, document);
  const storage = memoryStorage();
  createLocalRecoveryStore(storage).save("fixed", document, 100);
  const backup = storage.getItem("facet96:recovery:v1:fixed");
  createProjectStore(storage).migrateLegacy();
  assertSameDesign(createProjectStore(storage).read("legacy-fixed").document, document);
  assert.equal(storage.getItem("facet96:recovery:v1:fixed"), backup);
});

test("old mesh projects without a cutting reference retain their original coordinate interpretation", () => {
  const document = referenceProject({ legacy: true });
  assert.equal(document.schemaVersion, 2);
  assert.equal(document.cuttingReference, undefined);
  const storage = memoryStorage();
  const store = createProjectStore(storage);
  store.create(document, { id: "legacy-mesh" });
  store.save("legacy-mesh", document);
  assertSameDesign(createProjectStore(storage).read("legacy-mesh").document, document);
});

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

test("starter projects initialize once and never return after deletion", () => {
  const storage = memoryStorage();
  const store = createProjectStore(storage);
  const documents = [createWorkbenchDocument("Cushion"), createWorkbenchDocument("Emerald")];
  assert.equal(store.needsStarterProjects(), true);
  store.seedStarterProjects(documents);
  assert.equal(store.list().records.length, 2);
  store.seedStarterProjects(documents);
  assert.equal(store.list().records.length, 2);
  for (const record of store.list().records) store.remove(record.id);
  const reopened = createProjectStore(storage);
  reopened.seedStarterProjects(documents);
  assert.equal(reopened.list().records.length, 0);
});

test("existing, unreadable and newly created projects prevent starter insertion", () => {
  for (const kind of ["existing", "unreadable", "created-during-load"]) {
    const storage = memoryStorage();
    const store = createProjectStore(storage);
    if (kind === "created-during-load") assert.equal(store.needsStarterProjects(), true);
    if (kind === "unreadable") storage.setItem("facet96:project:v1:broken", "{");
    else store.create(createWorkbenchDocument("Mine"));
    store.seedStarterProjects([createWorkbenchDocument("Example")]);
    const listing = store.list();
    assert.equal(listing.records.length + listing.unreadableCount, 1);
    assert.equal(store.needsStarterProjects(), false);
  }
});

test("starter load failure can retry without creating placeholders", () => {
  const storage = memoryStorage();
  const store = createProjectStore(storage);
  const setItem = storage.setItem;
  storage.setItem = () => { throw new Error("quota"); };
  assert.throws(() => store.seedStarterProjects([createWorkbenchDocument("Example")]), /quota/);
  storage.setItem = setItem;
  assert.equal(store.needsStarterProjects(), true);
  store.seedStarterProjects([createWorkbenchDocument("Example")]);
  assert.equal(store.list().records.length, 1);
});

function machiningProject() {
  return createFacetingDocument({
    name: '五次对称凹切保存', indexGear: 120,
    facets: resolveFacetPattern({ patternId: 'five', region: 'girdle', industryAngleDeg: 90, depth: 0.1, indexTeeth: 120, baseIndex: 0.5, repeat: 5 }),
    concaveCuts: [
      { id: 'scoop', type: 'sphere', position: [0.9, 0, 0], radius: 0.3, segments: 16 },
      { id: 'disabled-scoop', type: 'sphere', position: [0, 0.9, 0], radius: 0.2, segments: 16, enabled: false },
    ],
  });
}

test('schema v3 autosave and cold startup preserve all three groups, fractional gears and revision safety', () => {
  const storage = memoryStorage();
  const first = createProjectStore(storage);
  const document = machiningProject();
  const created = first.create(document, { id: 'machining', now: 100 });
  assert.equal(created.document.schemaVersion, 3);
  assert.deepEqual(created.document.concaveCuts, document.concaveCuts);
  assert.ok(Object.isFrozen(created.document.concaveCuts));
  assert.throws(() => { created.document.concaveCuts[0].radius = 10; }, TypeError);
  const reopenedStore = createProjectStore(storage);
  const reopened = reopenedStore.list().records[0];
  assert.equal(reopenedStore.list().unreadableCount, 0);
  assert.equal(exportFacetingJSON(reopened.document), exportFacetingJSON(document));
  assert.equal(reopened.document.indexGear.teeth, 120);
  assert.equal(reopened.document.facets[0].baseIndex, 0.5);
  const baselineVolume = measurePolyhedron(evaluateDocument(document)).volume;
  assert.ok(Math.abs(measurePolyhedron(evaluateDocument(reopened.document)).volume - baselineVolume) < 1e-9);

  const changed = createFacetingDocument({ ...reopened.document, concaveCuts: reopened.document.concaveCuts.map((cut) => cut.id === 'scoop' ? { ...cut, radius: 0.35 } : cut) });
  const saved = first.save('machining', changed, { expectedRevision: reopened.revision, updatedAt: 200 });
  assert.equal(saved.revision, 2);
  const bytes = storage.getItem('facet96:project:v1:machining');
  assert.throws(() => reopenedStore.save('machining', document, { expectedRevision: reopened.revision }), (error) => error.code === 'PROJECT_CONFLICT');
  assert.equal(storage.getItem('facet96:project:v1:machining'), bytes);
  const cold = createProjectStore(storage).read('machining');
  assert.equal(cold.revision, 2);
  assert.equal(cold.document.concaveCuts[0].radius, 0.35);
  assert.equal(cold.document.concaveCuts[1].enabled, false);
  assert.deepEqual(cold.document.facets, document.facets);
  assert.deepEqual(cold.document.stock, document.stock);
  assert.ok(measurePolyhedron(evaluateDocument(cold.document)).volume < baselineVolume);

  const withoutTools = createFacetingDocument({ ...cold.document, concaveCuts: [] });
  first.save('machining', withoutTools, { expectedRevision: cold.revision, updatedAt: 300 });
  const emptyGroup = createProjectStore(storage).read('machining');
  assert.equal(emptyGroup.revision, 3);
  assert.equal(emptyGroup.document.schemaVersion, 3);
  assert.deepEqual(emptyGroup.document.concaveCuts, []);
  assert.equal(exportFacetingJSON(emptyGroup.document), exportFacetingJSON(withoutTools));
});

test('legacy recovery and migration carry extended groups without altering the source record', () => {
  const storage = memoryStorage();
  const recovery = createLocalRecoveryStore(storage);
  const document = machiningProject();
  recovery.save('extended', document, 100);
  const recoveryBytes = storage.getItem('facet96:recovery:v1:extended');
  assert.equal(exportFacetingJSON(createLocalRecoveryStore(storage).read('extended').document), exportFacetingJSON(document));
  const projects = createProjectStore(storage);
  projects.migrateLegacy();
  const migrated = createProjectStore(storage).read('legacy-extended');
  assert.equal(exportFacetingJSON(migrated.document), exportFacetingJSON(document));
  assert.equal(migrated.revision, 1);
  assert.equal(storage.getItem('facet96:recovery:v1:extended'), recoveryBytes);
});

test('invalid combined machining is rejected before save and remains unreadable without data deletion at cold startup', () => {
  const storage = memoryStorage();
  const store = createProjectStore(storage);
  store.create(machiningProject(), { id: 'protected', now: 100 });
  const key = 'facet96:project:v1:protected';
  const previous = storage.getItem(key);
  const invalid = createFacetingDocument({
    facets: resolveFacetPattern({ patternId: 'core', region: 'girdle', industryAngleDeg: 90, depth: 0.9, repeat: 4 }),
    concaveCuts: [{ id: 'drill', type: 'cylinder', position: [0, 0, 0], axis: [0, 0, 1], radius: 0.3, length: 4, segments: 16 }],
  });
  assert.throws(() => store.save('protected', invalid, { expectedRevision: 1 }), { code: 'empty-document-result' });
  assert.equal(storage.getItem(key), previous);
  const damaged = JSON.stringify({ ...JSON.parse(previous), document: invalid });
  storage.setItem(key, damaged);
  const cold = createProjectStore(storage);
  assert.throws(() => cold.read('protected'), { code: 'empty-document-result' });
  assert.equal(cold.list().unreadableCount, 1);
  assert.equal(storage.getItem(key), damaged);
  const recoveryKey = 'facet96:recovery:v1:invalid-tools';
  const recoveryBytes = JSON.stringify({ schemaVersion: 1, savedAt: 100, document: invalid });
  storage.setItem(recoveryKey, recoveryBytes);
  assert.equal(createLocalRecoveryStore(storage).list().unreadableCount, 1);
  assert.equal(storage.getItem(recoveryKey), recoveryBytes);
});

test('optional surface metadata survives JSON and project reload for every supported gear without changing geometry', () => {
  for (const teeth of [96, 99, 120, 360]) {
    const plain = createFacetingDocument({ indexGear:teeth, facets:resolveFacetPattern({patternId:'surface-tier', region:'crown', industryAngleDeg:35, depth:.5, repeat:4, baseIndex:.25, indexTeeth:teeth}) });
    const document = structuredClone(plain);
    document.facets[0].metadata = {surfaceFinish:{version:1,model:'ggx-dielectric',state:'frosted',alpha:.28,scatter:.15}};
    const storage = memoryStorage(), store = createProjectStore(storage);
    const saved = store.create(document);
    const reloaded = createProjectStore(storage).read(saved.id).document;
    assert.deepEqual(reloaded.facets, document.facets);
    assert.equal(JSON.parse(exportFacetingJSON(reloaded)).facets[0].metadata.surfaceFinish.state, 'frosted');
    assert.deepEqual(evaluateDocument(reloaded), evaluateDocument(plain));
    assert.equal(plain.facets[0].metadata?.surfaceFinish, undefined);
  }
});
