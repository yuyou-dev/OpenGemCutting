import { writeFile, mkdir } from 'node:fs/promises';
import { STOCK_PRESETS, presetStockOBJ } from '../src/domain/stockPresets.js';
const directory = new URL('../public/stock-presets/', import.meta.url);
await mkdir(directory, { recursive: true });
for (const preset of STOCK_PRESETS) await writeFile(new URL(`${preset.id}.obj`, directory), presetStockOBJ(preset));
