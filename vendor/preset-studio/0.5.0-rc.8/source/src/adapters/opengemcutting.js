import { normalizeIndexGear, facetOnIndexGear, refreshLabRecipe } from '../../vendor/labs-contract/1.1.0/index.js';
import { dot, clone, uid, transformPlane } from '../domain/math.js';
import { validateComponent, importNativeDocument, planesEquivalent } from '../domain/io.js';
import { normalizeAxialTransform, machineReport } from '../domain/machine.js';
export { machineReport } from '../domain/machine.js';
export const UPSTREAM_BASELINE = '3f1caa47c9daa47a31aed1e480a1b26f6728919a';
export function instancePlanes(component, transform = {}, instanceId = 'draft') {
    const t = normalizeAxialTransform(transform);
    return component.planes.filter(p => p.role !== 'interface').map(p => ({ ...transformPlane(p, t), id: `${instanceId}/${p.id}`, sourcePlaneId: p.id, instanceId, isCut: true, part: component.part }));
}
/** Host computes normals again from index+angle: never fake a continuous normal. */
export function nativeFacetInputs(component, transform, stock, instanceId = uid(), teeth = 96) {
    const planes = instancePlanes(validateComponent(component), normalizeAxialTransform(transform, {teeth}), instanceId);
    const inputs = nativePlaneInputs(planes, stock, component.name, p => ({ patternMode: 'arbitrary', componentInstanceId: instanceId, componentPart: component.part, sourceComponentId: component.id, sourcePlaneId: p.sourcePlaneId, componentTier: p.tier, componentRole: p.role }), teeth, instanceId);
    return groupNativeInputs(inputs, instanceId);
}
function groupNativeInputs(inputs, prefix) {
    // A component can contain several cutting angles/depths. The host's CUT
    // groups and machining reports require a uniform setting within each group.
    const groups = new Map();
    for (const f of inputs) {
        const key = `${f.region}/${f.industryAngleDeg.toFixed(8)}/${f.depth.toFixed(8)}`;
        if (!groups.has(key)) groups.set(key, { id: `${prefix}/cut-${groups.size}`, count: 0 });
        const group = groups.get(key);
        f.patternId = group.id; f.ordinal = group.count++;
    }
    return inputs;
}
function nativePlaneInputs(planes, stock, name, metadata, teeth = 96, patternId) {
    normalizeIndexGear(teeth);
    const report = machineReport(planes, teeth);
    if (!report.exact)
        throw new Error(`不能无损导入本体${teeth}齿：${report.incompatible} 面为非整数分度，最大取整误差 ${report.maxErrorDeg.toFixed(4)}°。请保留预设/工作区 JSON。`);
    const c = stock.center || [0, 0, 0], r = stock.kind === 'mesh' ? stock.envelope?.radius : stock.size / 2, h = stock.kind === 'mesh' ? stock.envelope?.halfHeight : stock.size / 2;
    if (!Number.isFinite(r) || !Number.isFinite(h))
        throw new Error('底胚包络无效');
    return planes.map((p, i) => {
        const row = report.rows[i], depth = dot(p.n, c) + r * Math.hypot(p.n[0], p.n[1]) + h * Math.abs(p.n[2]) - p.d;
        if (depth < -1e-8)
            throw new Error('组件超出本体参考包络，产生负切深；请缩小或移动组件');
        const region = Math.abs(p.n[2]) < 1e-9 ? 'girdle' : p.n[2] > 0 ? 'crown' : 'pavilion';
        return { id: p.id, patternId: patternId ?? p.id, ordinal: patternId ? i : 0, ...(teeth === 96 ? {} : { indexTeeth: teeth }), region, baseIndex: row.nearest, index: row.nearest, repeat: 1, mirror: 0, industryAngleDeg: region === 'girdle' ? 90 : row.angle, depth: Math.max(0, depth), label: `${name} / ${p.tier || i + 1}`, metadata: metadata(p) };
    });
}
export function prepareHostCommand({ document, component, transform, replaceInstanceId, instanceId, domain }) {
    const teeth = normalizeIndexGear(document?.indexGear).teeth;
    if (!domain?.resolveFacet || !domain?.createReplaceDocumentCommand)
        throw new Error('需要本体 resolveFacet 与 createReplaceDocumentCommand');
    if (replaceInstanceId && !document.facets.some(f => f.metadata?.componentInstanceId === replaceInstanceId))
        throw new Error('待更新组件已不存在，请重新同步宿主文档');
    if (!replaceInstanceId && instanceId && document.facets.some(f => f.metadata?.componentInstanceId === instanceId))
        throw new Error('新组件实例 ID 与已有工序冲突');
    const id = replaceInstanceId || instanceId || uid(), c = validateComponent(component), t = normalizeAxialTransform(transform, {teeth}), inputs = nativeFacetInputs(c, t, document.cuttingReference ?? document.stock, id, teeth), facets = inputs.map(f => domain.resolveFacet(f, { stock: document.cuttingReference ?? document.stock }));
    const position = document.facets.findIndex(f => f.metadata?.componentInstanceId === id), previous = document.facets.filter(f => f.metadata?.componentInstanceId !== id), old = document.metadata?.componentInstances || [], recordPosition = old.findIndex(g => g.id === id), records = old.filter(g => g.id !== id);
    previous.splice(position < 0 ? previous.length : position, 0, ...facets);
    records.splice(recordPosition < 0 ? records.length : recordPosition, 0, { id, component: c, transform: t, version: 1 });
    const next = { ...document, facets: previous, metadata: { ...document.metadata, componentInstances: records } };
    return { document: next, instanceId: id, command: domain.createReplaceDocumentCommand(next, { description: `${replaceInstanceId ? '修改' : '应用'}${c.name}` }) };
}
/** Keep the complete source stack authoritative. Unchanged operations remain
 * byte-for-byte snapshots; only edited groups replace their original slots. */
