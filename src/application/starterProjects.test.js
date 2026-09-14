import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPresetLibrary, createStaticPresetProvider } from '../domain/presetLibrary.js';
import { loadStarterProjects, STARTER_PRESET_IDS } from './starterProjects.js';
import { buildConstructionStages } from '../domain/constructionHistory.js';

test('starter designs load real curated documents with names, source metadata and complete geometry', async () => {
  const library = createPresetLibrary([createStaticPresetProvider({
    fetcher: async (url) => ({ ok: true, json: async () => JSON.parse(await readFile(new URL(`../../public${url}`, import.meta.url), 'utf8')) }),
  })]);
  const catalog = await library.list();
  const documents = await loadStarterProjects(library);
  assert.equal(documents.length, 2);
  for (const [index, document] of documents.entries()) {
    const preset = catalog.find((item) => item.id === STARTER_PRESET_IDS[index]);
    const original = await library.load(preset);
    assert.equal(document.name, preset.name);
    assert.deepEqual(document.metadata, original.metadata);
    assert.ok(document.facets.length > 10);
    assert.equal(buildConstructionStages(document).at(-1).afterSolid.faces.length, preset.facetCount);
  }
});
