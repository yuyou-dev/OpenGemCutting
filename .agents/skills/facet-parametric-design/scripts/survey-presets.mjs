import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { importFacetingJSON } from '../../../../src/domain/faceting.js';
import { buildConstructionStages } from '../../../../src/domain/constructionHistory.js';

// Read only: count final logical CUT planes, never rough patches or triangles.
const root = new URL('../../../../public/presets/', import.meta.url);
const catalogText = await fs.readFile(new URL('catalog.json', root), 'utf8');
const catalog = JSON.parse(catalogText);
const rows = [];
for (const preset of catalog.presets) {
  const doc = importFacetingJSON(await fs.readFile(new URL(preset.document, root), 'utf8'));
  const stages = buildConstructionStages(doc);
  const solid = stages.at(-1).afterSolid;
  const effective = new Set(solid.faces.map(face => face.facetId ?? face.id));
  const facets = doc.facets.filter(facet => effective.has(facet.id));
  const regions = Object.fromEntries(['crown', 'girdle', 'pavilion'].map(region => [region, facets.filter(f => f.region === region).length]));
  const table = facets.filter(f => f.region === 'crown' && Math.abs(f.plane.normal.z - 1) < 1e-8).length;
  const culet = facets.filter(f => f.region === 'pavilion' && Math.abs(f.plane.normal.z + 1) < 1e-8).length;
  const tiers = Object.fromEntries(['crown', 'pavilion'].map(region => [region, new Set(facets.filter(f => f.region === region && f.industryAngleDeg > 0).map(f => f.patternId)).size]));
  rows.push({ id: preset.id, name: preset.name, shape: preset.shapeKey, document: preset.document, previews: preset.previews, stock: doc.stock.kind, total: facets.length, catalogTotal: preset.facetCount, nonGirdle: facets.length - regions.girdle, ...regions, table, culet, crownInclined: regions.crown - table, pavilionInclined: regions.pavilion - culet, tiers, source: preset.sourcePageUrl });
}
function distribution(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const quantile = q => {
    const index = (sorted.length - 1) * q, lo = Math.floor(index), t = index - lo;
    return sorted[lo] * (1 - t) + sorted[Math.ceil(index)] * t;
  };
  return { n: sorted.length, min: sorted[0], p25: quantile(.25), median: quantile(.5), p75: quantile(.75), max: sorted.at(-1) };
}
const fields = ['total', 'nonGirdle', 'crownInclined', 'pavilionInclined', 'girdle'];
const summarize = sample => Object.fromEntries(fields.map(key => [key, distribution(sample.map(row => row[key]))]));
const mismatches = rows.filter(row => row.total !== row.catalogTotal);
const result = {
  catalogSha256: createHash('sha256').update(catalogText).digest('hex'),
  quantiles: 'linear interpolation at (n-1)*q',
  count: rows.length, summary: summarize(rows),
  bands: { atMost34: rows.filter(r => r.nonGirdle <= 34).length, from45To100: rows.filter(r => r.nonGirdle >= 45 && r.nonGirdle <= 100).length },
  shapes: Object.fromEntries([...new Set(rows.map(r => r.shape))].sort().map(shape => [shape, summarize(rows.filter(r => r.shape === shape))])),
  stockKinds: [...new Set(rows.map(r => r.stock))], catalogMismatches: mismatches, rows,
};
console.log(JSON.stringify(result, null, 2));
if (mismatches.length) process.exitCode = 1;
