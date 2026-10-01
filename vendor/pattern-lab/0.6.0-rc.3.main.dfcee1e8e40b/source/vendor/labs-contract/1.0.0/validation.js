import { normalizeIndexGear, facetIndexForGear } from './indexing.js';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const positive = value => Number.isFinite(value) && value > 0;
const issue = (errors, path, message) => errors.push({ path, message });

/** JSON extensions are data, never executable code or merge instructions. */
function jsonData(value, path, errors, ancestors = new Set()) {
  if (value === null || ['string', 'boolean'].includes(typeof value) || Number.isFinite(value)) return;
  if (!object(value) && !Array.isArray(value) || ancestors.has(value)) {
    issue(errors, path, 'must contain finite, acyclic JSON data'); return;
  }
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    issue(errors, path, 'must contain plain JSON objects'); return;
  }
  ancestors.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) issue(errors, `${path}.${key}`, 'unsafe extension key');
    else jsonData(child, `${path}.${key}`, errors, ancestors);
  }
  ancestors.delete(value);
}

export function validateDocumentHeader(document) {
  const errors = [];
  if (!object(document)) return [{ path: '$', message: 'document must be an object' }];
  const version = document.schemaVersion === 3 ? 3 : document.stock?.kind === 'mesh' ? 2 : 1;
  if (typeof document.$schema !== 'string' || !document.$schema.endsWith(`/document-v${version}.schema.json`))
    issue(errors, '$.$schema', 'schema id must match its supported document version');
  if (document.schemaVersion !== version) issue(errors, '$.schemaVersion', 'unsupported schema version');
  if (document.kind !== 'facet-96-document') issue(errors, '$.kind', 'must equal facet-96-document');
  if (typeof document.name !== 'string' || !document.name.trim()) issue(errors, '$.name', 'must be a non-empty string');
  return errors;
}

/** This validation is also called by the host's full document validator. */
export function validateDocumentExtensions(document) {
  const errors = [];
  const entries = [[document, '$'], [document.stock, '$.stock'], [document.cuttingReference, '$.cuttingReference'],
    ...(Array.isArray(document.facets) ? document.facets.map((f, i) => [f, `$.facets[${i}]`]) : [])];
  for (const [entry, path] of entries) {
    if (!entry) continue;
    if (entry.extensions !== undefined) {
      const extensions = entry.extensions;
      if (!object(extensions)) issue(errors, `${path}.extensions`, 'must be a namespaced object');
      else {
        jsonData(extensions, `${path}.extensions`, errors);
        for (const [name, extension] of Object.entries(extensions)) {
          if (!object(extension) || !Number.isInteger(extension.version) || extension.version < 1 || typeof extension.required !== 'boolean')
            issue(errors, `${path}.extensions.${name}`, 'must declare version and required');
          else if (extension.required) issue(errors, `${path}.extensions.${name}`, 'unsupported required extension; preserve the source and reject');
        }
      }
    }
    if (entry.metadata !== undefined) {
      if (!object(entry.metadata)) issue(errors, `${path}.metadata`, 'must be a JSON object');
      else jsonData(entry.metadata, `${path}.metadata`, errors);
    }
    const finish = entry.metadata?.surfaceFinish;
    if (finish !== undefined && (!object(finish) || finish.version !== 1 || finish.model !== 'ggx-dielectric'
      || !['polished', 'frosted'].includes(finish.state) || !Number.isFinite(finish.alpha)
      || (finish.state === 'polished' ? finish.alpha !== 0 : finish.alpha < 0.001 || finish.alpha > 1)
      || (finish.scatter !== undefined && (!Number.isFinite(finish.scatter) || finish.scatter < 0 || finish.scatter > 1))))
      issue(errors, `${path}.metadata.surfaceFinish`, 'must describe a supported version 1 surface finish');
  }
  const scale = document.metadata?.physicalScale;
  if (scale !== undefined && (!object(scale) || !positive(scale.millimetersPerModelUnit)))
    issue(errors, '$.metadata.physicalScale', 'millimetersPerModelUnit must be positive');
  const sourceScale = document.stock?.source?.millimetersPerModelUnit;
  if (sourceScale !== undefined && !positive(sourceScale)) issue(errors, '$.stock.source.millimetersPerModelUnit', 'must be positive');
  if (scale && sourceScale !== undefined && scale.millimetersPerModelUnit !== sourceScale)
    issue(errors, '$.metadata.physicalScale', 'must agree with physical stock scale');
  const recipe = document.metadata?.labRecipe;
  if (recipe !== undefined && (!object(recipe) || recipe.version !== 1 || typeof recipe.labId !== 'string'
    || typeof recipe.moduleVersion !== 'string' || typeof recipe.geometryKey !== 'string'
    || !['current', 'stale'].includes(recipe.status)))
    issue(errors, '$.metadata.labRecipe', 'must declare version, labId, moduleVersion, geometryKey and current/stale status');
  return errors;
}

