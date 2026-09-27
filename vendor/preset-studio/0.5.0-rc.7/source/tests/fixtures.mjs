import { cubeSolid } from '../src/domain/geometry.js';
/** Exact analytic voxel-boundary solids, generated for tests (no external models). */
export function voxelSolid(cells) { const set = new Set(cells.map(c => c.join(','))), dirs = [[0, 0, -1], [0, 0, 1], [0, -1, 0], [1, 0, 0], [0, 1, 0], [-1, 0, 0]], out = []; for (const c of cells) {
    const cube = cubeSolid(1, c.map(x => x + .5));
    for (let f = 0; f < 6; f++)
        if (!set.has(c.map((v, k) => v + dirs[f][k]).join(',')))
            out.push({ ...cube[f], id: `voxel-${c}-${f}` });
} return out; }
export const lSolid = () => voxelSolid([[0, 0, 0], [1, 0, 0], [0, 1, 0]]);
export const ringSolid = () => voxelSolid(Array.from({ length: 9 }, (_, i) => [i % 3, Math.floor(i / 3), 0]).filter(c => c[0] !== 1 || c[1] !== 1));
export const disconnectedSolid = () => voxelSolid([[0, 0, 0], [3, 0, 0]]);
export const halfPlane = { id: 'half', n: [0, 0, 1], d: .5, part: 'crown', role: 'test', isCut: true };

export function cubeDocument() { return { $schema: 'https://yuyou-dev.github.io/OpenGemCutting/schemas/document-v1.schema.json', schemaVersion: 1, kind: 'facet-96-document', name: 'Preserve me', indexGear: { teeth: 96, zeroAlias: 96, degreesPerTooth: 3.75 }, stock: { kind: 'cube', size: 2.4, center: [0, 0, 0] }, facets: [], metadata: { author: 'Fixture', unknownFutureField: { keep: true } }, optics: { material: 'test', ri: 1.54 } }; }