export function makeNativeDocument(stock, baseDocument, groups, girdlePlanes = [], { teeth = baseDocument?.indexGear?.teeth ?? 96, removedFacetIds = [] } = {}) {
    const gear = normalizeIndexGear(teeth);
    const restored = baseDocument ? importNativeDocument(baseDocument).groups : [];
    const nativeStock = stock.nativeStock ? clone(stock.nativeStock) : meshStock(stock);
    const reference = baseDocument?.cuttingReference ?? nativeStock;
    const original = baseDocument?.facets ?? [], removed = new Set(removedFacetIds);
    const replacements = new Map(), insertions = new Map(), additions = [], records = [];
    const owned = new Set(restored.map(g => g.id));
    const unchanged = new Set();
    for (const group of groups) {
        const previous = restored.find(g => g.id === group.id);
        if (previous && planesEquivalent(instancePlanes(previous.component, previous.transform), instancePlanes(group.component, group.transform), 1e-12)) {
            unchanged.add(group.id);
            records.push(clone(baseDocument.metadata.componentInstances.find(g => g.id === group.id)));
            continue;
        }
        const members = original.filter(f => f.metadata?.componentInstanceId === group.id);
        const next = nativeFacetInputs(group.component, group.transform, reference, group.id, teeth).map(input => {
            const old = members.find(f => f.metadata?.sourcePlaneId === input.metadata.sourcePlaneId);
            const facet = resolvedInput(input, reference);
            return old ? { ...clone(old), ...facet, id: old.id,
                metadata: { ...clone(old.metadata), ...facet.metadata } } : facet;
        });
        const nextById = new Map(next.map(f => [f.id, f]));
        for (const old of members) replacements.set(old.id, nextById.get(old.id) ?? null);
        const extra = next.filter(f => !members.some(old => old.id === f.id));
        if (members.length) replacements.set(members.at(-1).id, [...(nextById.has(members.at(-1).id) ? [nextById.get(members.at(-1).id)] : []), ...extra]);
        else if (group.replaces?.length) insertions.set(group.replaces[0], extra);
        else additions.push(...extra);
        records.push(clone(group));
    }
    const active = new Set(groups.map(g => g.id));
    let facets = original.flatMap(f => {
        if (removed.has(f.id)) return insertions.get(f.id) ?? [];
        if (owned.has(f.metadata?.componentInstanceId) && !active.has(f.metadata.componentInstanceId)) return [];
        if (replacements.has(f.id)) return replacements.get(f.id) ?? [];
        return clone(f);
    });
    facets.push(...additions);
    if (girdlePlanes.length) {
        const ids = new Set(girdlePlanes.map(p => `studio-girdle/${p.id}`));
        facets = facets.filter(f => !ids.has(f.id));
        facets.push(...groupNativeInputs(nativePlaneInputs(girdlePlanes.map(p => ({ ...p, id: `studio-girdle/${p.id}` })), reference, '腰棱重整',
            () => ({ operationType: 'girdle-recut' }), teeth, 'studio-girdle'), 'studio-girdle').map(f => resolvedInput(f, reference)));
    }
    const changedGroups = restored.length !== groups.length || groups.some(g => !unchanged.has(g.id));
    const doc = { ...clone(baseDocument ?? {}), kind: 'facet-96-document', name: baseDocument?.name ?? '冠亭组合设计', stock: nativeStock,
        indexGear: gear, facets: facets.map(f => facetOnIndexGear(f, teeth)) };
    if (!baseDocument || changedGroups) doc.metadata = { ...doc.metadata, componentInstances: [
        ...(baseDocument?.metadata?.componentInstances ?? []).filter(g => !owned.has(g.id) && !active.has(g.id)), ...records] };
    const extended = baseDocument?.schemaVersion === 3 || doc.cuttingReference !== undefined || doc.concaveCuts !== undefined || teeth !== 96
        || doc.facets.some(f => !Number.isInteger(f.index) || !Number.isInteger(f.baseIndex) || !Number.isInteger(f.mirror) || 96 % f.repeat !== 0);
    doc.schemaVersion = extended ? 3 : nativeStock.kind === 'mesh' ? 2 : 1;
    doc.$schema = `https://yuyou-dev.github.io/OpenGemCutting/schemas/document-v${doc.schemaVersion}.schema.json`;
    if (extended && doc.concaveCuts === undefined) doc.concaveCuts = [];
    return refreshLabRecipe(doc);
}
function resolvedInput(input, reference) {
    const teeth = input.indexTeeth ?? 96, beta = (input.region === 'crown' ? 1 : input.region === 'pavilion' ? -1 : 0) * (90 - input.industryAngleDeg);
    const azimuth = input.index * 360 / teeth, b = beta * Math.PI / 180, a = azimuth * Math.PI / 180;
    const n = [Math.cos(b) * Math.cos(a), Math.cos(b) * Math.sin(a), Math.sin(b)];
    const center = reference.center ?? [0, 0, 0], r = reference.kind === 'mesh' ? reference.envelope.radius : reference.size / 2;
    const h = reference.kind === 'mesh' ? reference.envelope.halfHeight : reference.size / 2;
    return { ...input, displayIndex: input.index || teeth, azimuthDeg: azimuth, betaDeg: beta,
        plane: { normal: { x: n[0], y: n[1], z: n[2] }, offset: dot(n, center) + r * Math.hypot(n[0], n[1]) + h * Math.abs(n[2]) - input.depth, keep: 'less-than-or-equal' } };
}
function meshStock(stock) {
    const vertices = [], faces = [], map = new Map();
    for (const polygon of stock.polys) faces.push(polygon.v.map(v => {
        const key = v.map(x => Math.round(x * 1e8)).join(',');
        if (!map.has(key)) { map.set(key, vertices.length); vertices.push({ x: v[0], y: v[1], z: v[2] }); }
        return map.get(key);
    }));
    return { kind: 'mesh', size: 2, center: [0, 0, 0], mesh: { vertices, faces },
        envelope: { radius: Math.max(...vertices.map(v => Math.hypot(v.x, v.y))), halfHeight: Math.max(...vertices.map(v => Math.abs(v.z))) } };
}
