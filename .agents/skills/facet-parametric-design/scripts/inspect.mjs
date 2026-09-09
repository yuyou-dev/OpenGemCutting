import fs from 'node:fs/promises';
import { importFacetingJSON, exportFacetingJSON, resolveFacetPattern } from '../../../../src/domain/faceting.js';
import { buildConstructionStages } from '../../../../src/domain/constructionHistory.js';
import { validateMeshSolid } from '../../../../src/domain/mesh/index.js';
import { inspectTopology } from './topology.mjs';
import { inspectPresetPolyhedron } from '../../../../src/domain/presetQuality.js';

const path = process.argv[2];
if (!path) throw new Error('Usage: node inspect.mjs design.json [reference-topology.json]');
const doc = importFacetingJSON(await fs.readFile(path, 'utf8'));
const stages = buildConstructionStages(doc);
const solid = stages.at(-1)?.afterSolid;
if (!solid) throw new Error('No committed CUT stages to inspect');
function geometryIssues(s) {
  if (s.kind !== 'mesh') return inspectPresetPolyhedron(s).issues;
  try { validateMeshSolid(s); return []; }
  catch (error) { return [{ code: 'INVALID_MESH', message: error.message }]; }
}
const plan = process.argv[3] ? JSON.parse(await fs.readFile(process.argv[3], 'utf8')) : null;
const topology = inspectTopology(solid, plan);
const roundtrip = buildConstructionStages(importFacetingJSON(exportFacetingJSON(doc))).at(-1).afterSolid;
const byId = new Map(doc.facets.map(f => [f.id, f]));
const dimensions = Object.fromEntries(['x', 'y', 'z'].map(k => [k, Math.max(...solid.vertices.map(p => p[k])) - Math.min(...solid.vertices.map(p => p[k]))]));
const planeError = (a, b) => Math.max(Math.abs(a.offset - b.offset), ...['x', 'y', 'z'].map(k => Math.abs(a.normal[k] - b.normal[k])));
const groups = stages.map(stage => {
  const first = stage.facets[0];
  const generated = first.metadata?.patternMode === 'arbitrary' ? null : resolveFacetPattern(first, { stock: doc.stock });
  const orbitMatches = generated === null ? null : generated.length === stage.facets.length && generated.every(f => stage.facets.some(g => g.index === f.index && planeError(f.plane, g.plane) < 1e-7));
  return { name: first.label, repeat: first.repeat, mirror: first.mirror, angle: first.industryAngleDeg, members: stage.facets.length, finalFaces: solid.faces.filter(f => stage.facets.some(g => g.id === f.facetId || g.id === f.id)).length, orbitMatches, meet: stage.construction?.status ?? null };
});
const flatBottom = solid.faces.filter(f => {
  const facet = byId.get(f.facetId ?? f.id);
  return facet?.region === 'pavilion' && Math.abs(facet.plane.normal.z + 1) < 1e-8;
}).map(f => ({ vertices: f.vertexIndices.length, z: solid.vertices[f.vertexIndices[0]].z }));
const result = { name: doc.name, stock: doc.stock.kind, groups: groups.length, effectiveCutPlanes: new Set(solid.faces.map(f => f.facetId ?? f.id).filter(id => byId.has(id))).size, surfacePieces: solid.faces.length, dimensions, heightToWidth: dimensions.z / dimensions.x, flatBottom, geometryIssues: geometryIssues(solid), roundtripIssues: geometryIssues(roundtrip), topology, patterns: groups };
console.log(JSON.stringify(result, null, 2));
if (topology.status !== 'passed' || result.geometryIssues.length || result.roundtripIssues.length || groups.some(g => g.orbitMatches === false || (g.meet && g.meet !== 'valid'))) process.exitCode = 1;