export function millimetersPerModelUnit(document) {
  return document.metadata?.physicalScale?.millimetersPerModelUnit ?? document.stock?.source?.millimetersPerModelUnit ?? null;
}

/** Capability preflight, NOT a replacement for the host geometry validator.
 * Accept canonical documents; the host importer handles legacy omissions first.
 * Reject even disabled unsupported tools: their saved data is still meaningful.
 */
export function inspectLabDocument(document) {
  const errors = validateDocumentHeader(document);
  if (!object(document)) return { supported: false, errors };
  errors.push(...validateDocumentExtensions(document));
  if (document.stock?.kind !== 'cube') issue(errors, '$.stock', 'planar laboratory requires cube stock; mesh must remain intact');
  if (document.cuttingReference && document.cuttingReference.kind !== 'cube')
    issue(errors, '$.cuttingReference', 'planar laboratory requires a cube cutting reference');
  if (document.concaveCuts !== undefined && (!Array.isArray(document.concaveCuts) || document.concaveCuts.length))
    issue(errors, '$.concaveCuts', 'concave tools are unsupported, including disabled tools');
  try {
    const gear = normalizeIndexGear(document.indexGear);
    if (gear.zeroAlias !== document.indexGear?.zeroAlias || Math.abs(gear.degreesPerTooth - document.indexGear?.degreesPerTooth) > 1e-9
      || !Number.isFinite(document.indexGear?.degreesPerTooth)) throw new Error();
  } catch { issue(errors, '$.indexGear', 'must describe an integer-tooth gear from 1 to 360'); }
  if (!Array.isArray(document.facets)) issue(errors, '$.facets', 'must be an array');
  else for (const [i, facet] of document.facets.entries()) {
    try {
      facetIndexForGear(facet);
      if (!Number.isFinite(facet.plane.offset) || facet.plane.keep !== 'less-than-or-equal') throw new Error();
    } catch { issue(errors, `$.facets[${i}].plane`, 'must contain a finite clipping plane with the supported keep direction'); }
  }
  return { supported: errors.length === 0, errors };
}

const stable = value => Array.isArray(value) ? value.map(stable)
  : object(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;

/** Exact, portable comparison key; deliberately excludes gear readouts and name. */
export function labGeometryKey(document) {
  return JSON.stringify(stable({ stock: document.stock, reference: document.cuttingReference ?? document.stock,
    scale: millimetersPerModelUnit(document), concaveCuts: document.concaveCuts ?? [],
    facets: document.facets.map(f => ({ id: f.id, patternId: f.patternId, ordinal: f.ordinal, plane: f.plane })) }));
}

export function inspectLabRecipe(document) {
  const recipe = document.metadata?.labRecipe;
  if (!recipe) return null;
  return recipe.status === 'current' && recipe.geometryKey === labGeometryKey(document)
    ? { status: 'current', reason: null }
    : { status: 'stale', reason: recipe.reason ?? 'geometry-changed' };
}

export function refreshLabRecipe(document) {
  const state = inspectLabRecipe(document);
  if (!state || state.status === document.metadata.labRecipe.status) return document;
  return { ...document, metadata: { ...document.metadata, labRecipe: { ...document.metadata.labRecipe, ...state } } };
}
