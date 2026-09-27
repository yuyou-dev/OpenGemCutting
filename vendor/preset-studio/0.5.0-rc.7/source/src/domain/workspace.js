import { clone, normalizePlane } from './math.js';
import { normalizeMachineProfile, normalizeAxialTransform } from './machine.js';
import { validateComponent, validateMesh, importNativeDocument, planesEquivalent, LIMITS } from './io.js';
/** Validate then replace atomically; imported convex hints are not trusted. */
export function validateWorkspace(data) {
    if (data?.kind !== 'opengemcutting-component-workspace' || ![1,2].includes(data.schemaVersion))
        throw new Error('未知工作区版本');
    const s = clone(data.state);
    if(data.schemaVersion===2 && !s?.machine)throw new Error('v2工作区必须包含固定轴机台配置');
    if(!s || typeof s !== 'object')throw new Error('工作区缺少状态');
    s.machine=normalizeMachineProfile(s.machine);
    if (!s?.stock)
        throw new Error('工作区缺少晶体');
    s.stock.convex = validateMesh(s.stock.polys).convex;
    if (!Array.isArray(s.groups) || s.groups.length > LIMITS.groups)
        throw new Error('组件数量超限');
    if (new Set(s.groups.map(g => g.id)).size !== s.groups.length || s.groups.some(g => typeof g.id !== 'string' || !g.id || ['draft', 'current-draft'].includes(g.id)))
        throw new Error('组件 ID 重复或无效');
    if (s.editId != null && !s.groups.some(g => g.id === s.editId))
        throw new Error('编辑对象不存在');
    for (const g of s.groups) {
        g.component = validateComponent(g.component);
        g.transform = normalizeAxialTransform(g.transform,{teeth:s.machine.teeth});
    }
    s.draft = validateComponent(s.draft);
    s.transform = normalizeAxialTransform(s.transform,{teeth:s.machine.teeth});
    if (!Array.isArray(s.basePlanes) || s.basePlanes.length > LIMITS.basePlanes)
        throw new Error('原工序预算超限');
    s.basePlanes = s.basePlanes.map(p => ({ ...normalizePlane(p), isCut: true }));
    if (!Array.isArray(s.girdlePlanes ?? []) || (s.girdlePlanes ?? []).length > LIMITS.planes)
        throw new Error('腰棱工序预算超限');
    s.girdlePlanes = (s.girdlePlanes ?? []).map(p => {
        const q = normalizePlane(p);
        if (Math.abs(q.n[2]) > 1e-9 || !(q.d > 0 && q.d <= 10000)) throw new Error('腰棱工序必须是围绕固定轴的竖直平面');
        return { ...q, part: 'girdle', role: 'girdle', isCut: true };
    });
    if (new Set(s.girdlePlanes.map(p => p.id)).size !== s.girdlePlanes.length || s.girdlePlanes.some(p => typeof p.id !== 'string' || !p.id))
        throw new Error('腰棱平面 ID 重复或无效');
    if (s.nativeDocument) {
        const v = importNativeDocument(s.nativeDocument);
        const sourceIds = new Set(v.basePlanes.map(p => p.id));
        for (const key of ['removedFacetIds', 'replacementIds']) {
            const ids = s[key] ?? [];
            if (!Array.isArray(ids) || new Set(ids).size !== ids.length || ids.some(id => !sourceIds.has(id)))
                throw new Error('工作区替换选择与来源工序不一致');
        }
        if ((s.replacementIds ?? []).some(id => !s.basePlanes.some(p => p.id === id && p.part === s.draft.part)))
            throw new Error('待替换工序必须属于当前草稿部位');
        if (!planesEquivalent(v.basePlanes.filter(p => !(s.removedFacetIds ?? []).includes(p.id)), s.basePlanes))
            throw new Error('工作区原生文档与原工序不一致');
        // Match source geometry by vertices; prevents export using a different stock.
        const keys = p => new Set(p.flatMap(f => f.v).map(v => v.map(x => Math.round(x * 1e7)).join(','))), a = keys(v.stock.polys), b = keys(s.stock.polys);
        if (a.size !== b.size || [...a].some(k => !b.has(k)))
            throw new Error('工作区原生晶体与显示晶体不一致');
        s.stock.nativeStock = v.stock.nativeStock;
    }
    else if (s.basePlanes.length) {
        throw new Error('工作区包含原工序但缺少配套原生文档，不能安全恢复');
    }
    else
        s.stock.nativeStock = null;
    return { replacementIds: s.replacementIds ?? [], draftActive: s.draftActive !== false, removedFacetIds: s.removedFacetIds ?? [], machine:s.machine, stock: s.stock, basePlanes: s.basePlanes, girdlePlanes: s.girdlePlanes, nativeDocument: s.nativeDocument || null, groups: s.groups, draft: s.draft, transform: s.transform, editId: s.editId ?? null };
}
