import {
  createWorkbenchDocument,
  ensureTableFacet,
} from '../domain/document.js';
import { importFacetingJSON } from '../domain/faceting.js';
import { assertFileBudget, assertDocumentImportBudget } from '../domain/importBudget.js';
import {
  createPresetStockDocument,
  STOCK_PRESETS,
} from '../domain/stockPresets.js';
import { inspectCrystalOBJ } from '../domain/stockGeometry.js';
import { designError } from './designOperations.js';

export async function projectDesign(args, library) {
  for (const text of [args.json, args.obj]) if (text !== undefined) assertFileBudget({ size: new TextEncoder().encode(text).length });
  const inputs = ['stockPresetId', 'presetId', 'json', 'obj'].filter(
    (key) => args[key] !== undefined,
  );
  if (inputs.length > 1)
    throw designError('INVALID_START', '新项目只能选择一种起点。');
  let document;
  if (args.stockPresetId) {
    const preset = STOCK_PRESETS.find((item) => item.id === args.stockPresetId);
    if (!preset) throw designError('PRESET_NOT_FOUND', '未找到初始晶体模板。');
    document = createPresetStockDocument(preset);
  } else if (args.presetId) {
    const preset = (await library.list()).find(
      (item) => item.id === args.presetId,
    );
    if (!preset) throw designError('PRESET_NOT_FOUND', '未找到琢型预设。');
    const raw = await library.load(preset);
    assertDocumentImportBudget(raw);
    document = ensureTableFacet(importFacetingJSON(JSON.stringify(raw)));
  } else if (args.json) {
    const raw = JSON.parse(args.json);
    assertDocumentImportBudget(raw);
    document = ensureTableFacet(importFacetingJSON(args.json));
  } else if (args.obj) {
    const result = inspectCrystalOBJ(args.obj, {
      unit: args.unit ?? 'unitless',
      upAxis: args.upAxis ?? 'z',
      fileName: args.name,
    });
    if (!result.document)
      throw designError('OBJ_INVALID', '初始晶体未通过正式预检。', result);
    document = result.document;
  } else document = createWorkbenchDocument(args.name);
  return { ...document, name: args.name };
}
