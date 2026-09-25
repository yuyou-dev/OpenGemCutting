import { createFacetingDocument, resolveFacetPattern, resolveFacet, withDocumentIndexGear } from '../domain/faceting.js';
import { createCenteredCube } from '../domain/geometry.js';
import { labGeometryKey } from '../domain/labsContract/index.js';
import { buildConstructionStages } from '../domain/constructionHistory.js';
import { enumerateTopologyVertices, solveVertexMeet } from '../domain/meetJump.js';

function meetSample() {
  const source = resolveFacetPattern({ patternId: 'meet-source', region: 'pavilion', baseIndex: 0, repeat: 4, industryAngleDeg: 41, depth: .42 });
  const document = createFacetingDocument({ facets: source });
  const solid = buildConstructionStages(document)[0].afterSolid;
  const target = enumerateTopologyVertices(solid).find(v => v.sourceOperationIds.includes('meet-source'));
  const params = { patternId: 'meet-crown', region: 'crown', baseIndex: 6, repeat: 4, industryAngleDeg: 32, depth: .1 };
  const primary = resolveFacetPattern(params).find(f => f.index === 6);
  const solved = solveVertexMeet({ normal: primary.plane.normal, target, stock: document.stock });
  return createFacetingDocument({ facets: [...source, ...resolveFacetPattern({ ...params, depth: solved.depth,
    metadata: { patternMode: 'symmetric', construction: { type: 'vertex-meet', solverVersion: 1, target } } })] });
}

/** Fixed authored parameters resolved by the real host API, never a demo solver. */
export function createLabContractSamples() {
  const make = (teeth, repeat, baseIndex = 0, extra = {}) => {
    const reference = extra.cuttingReference ?? extra.stock;
    const tier = (patternId, region, industryAngleDeg, depth, count = repeat) => resolveFacetPattern({
      patternId, region, industryAngleDeg, depth, repeat: count, baseIndex: count === 1 ? 0 : baseIndex,
      indexTeeth: teeth, metadata: { patternMode: 'symmetric', source: { author: 'Facet host contract fixture', role: patternId } },
    }, reference ? { stock: reference } : {});
    return createFacetingDocument({ name: `Contract ${teeth} / ${repeat}`, indexGear: teeth, ...extra,
      facets: [...tier('table', 'crown', 0, .55, 1), ...tier('girdle', 'girdle', 90, .25),
        ...tier('crown', 'crown', 35, .65), ...tier('pavilion', 'pavilion', 42, .73)] });
  };
  const surface = make(120, 10, 0, { metadata: { physicalScale: { millimetersPerModelUnit: 7.125 },
    source: { projectId: 'contract-source', revision: 4, author: 'Host fixture', license: 'fixture' } },
    extensions: { 'example.notes': { version: 2, required: false, data: { text: 'preserve without interpreting' } } } });
  const bevel = resolveFacet({ id: 'fine-face:0', patternId: 'fine-face', ordinal: 0, region: 'crown',
    indexTeeth: 120, index: 3, baseIndex: 3, repeat: 1, mirror: 0, industryAngleDeg: 55, depth: .625,
    metadata: { patternMode: 'arbitrary', surfaceFinish: { version: 1, model: 'ggx-dielectric', state: 'frosted', alpha: .28, scatter: .15 },
      source: { generated: true, parents: ['crown:120', 'crown:12'], generator: 'host-explicit-plane-fixture' } },
    extensions: { 'example.facet-note': { version: 1, required: false, data: ['fine planar cut'] } } });
  surface.facets.push(bevel);
  surface.metadata.labRecipe = { version: 1, labId: 'pattern', moduleVersion: 'fixture-only',
    status: 'current', geometryKey: labGeometryKey(surface), data: { purpose: 'preservation fixture, not a generator' } };
  const covered = make(96, 8);
  covered.facets.push(...resolveFacetPattern({ patternId: 'covered', region: 'crown', index: 1.25,
    baseIndex: 1.25, repeat: 1, industryAngleDeg: 30, depth: .01 }));
  const legacy = make(96, 8);
  const omissions = structuredClone(legacy); delete omissions.stock; delete omissions.indexGear;
  const oldGeometry = structuredClone(legacy);
  // Historical angle snapshot read by migrateLegacyFacetGeometry; parameters stay authoritative.
  oldGeometry.facets[0].betaDeg = 0;
  const cube = createCenteredCube(2);
  const mesh = createFacetingDocument({ name: 'Legacy v2 mesh', stock: { kind: 'mesh', size: 2, center: [0, 0, 0],
    mesh: { vertices: cube.vertices, faces: cube.faces.map(f => f.vertexIndices) } } });
  const concave = createFacetingDocument({ name: 'Disabled tool still carries data', concaveCuts: [{ id: 'saved-tool', type: 'sphere', enabled: false }] });
  const critical = structuredClone(legacy);
  critical.extensions = { 'future.geometry': { version: 1, required: true, data: { curved: true } } };
  const future = { ...legacy, schemaVersion: 4 };
  const meet = meetSample();
  const staleMeet = createFacetingDocument({ ...meet, facets: meet.facets.filter(f => f.patternId !== 'meet-source') });
  return [
    { id: '96-legacy', document: legacy }, { id: '96-legacy-omissions', document: omissions },
    { id: '96-legacy-angle', document: oldGeometry },
    { id: '99-ninefold', document: make(99, 9) }, { id: '120-tenfold', document: make(120, 10) },
    { id: '360-twelvefold', document: make(360, 12) }, { id: '96-fractional', document: make(96, 8, .375) },
    { id: 'surface-scale-source', document: surface },
    { id: 'surface-on-99', document: withDocumentIndexGear(surface, 99) },
    { id: 'covered-operation', document: createFacetingDocument(covered) },
    { id: 'meet-current', document: meet }, { id: 'meet-stale', document: staleMeet },
    { id: 'fixed-reference', document: make(120, 10, 0, { stock: { kind: 'cube', size: 3, center: [.1, -.2, 0] },
      cuttingReference: { kind: 'cube', size: 2, center: [0, 0, 0] }, metadata: { physicalScale: { millimetersPerModelUnit: 3.5 } } }) },
    { id: 'v2-mesh-rejected', document: mesh, reject: 'LAB_UNSUPPORTED_DOCUMENT' },
    { id: 'v3-mesh-rejected', document: createFacetingDocument({ ...mesh, concaveCuts: [] }), reject: 'LAB_UNSUPPORTED_DOCUMENT' },
    { id: 'v3-concave-rejected', document: concave, reject: 'LAB_UNSUPPORTED_DOCUMENT' },
    { id: 'v3-active-concave-rejected', document: createFacetingDocument({ concaveCuts: [{ id: 'active-tool', type: 'sphere' }] }), reject: 'LAB_UNSUPPORTED_DOCUMENT' },
    { id: 'required-extension-rejected', document: critical, reject: 'validation' },
    { id: 'future-format-rejected', document: future, reject: 'validation' },
  ];
}
