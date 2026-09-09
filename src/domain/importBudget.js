// Limits for new external files only. Existing project/JSON domain validation
// remains compatible; budgets are checked before expensive geometry work.
export const IMPORT_BUDGET = Object.freeze({ bytes: 20 * 1024 * 1024, cuts: 4096, meshVertices: 20000, meshFaces: 20000, objVertices: 4000 });
export function assertFileBudget(file) {
  if (file.size > IMPORT_BUDGET.bytes) throw new Error("文件超过 20 MiB 导入上限，请先简化或拆分设计；当前项目未改变。");
}
export function assertDocumentImportBudget(raw) {
  if (raw?.facets?.length > IMPORT_BUDGET.cuts) throw new Error("新导入设计最多包含 4096 个 CUT 平面，请先精简工序。");
  if (raw?.stock?.mesh?.vertices?.length > IMPORT_BUDGET.meshVertices || raw?.stock?.mesh?.faces?.length > IMPORT_BUDGET.meshFaces) throw new Error("新导入晶体 JSON 最多包含 20000 个顶点与 20000 个面片，请先简化初始晶体。");
}
