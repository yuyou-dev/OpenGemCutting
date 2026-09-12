import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTranslator, english, resolveLocale } from './format.js';
import { initializeLocale, setLanguagePreference, getLocale, getLanguagePreference, subscribeLocale, LANGUAGE_STORAGE_KEY } from './locale.js';
import { createWorkbenchDocument } from '../domain/document.js';
import { exportFacetingJSON } from '../domain/faceting.js';
import { createFacetReportModel } from '../report/pdfReport.js';
import { buildConstructionStages } from '../domain/constructionHistory.js';
import { measurePolyhedron } from '../domain/geometry.js';

test('language resolution follows explicit preference, then browser language, with English fallback', () => {
  assert.equal(resolveLocale('system', ['zh-TW', 'en']), 'zh-CN');
  assert.equal(resolveLocale('system', ['fr-FR', 'zh-CN']), 'en');
  assert.equal(resolveLocale('en', ['zh-CN']), 'en');
  assert.equal(resolveLocale('zh-CN', ['en']), 'zh-CN');
  assert.equal(resolveLocale('system', []), 'en');
});
test('all translated sentences retain exactly their parameter slots', () => {
  const slots = value => [...value.matchAll(/\{\d+\}/g)].map(match => match[0]).sort();
  for (const [source, translated] of Object.entries(english)) {
    assert.ok(translated.trim(), source);
    assert.deepEqual(slots(translated), slots(source), source);
    assert.doesNotMatch(translated, /[\u3400-\u9fff]/, source);
  }
});
test('explicit message slots preserve arbitrary project names and do not reinterpret inserted syntax', () => {
  const t = createTranslator('en');
  assert.equal(t('{0}的轴测预览', ['未命名切型 01']), '未命名切型 01 axonometric preview');
  assert.equal(t('重命名 {0}', ['冠部 {1}']), 'Rename 冠部 {1}');
  assert.equal(t('角度“32”必须位于 -90° 到 90°。'), 'Angle “32” must be between -90° and 90°.');
  assert.equal(t('Unknown diagnostic'), 'Unknown diagnostic');
});
test('language persists independently of design and still works when storage is unavailable', () => {
  const data = new Map();
  const storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) };
  const document = createWorkbenchDocument('冠部');
  const json = exportFacetingJSON(document);
  initializeLocale({ storage, browserLanguages: ['en-US'] });
  let calls = 0; const unsubscribe = subscribeLocale(() => calls++);
  setLanguagePreference('zh-CN', storage);
  assert.equal(data.get(LANGUAGE_STORAGE_KEY), 'zh-CN');
  initializeLocale({ storage, browserLanguages: ['en-US'] });
  assert.equal(getLocale(), 'zh-CN');
  const unavailable = { getItem() { throw Error('denied'); }, setItem() { throw Error('quota'); } };
  initializeLocale({ storage: unavailable, browserLanguages: ['en-US'] });
  setLanguagePreference('zh-CN', unavailable);
  assert.equal(getLanguagePreference(), 'zh-CN');
  assert.equal(exportFacetingJSON(document), json);
  assert.ok(calls >= 3);
  unsubscribe();
});
test('English report preserves geometry, numerical fields and user names', () => {
  const document = createWorkbenchDocument('冠部');
  const solid = buildConstructionStages(document).at(-1).afterSolid;
  const input = { document, solid, metrics: measurePolyhedron(solid), generatedAt: new Date('2026-09-12T00:00:00Z') };
  const zh = createFacetReportModel({ ...input, locale: 'zh-CN' });
  const en = createFacetReportModel({ ...input, locale: 'en' });
  assert.equal(en.name, '冠部');
  assert.equal(en.regions.find(region => region.id === 'crown').label, 'CROWN');
  assert.deepEqual(en.regions.map(region => region.rows), zh.regions.map(region => region.rows));
  assert.equal(en.effectiveFacetCount, zh.effectiveFacetCount);
  assert.deepEqual(en.bounds, zh.bounds);
});
test('terminology review data retains provenance and does not claim specialist approval', () => {
  const { terms } = JSON.parse(readFileSync(new URL('./terminology.json', import.meta.url)));
  assert.equal(new Set(terms.map(term => term.id)).size, terms.length);
  for (const term of terms) {
    assert.ok(term.zh && term.en && term.context && term.source);
    assert.equal(term.reviewStatus, 'pending-specialist-review');
  }
  assert.notEqual(terms.find(term => term.id === 'cut-depth').en, terms.find(term => term.id === 'pavilion-depth').en);
});
