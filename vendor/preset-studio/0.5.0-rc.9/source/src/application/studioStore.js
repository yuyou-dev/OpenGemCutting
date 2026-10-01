import { validateWorkspace } from '../domain/workspace.js';
import { readTransferFile } from '../domain/transfer.js';
import { clone, uid, normalizeTransform, transformPoint } from '../domain/math.js';
import { cubeSolid, prismSolid, crystalSolid, cutSolid, geometryStats, sectionSegments } from '../domain/geometry.js';
import { generatePreset, componentPreview } from '../domain/generators.js';
import { LIMITS, importNativeDocument, planesEquivalent, repeatedSourceOperations, validateComponent, extractComponent, exportOBJ } from '../domain/io.js';
import { girdleContact, currentGirdleStock, planGirdleRecut } from '../domain/girdle.js';

import { instancePlanes, nativeInstancePlanes, makeNativeDocument } from '../adapters/opengemcutting.js';
import { normalizeMachineProfile, normalizeAxialTransform, machineReport, assertIntegerPlanes, rotationIndex, snapIndex } from '../domain/machine.js';
import { rebuildIntegerComponent } from '../domain/repair.js';
import { APP_VERSION } from '../version.js';
import { getBuiltin, defaultSelectedPreset, previewPlanesOf } from './viewModels.js';
import { creativeEdit, editTier } from '../domain/creative.js';
import { buildCreativeChoices, comparisonSolid } from './creativeCandidates.js';

function initialModel() { return { machine: normalizeMachineProfile(), stock: { name: '32 面圆形底胚', kind: 'preform', polys: prismSolid(), convex: true, nativeStock: null }, basePlanes: [], girdlePlanes: [], nativeDocument: null, groups: [{ id: 'initial-pavilion', component: generatePreset({ part: 'pavilion', name: '经典八向 · 亭' }), transform: normalizeTransform({ translation: [0, 0, -.045] }) }], draft: generatePreset({ name: '经典八向 · 冠' }), transform: normalizeTransform({ translation: [0, 0, .045] }), editId: null }; }

function sourceModel(payload) {
    const model = { ...initialModel(), machine: normalizeMachineProfile(payload.machine), stock: payload.stock,
        basePlanes: payload.basePlanes, nativeDocument: payload.nativeDocument, groups: payload.groups,
        girdlePlanes: [], removedFacetIds: [], replacementIds: [], editId: null, draftActive: false };
    return model;
}

/** Framework-free studio state container. React binds via subscribe/getState;
 * canvas classes are registered by components and only receive imperative calls. */
export function createStudioStore(options = {}) {
    const opts = { onApply: options.onApply, embedded: !!options.embedded };
    const imported = !options.workspace && options.initialDocument ? importNativeDocument(options.initialDocument, { convexOnly: !!options.embedded }) : null;
    let model = options.workspace ? validateWorkspace(options.workspace) : imported ? sourceModel(imported) : initialModel();
    // What changed between the source facets and their component records; shown until the next source load.
    const notesOf = payload => [...(payload.notices ?? []).map(text => ({ kind: 'info', text })), ...(payload.warnings ?? []).map(text => ({ kind: 'warning', text }))];
    let sourceNotes = imported ? notesOf(imported) : [];
    if (opts.embedded && (!model.stock.convex || model.machine.teeth > 360)) throw Error('实验稿超出接入范围：需要凸底胚及 1–360 分度。');
    let suspended = false;
    const initialDraft = JSON.stringify([model.draft, model.transform]);
    let discard = null, discardAction = null;
    let ui = { library: 'crown', filter: 'all', search: '', panel: 'creative', mode: 'axial', linkXY: true, activeParam: '', showGhost: true, selectedPreset: defaultSelectedPreset() };
    let history = [], future = [], lastPreview = null, valid = false, version = 0, previewVersion = -1, error = '', errorDisplay = '', status = '正在计算几何…', planeCount = 0, pendingApply = false, destroyed = false, toastTimer, worker = null, busy = false, queued = null, workerTimer = null, dragSnapshot = null, rangeSnapshot = null, renderMode = '', started = false;
    let dialog = null, toastState = { text: '', seq: 0 }, transferOpen = false;
    let repeatsAccepted = -1;
    // --- reactive slices -----------------------------------------------------
    const listeners = new Set();
    let snap = null;
    const dirtySlices = new Set(['model', 'ui', 'preview', 'session', 'overlay']);
    const sliceBuilders = {
        model: () => ({ ...model }),
        ui: () => ({ ...ui }),
        preview: () => ({ status, error, errorDisplay, valid, version, previewVersion, lastPreview, planeCount, pendingApply, renderMode, suspended }),
        session: () => ({ historySize: history.length, futureSize: future.length, sourceNotes }),
        overlay: () => ({ discard, dialog, toast: toastState, transferOpen }),
    };
    function emit() {
        const next = { ...(snap ?? {}) };
        for (const s of dirtySlices) next[s] = sliceBuilders[s]();
        dirtySlices.clear();
        snap = next;
        for (const l of listeners) l();
    }
    function commit(...names) { for (const n of names) dirtySlices.add(n); emit(); }
    const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };
    const getState = () => snap;
    function hasPendingDraft() {
        if (model.draftActive === false) return false;
        if (model.replacementIds?.length) return true;
        const group = model.groups.find(g => g.id === model.editId);
        const baseline = group ? JSON.stringify([group.component, group.transform]) : initialDraft;
        return JSON.stringify([model.draft, model.transform]) !== baseline;
    }
    function beforeReplacingDraft(label, action) {
        if (!unlocked()) return false;
        if (!hasPendingDraft()) { action(); return true; }
        discard = { label, name: model.draft.name };
        discardAction = action;
        commit('overlay');
        return false;
    }
    function cancelDiscard() { discard = null; discardAction = null; commit('overlay'); }
    function confirmDiscard() {
        const action = discardAction;
        cancelDiscard();
        if (unlocked()) safe(() => action?.());
    }
    // --- model helpers --------------------------------------------------------
    const snapModel = () => clone(model), record = () => { history.push(snapModel()); if (history.length > 32)
        history.shift(); future = []; }, unlocked = () => !pendingApply && !destroyed && !suspended;
    function toast(text) { toastState = { text, seq: toastState.seq + 1 }; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastState = { text: '', seq: toastState.seq }; commit('overlay'); }, 6000); commit('overlay'); }
    function safe(fn) { try {
        return fn();
    }
    catch (e) {
        toast(e.message);
        return null;
    } }
    function committedPlanes() { return [...model.basePlanes, ...(model.girdlePlanes ?? []), ...model.groups.filter(g => g.id !== model.editId).flatMap(g => instancePlanes(g.component, g.transform, g.id))]; }
    function previewPlanes() { return previewPlanesOf(model); }
    function exportGroups() { if (model.draftActive === false) return clone(model.groups); const groups = clone(model.groups), g = { id: model.editId || 'preview-instance', component: clone(model.draft), transform: clone(model.transform) }, i = groups.findIndex(x => x.id === g.id); if (i >= 0)
        groups[i] = g;
    else
        groups.push(g); return groups; }
    // --- worker-backed cutting preview ----------------------------------------
    function initWorker() { if (!globalThis.Worker)
        return; try {
        worker = new Worker(new URL('../worker.js', import.meta.url), { type: 'module' });
        worker.onmessage = e => { clearTimeout(workerTimer); busy = false; receive(e.data); if (queued) {
            const q = queued;
            queued = null;
            send(q);
        } };
        worker.onerror = e => { e.preventDefault(); clearTimeout(workerTimer); worker?.terminate(); worker = null; busy = false; const q = queued; queued = null; if (q)
            send(q);
        else
            requestPreview(); };
    }
    catch {
        worker = null;
    } }
    function send(job) { if (worker) {
        busy = true;
        worker.postMessage(job);
        workerTimer = setTimeout(() => { worker?.terminate(); worker = null; busy = false; const q = queued; queued = null; if (job.version === version)
            receive({ version: job.version, error: '计算超过 5 秒；未应用修改。请减少平面或简化原石。' }); if (q)
            send(q); }, 5000);
    }
    else {
        if (!job.convex) {
            receive({ version: job.version, error: '当前环境不支持后台 Worker，非凸原石计算已禁用，以免冻结界面。请在本地浏览器启动。' });
            return;
        }
        setTimeout(() => { if (job.version !== version)
            return; const start = performance.now(); try {
            const polys = cutSolid(job.stock, job.planes, { convex: job.convex });
            receive({ version: job.version, polys, stats: geometryStats(polys, job.planes), ms: performance.now() - start });
        }
        catch (e) {
            receive({ version: job.version, error: e.message });
        } }, 0);
    } }
    function requestPreview() { version++; valid = false; error = ''; errorDisplay = ''; status = '计算中…'; planeCount = previewPlanes().length; const job = { version, stock: model.stock.polys, convex: model.stock.convex, planes: previewPlanes() }; commit('preview'); if (busy)
        queued = job;
    else
        send(job); }
    function receive(data) {
        if (destroyed || data.version !== version)
            return;
        previewVersion = data.version;
        if (data.error) {
            error = data.error;
            errorDisplay = `${error} ${lastPreview ? '画面保留上次有效结果，不代表当前修改。' : ''}`;
            valid = false;
            status = '计算未通过';
            commit('preview');
            return;
        }
        lastPreview = data;
        valid = data.stats.volume > 1e-8 && data.polys.length > 0;
        error = valid ? '' : '组件把当前晶体全部切空，不能应用。移动或放大组件，或撤销。';
        errorDisplay = error;
        status = `${data.ms.toFixed(1)} ms · ${worker ? 'WORKER' : 'MAIN'} · ${model.stock.convex ? 'CONVEX CLIP' : 'BSP INTERSECTION'}`;
        commit('preview');
    }
    const fabricationReport = () => {
        const unchanged = new Set(model.groups.filter(g => {
            const source = model.nativeDocument?.metadata?.componentInstances?.find(s => s.id === g.id);
            return source && planesEquivalent(instancePlanes(source.component, source.transform), instancePlanes(g.component, g.transform), 1e-12);
        }).map(g => g.id));
        return machineReport(previewPlanes().filter(p => !unchanged.has(p.instanceId) && !model.basePlanes.some(b => b.id === p.id)), model.machine.teeth);
    };
    // --- editing actions -------------------------------------------------------
    function setDraft(component, { remember = true, id = null } = {}) { if (!unlocked())
        return; const c = validateComponent(component); if (remember)
        record(); model.draft = c; model.draftActive = true; model.replacementIds = []; model.editId = id; model.transform = normalizeTransform({ translation: [0, 0, c.part === 'crown' ? .045 : -.045] }); commit('model', 'session'); requestPreview(); }
    function changeParam(key, value, remember = true) { if (!unlocked() || !model.draft.recipe)
        return; if (key === 'phase') { if (!Number.isInteger(value))
        throw Error('基准分度必须是整数齿号'); value = snapIndex(value, model.machine.teeth) * 360 / model.machine.teeth; } const r = model.draft.recipe, params = { ...r.params, [key]: value }; if (key === 'outline' && value === 'emerald')
        params.symmetry = 8; const c = generatePreset({ family: r.generator, part: model.draft.part, params, name: model.draft.name }); c.id = model.draft.id; if (remember)
        record(); model.draft = c; ui.activeParam = key; commit('model', 'ui', 'session'); requestPreview(); }
    function onTransform(value, remember = true) { if (!unlocked())
        return; const t = normalizeAxialTransform(value, { teeth: model.machine.teeth }); if (remember)
        record(); model.transform = t; commit('model', 'session'); requestPreview(); }
    function commitCreative(component, remember = true) {
        if (!unlocked()) return;
        if (remember) record();
        model.draft = component;
        commit('model', 'session'); requestPreview();
    }
    function changeCreative(patch, remember = true) {
        if (!unlocked()) return;
        commitCreative(creativeEdit(model.draft, patch, model.transform, model.machine.teeth), remember);
    }
    function changeTier(index, patch) {
        if (!unlocked()) return;
        commitCreative(editTier(model.draft, index, patch, model.transform, model.machine.teeth));
        ui.activeParam = `tier-${index + 1}`; commit('ui');
    }
    async function openComparison(mode) {
        if (!unlocked() || dialog || model.draftActive === false) return;
        if (mode === 'pair') {
            if (opts.onApply) throw Error('当前宿主使用逐组提交桥，请在独立实验稿中搭配。');
            if ((!model.editId || hasPendingDraft()) && !await apply()) return;
        }
        const choices = buildCreativeChoices(model, mode);
        openDialog({ type: 'creative', mode, choices, versionAtOpen: version, part: model.draft.part });
    }
    function acceptComparison(index) {
        if (!unlocked()) throw Error('当前工作区不可编辑，请稍后再试。');
        const d = dialog, c = d?.choices?.[index];
        if (d?.type !== 'creative' || d.versionAtOpen !== version) throw Error('工作区已变化，请关闭后重新比较。');
        if (!c?.component || c.reason) throw Error('请选择一个有效方案。');
        if (c.original || c.unchanged) return;
        comparisonSolid(model, c.component, c.transform, c.editId);
        record(); model.draft = validateComponent(c.component); model.transform = clone(c.transform);
        model.editId = c.editId; model.draftActive = true;
        if (d.mode === 'pair') model.replacementIds = [];
        ui.activeParam = ''; ui.selectedPreset = null;
        commit('model', 'ui', 'session'); requestPreview();
        toast('已载入所选方案预览；检查后应用整组切割，可撤销。');
    }
    function undo() { if (!unlocked() || !history.length)
        return; future.push(snapModel()); model = history.pop(); commit('model', 'session'); requestPreview(); }
    function redo() { if (!unlocked() || !future.length)
        return; history.push(snapModel()); model = future.pop(); commit('model', 'session'); requestPreview(); }
    // A new component that repeats whole source operations (typically extracted from them)
    // should replace them; the designer decides before anything is applied.
    function repeatedSources() {
        const source = model.nativeDocument, reference = source?.cuttingReference ?? source?.stock;
        if (model.editId || opts.onApply || !reference) return [];
        const base = model.basePlanes.filter(p => p.part === model.draft.part && !(model.replacementIds ?? []).includes(p.id));
        return repeatedSourceOperations(base, nativeInstancePlanes(model.draft, model.transform, reference, model.machine.teeth), source.facets);
    }
    function resolveRepeatedSource(ids) {
        if (dialog?.type !== 'repeated-source' || dialog.versionAtOpen !== version) throw Error('工作区已变化，请关闭后重新应用。');
        if (!ids.length) { repeatsAccepted = version; return apply(); }
        record(); model.replacementIds = [...new Set([...(model.replacementIds ?? []), ...ids])]; commit('model', 'session'); requestPreview();
        toast('已选择替换重复的来源工序；预览更新后再点“应用整组切割”。');
    }
    async function apply() {
        if (!unlocked() || model.draftActive === false || !valid || previewVersion !== version) {
            toast('请等待当前版本的有效切割预览');
            return false;
        }
        if (!fabricationReport().exact) { toast('整齿检查未通过；请换兼容分度或重构后应用'); return false; }
        normalizeAxialTransform(model.transform, { teeth: model.machine.teeth });
        const repeats = repeatedSources();
        if (repeats.length && repeatsAccepted !== version) {
            openDialog({ type: 'repeated-source', operations: repeats, versionAtOpen: version });
            return false;
        }
        if (!model.editId && model.groups.length >= LIMITS.groups) {
            toast('最多 64 组组件');
            return false;
        }
        pendingApply = true;
        commit('preview', 'session');
        const before = snapModel(), id = model.editId || uid(), previous = model.groups.find(g => g.id === id), data = { ...previous, id, component: clone(model.draft), transform: clone(model.transform), ...(model.replacementIds?.length ? { replaces: [...model.replacementIds] } : {}) };
        try {
            if (opts.onApply) {
                const result = await opts.onApply({ component: data.component, transform: data.transform, replaceInstanceId: model.editId || undefined, instanceId: id });
                if (result?.cancelled || result?.applied === false) {
                    toast('未应用：主工作区取消或拒绝本次切割');
                    return false;
                }
            }
            history.push(before);
            if (history.length > 32)
                history.shift();
            future = [];
            const i = model.groups.findIndex(g => g.id === id);
            if (i < 0)
                model.groups.push(data);
            else
                model.groups[i] = data;
            model.editId = id;
            if (model.replacementIds?.length) {
                model.removedFacetIds = [...new Set([...(model.removedFacetIds ?? []), ...model.replacementIds])];
                model.basePlanes = model.basePlanes.filter(p => !model.replacementIds.includes(p.id));
                model.replacementIds = [];
            }
            toast(i < 0 ? '已应用一组切割；再次调整将更新此组，不会重复叠加' : '已更新原组件工序');
            commit('model', 'session');
            requestPreview();
            return true;
        }
        catch (e) {
            toast(`主工作区未提交：${e.message}`);
            return false;
        }
        finally {
            pendingApply = false;
            commit('preview', 'session');
        }
    }
    function fit() {
        if (!model.stock.convex)
            throw Error('非凸原石请手动同轴缩放；截面适配仅用于凸底胚');
        const z = model.transform.translation[2], segments = sectionSegments(cutSolid(model.stock.polys, committedPlanes(), { convex: true }), z), pts = segments.flat();
        if (pts.length < 3)
            throw Error('当前腰口高度没有可拟合截面');
        const center = pts.reduce((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length], [0, 0]);
        const rim = componentPreview(model.draft).find(f => f.role === 'interface'); if (!rim)
            throw Error('组件没有闭合腰口');
        const vertices = rim.v.map(v => transformPoint(v, model.transform)); let factor = Infinity;
        for (const [a, b] of segments) { let n = [b[1] - a[1], a[0] - b[0]], len = Math.hypot(...n); if (len < 1e-9)
            continue; n = n.map(v => v / len); let d = n[0] * a[0] + n[1] * a[1]; if (n[0] * center[0] + n[1] * center[1] > d) {
            n = n.map(v => -v); d = -d;
        } if (d <= 1e-8)
            throw Error('固定轴不在此截面内部；不会为适配而横移轴线'); const support = Math.max(...vertices.map(v => n[0] * v[0] + n[1] * v[1])); if (support > 1e-9)
            factor = Math.min(factor, d / support); }
        if (!Number.isFinite(factor) || factor <= 0)
            throw Error('无法同轴适配');
        const t = clone(model.transform); t.scale[0] *= factor * .995; t.scale[1] *= factor * .995; onTransform(t);
        toast('已以固定轴径向适配；保留旋转、腰口高度和 Z 比例，未横移轴线');
    }
    function contactGirdle(part, z) {
        if (!unlocked()) return;
        const group = model.draft.part === part ? null : model.groups.filter(g => g.component.part === part).at(-1);
        if (model.draft.part !== part && !group) throw new Error('请先选择对应的冠部／亭部组件');
        if (group && opts.onApply) throw new Error('请先选择该组件再贴合；宿主仅支持当前组件的单次提交');
        const component = group?.component ?? model.draft, transform = group?.transform ?? model.transform;
        const result = girdleContact(component, transform, currentGirdleStock(model.stock, previewPlanes()), z);
        record();
        if (group) model.groups = model.groups.map(g => g.id === group.id ? { ...g, transform: result.transform } : g);
        else model.transform = result.transform;
        commit('model', 'session'); requestPreview();
        toast(result.exact ? '已整圈贴合固定腰棱；仅移动目标组件 Z，可撤销。' : `已沿 Z 移至局部接触，不能整圈贴合；周向高度差 ${result.spread.toFixed(4)} R。另一组件保持不变，可撤销。`);
    }
    function changeGear(teeth) {
        if (!unlocked())
            return;
        if (opts.embedded && teeth > 360) throw Error('主项目实验稿支持1–360分度；不会改写当前几何。');
        const machine = normalizeMachineProfile({ teeth });
        for (const g of model.groups)
            normalizeAxialTransform(g.transform, { teeth });
        normalizeAxialTransform(model.transform, { teeth });
        record(); model.machine = machine; commit('model', 'session'); requestPreview();
        toast(`已改为 ${teeth} 分度，几何没有移动；全部工序重新检查。`);
    }
    function planGirdle(part) {
        const group = model.draft.part === part ? null : model.groups.filter(g => g.component.part === part).at(-1);
        if (model.draft.part !== part && !group) throw new Error('尚无对应冠／亭组件');
        const planes = previewPlanes(), id = group?.id ?? 'draft';
        return planGirdleRecut({ component: group?.component ?? model.draft, transform: group?.transform ?? model.transform,
            stock: model.stock, currentPlanes: planes, otherPlanes: planes.filter(p => p.instanceId !== id), teeth: model.machine.teeth });
    }
    function recutGirdle(part) {
        if (!unlocked()) return;
        if (opts.onApply) throw new Error('宿主尚未提供独立腰棱工序事务；请在独立工作室重整');
        const result = planGirdle(part);
        if (!result.canApply) throw new Error(result.reasons.join('；'));
        record(); model.girdlePlanes = result.planes;
        commit('model', 'session'); requestPreview();
        toast(`${part === 'crown' ? '冠部' : '亭部'}腰线已整圈平齐，冠亭形状与位置保持不变。可撤销。`);
        return result;
    }
    function setStock(kind) {
        if (!unlocked()) return;
        if (opts.embedded) throw Error('来源晶体由宿主固定；如需其他底胚，请新建实验。');
        record();
        model.stock = kind === 'cube' ? { name: '方形底胚', kind, polys: cubeSolid(2.4), convex: true, nativeStock: { kind: 'cube', size: 2.4, center: [0, 0, 0] } } : kind === 'crystal' ? { name: '六方晶体示例', kind, polys: crystalSolid(), convex: true, nativeStock: null } : { name: '32 面圆形底胚', kind, polys: prismSolid(), convex: true, nativeStock: null };
        model.basePlanes = [];
        model.girdlePlanes = [];
        model.nativeDocument = null;
        commit('model', 'session');
        requestPreview();
    }
    function extractDraft({ name, part, waistZ, radius, author, license }) {
        const component = extractComponent(previewPlanes(), part, { name, waistZ: Number(waistZ), radius: Number(radius) });
        component.provenance = { type: 'user-saved', license, author, derivedFrom: model.draft.provenance || null };
        setDraft(component);
        ui.selectedPreset = null; commit('ui');
        toast('已提取为当前草稿；可继续编辑或在“导入 / 导出”保存组件文件。');
    }
    // --- dialogs ---------------------------------------------------------------
    function openDialog(next) { if (dialog)
        return; dialog = next; commit('overlay'); }
    function closeDialog() { dialog = null; commit('overlay'); }
    function requestRepair(scope) {
        safe(() => {
            if (scope === 'all' && opts.onApply)
                throw Error('嵌入宿主时请逐组重构；宿主需自行提供批量事务，不会只在预览中更改已提交组件');
            if (scope === 'all' && !machineReport(model.basePlanes, model.machine.teeth).exact)
                throw Error('原文档工序在当前分度下不兼容；需在宿主中先处理原工序，不能仅重构新组件');
            const teeth = model.machine.teeth;
            const result = rebuildIntegerComponent(model.draft, model.transform, teeth);
            const others = scope === 'all' ? model.groups.filter(g => g.id !== model.editId).map(g => ({ id: g.id, ...rebuildIntegerComponent(g.component, g.transform, teeth) })) : [];
            const all = [result, ...others], changed = all.reduce((sum, x) => sum + x.report.changedPlanes, 0), safeResult = all.every(x => x.report.safe);
            openDialog({ type: 'repair', scope, versionAtOpen: version, teeth, result, others, changed, safeResult, maxAngle: Math.max(...all.map(x => x.report.maxAzimuthDeltaDeg)), maxResidual: Math.max(...all.map(x => x.report.maxPlaneResidual)), volumeChange: result.report.relativeVolumeChange, lostFaces: all.reduce((sum, x) => sum + x.report.lostFaces.length, 0), topologyChanged: all.some(x => x.report.topologyChanged) });
        });
    }
    function acceptRepair() {
        const d = dialog;
        if (d?.type !== 'repair')
            return;
        if (version !== d.versionAtOpen)
            throw Error('工作区已变化，请关闭对话框重新计算');
        if (!d.safeResult)
            throw Error('候选未通过完整性检查');
        record(); model.draft = validateComponent(d.result.component); model.transform = normalizeAxialTransform(d.result.transform, { teeth: d.teeth });
        if (d.scope === 'all')
            for (const item of d.others) {
                const g = model.groups.find(g => g.id === item.id);
                g.component = validateComponent(item.component); g.transform = item.transform;
            }
        commit('model', 'session'); requestPreview(); toast('已接受整齿近似几何，可撤销；请检查交点与腰口后应用。');
    }
    // --- import / export ---------------------------------------------------------
    function download(name, content, type = 'application/json') { const url = URL.createObjectURL(new Blob([content], { type })), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000); toast(`已生成 ${name}`); }
    function downloadJSON(name, data) { download(name, JSON.stringify(data, null, 2)); }
    function workspace() { return { kind: 'opengemcutting-component-workspace', schemaVersion: 2, appVersion: APP_VERSION, state: snapModel() }; }
    function applyImportPlan(plan, expectedVersion) {
        if (!unlocked())
            throw new Error('当前提交尚未完成，请稍后导入');
        if (version !== expectedVersion)
            throw new Error('读取期间工作区已变化，请重新选择文件');
        const payload = clone(plan.payload);
        let next;
        if (plan.kind === 'component') {
            setDraft(payload); ui.selectedPreset = null; commit('ui');
            toast(`已载入 ${plan.name}；只替换草稿，尚未应用切割`); return;
        }
        if (plan.kind === 'mesh')
            next = { ...snapModel(), stock: payload, basePlanes: [], girdlePlanes: [], nativeDocument: null, groups: [], editId: null };
        else if (plan.kind === 'workspace')
            next = payload;
        else if (plan.kind === 'native') { next = sourceModel(payload); sourceNotes = notesOf(payload); }
        else if (!next)
            throw new Error('未知导入计划');
        if (opts.onApply && next.girdlePlanes?.length)
            throw new Error('此工作区含独立腰棱工序，当前宿主尚未提供对应事务；请在独立工作室打开');
        next.machine = normalizeMachineProfile(next.machine);
        normalizeAxialTransform(next.transform, { teeth: next.machine.teeth });
        for (const g of next.groups)
            normalizeAxialTransform(g.transform, { teeth: next.machine.teeth });
        record(); model = next; ui.activeParam = ''; commit('model', 'ui', 'session'); requestPreview();
        toast(`已导入 ${plan.name}${plan.warnings.length ? '；' + plan.warnings.join('；') : '；可撤销恢复原工作区'}`);
    }
    async function loadFile(file) {
        if (!unlocked())
            throw new Error('当前提交尚未完成，请稍后导入');
        const importVersion = version, plan = await readTransferFile(file);
        return applyImportPlan(plan, importVersion);
    }
    function exportStatus(type) {
        if (!unlocked())
            return { enabled: false, reason: '请等待当前提交完成' };
        if (!['workspace', 'component', 'native', 'obj'].includes(type))
            return { enabled: false, reason: '未知导出类型' };
        if (type === 'native' || type === 'obj') {
            if (!valid || previewVersion !== version)
                return { enabled: false, reason: '请先关闭浮层，等待有效的当前切割预览。' };
            if (type === 'native') {
                const report = fabricationReport();
                if (model.machine.teeth > 360) return { enabled: false, reason: '主项目支持1–360分度；当前几何仍可保存为工作区。' };
                if (!report.exact)
                    return { enabled: false, reason: `${report.incompatible} 个新组件面无法用当前整数分度精确表达。请先处理分度；不会自动近似导出。` };
            }
        }
        return { enabled: true, detail: type === 'component' ? `${model.draft.name} · ${model.draft.planes.length} 个工序面` : `${model.groups.length} 组已应用工序 · 当前机台 ${model.machine.teeth} 分度` };
    }
    function exportFile(type, name) {
        const status = exportStatus(type); if (!status.enabled)
            throw new Error(status.reason);
        switch (type) {
            case 'workspace': downloadJSON(name, workspace()); break;
            case 'component': downloadJSON(name, validateComponent(model.draft)); break;
            case 'native': downloadJSON(name, makeNativeDocument(model.stock, model.nativeDocument, exportGroups(), model.girdlePlanes, { teeth: model.machine.teeth, removedFacetIds: model.removedFacetIds })); break;
            case 'obj': download(name, exportOBJ(lastPreview.polys), 'text/plain'); break;
            default: throw new Error('未知导出类型');
        }
    }
    // --- lifecycle ---------------------------------------------------------------
    function start(hostDocument) {
        if (started && !destroyed) return;
        const firstStart = !started;
        started = true; destroyed = false;
        if (firstStart && hostDocument) model = sourceModel(importNativeDocument(hostDocument));
        initWorker();
        commit('model');
        requestPreview();
    }
    function destroy() { destroyed = true; version++; busy = false; queued = null; clearTimeout(workerTimer); clearTimeout(toastTimer); worker?.terminate(); worker = null; listeners.clear(); }
    const store = {
        subscribe, getState, start, destroy,
        setSuspended(value) { if (value) { store.dragEnd(); store.endParamDrag(); } suspended = value; if (value) { version++; busy = false; queued = null; clearTimeout(workerTimer); worker?.terminate(); worker = null; } else { initWorker(); requestPreview(); } commit('preview'); },
        previewSourceReplacement(ids) {
            if (!unlocked()) return;
            if (model.editId || model.draftActive === false) throw Error('请先从预设库选择要替换的新组件。');
            const eligible = model.basePlanes.filter(p => p.part === model.draft.part).map(p => p.id);
            if (!ids.length || ids.some(id => !eligible.includes(id))) throw Error('请明确选择同部位的来源工序。');
            record(); model.replacementIds = [...new Set(ids)]; commit('model', 'session'); requestPreview();
        },
        candidateDocument() {
            if (model.draftActive !== false && (!model.editId || hasPendingDraft())) throw new Error('还有未应用的整组切割，请先应用或返回编辑；实验稿会保留这些修改。');
            return makeNativeDocument(model.stock, model.nativeDocument, model.groups, model.girdlePlanes, { teeth: model.machine.teeth, removedFacetIds: model.removedFacetIds });
        },
        getVersion: () => version, isEmbedded: () => !!opts.onApply, isLaboratory: () => opts.embedded, setOnApply: fn => { opts.onApply = fn; }, setRenderMode: text => { renderMode = text; commit('preview'); },
        hasPendingDraft, cancelDiscard, confirmDiscard,
        safe, toast, unlocked: () => unlocked(),
        setDraft, changeParam, onTransform, undo, redo, apply, resolveRepeatedSource, fit, contactGirdle, planGirdle, recutGirdle, changeGear, setStock,
        changeCreative, changeTier, openComparison, acceptComparison,
        previewCreative: patch => {
            if (!unlocked()) return;
            if (!rangeSnapshot) rangeSnapshot = snapModel();
            changeCreative(patch, false);
        },
        selectPreset: (id, onSelected) => beforeReplacingDraft('切换预设', () => safe(() => { const c = getBuiltin(id); setDraft(c); ui.selectedPreset = id; commit('ui'); onSelected?.(); })),
        setLibraryTab: tab => { ui.library = tab; ui.filter = 'all'; commit('ui'); },
        setFilter: f => { ui.filter = f; commit('ui'); },
        setSearch: s => { ui.search = s; commit('ui'); },
        setPanel: p => { ui.panel = ['creative', 'build', 'transform'].includes(p) ? p : 'creative'; commit('ui'); },
        setMode: mode => { ui.mode = mode === 'orbit' ? 'orbit' : 'axial'; commit('ui'); },
        setActiveParam: key => { if (ui.activeParam !== key) {
            ui.activeParam = key;
            commit('ui');
        } },
        setGenerator: family => family !== model.draft.family && beforeReplacingDraft('切换结构生成器', () => safe(() => { const c = generatePreset({ family, part: model.draft.part }); record(); model.draft = c; commit('model', 'session'); requestPreview(); })),
        previewParam: (key, value) => { if (!rangeSnapshot)
            rangeSnapshot = snapModel(); safe(() => changeParam(key, value, false)); },
        endParamDrag: () => { if (rangeSnapshot) {
            if (JSON.stringify(rangeSnapshot.draft) !== JSON.stringify(model.draft)) {
                history.push(rangeSnapshot);
                if (history.length > 32)
                    history.shift();
                future = [];
            }
            rangeSnapshot = null;
            commit('session');
        } },
        commitParam: (key, value) => safe(() => changeParam(key, Number(value), true)),
        setOutline: value => safe(() => changeParam('outline', value)),
        setTransformField: (kind, axis, value) => safe(() => { const t = clone(model.transform); if (kind === 'scale' && ui.linkXY && axis < 2) {
            const factor = value / t.scale[axis];
            t.scale[1 - axis] *= factor;
        } t[kind][axis] = value; onTransform(t); }),
        setRotationIndex: i => safe(() => { if (!Number.isInteger(i))
            throw Error('旋转必须输入整数齿号'); const t = clone(model.transform); t.rotation[2] = snapIndex(i, model.machine.teeth) * 360 / model.machine.teeth; onTransform(t); }),
        nudgeIndex: delta => safe(() => { const t = clone(model.transform); t.rotation[2] = snapIndex(rotationIndex(t.rotation[2], model.machine.teeth) + delta, model.machine.teeth) * 360 / model.machine.teeth; onTransform(t); }),
        resetTransform: () => safe(() => onTransform({ translation: [0, 0, model.draft.part === 'crown' ? .045 : -.045] })),
        setLinkXY: checked => { ui.linkXY = checked; commit('ui'); },
        toggleGhost: () => { ui.showGhost = !ui.showGhost; commit('ui'); },
        selectGroup: id => id !== model.editId && beforeReplacingDraft('切换组件工序', () => safe(() => { const g = model.groups.find(g => g.id === id); record(); model.draft = clone(g.component); model.draftActive = true; model.replacementIds = []; model.transform = clone(g.transform); model.editId = g.id; commit('model', 'session'); requestPreview(); })),
        removeGroup: id => { if (!unlocked())
            return; record(); model.groups = model.groups.filter(g => g.id !== id); if (model.editId === id)
            model.editId = null; commit('model', 'session'); requestPreview(); toast('已移除已提交组件；当前草稿仍可见，可选择另一件预设'); },
        dragStart: () => { dragSnapshot = snapModel(); },
        dragCancel: () => { dragSnapshot = null; commit('session'); },
        dragEnd: () => { if (dragSnapshot && JSON.stringify(dragSnapshot.transform) !== JSON.stringify(model.transform)) {
            history.push(dragSnapshot);
            if (history.length > 32)
                history.shift();
            future = [];
        } dragSnapshot = null; commit('session'); },
        extractDraft,
        openDialog, closeDialog, requestRepair, acceptRepair,
        openTransfer: () => { if (!transferOpen) {
            transferOpen = true;
            commit('overlay');
        } },
        closeTransfer: () => { transferOpen = false; commit('overlay'); },
        applyImportPlan, loadFile, exportStatus, exportFile,
        // Programmatic controls exposed by the mounted React studio.
        api: null,
    };
    store.api = { getState: snapModel, getPreview: () => lastPreview ? clone({ ...lastPreview, valid: valid && previewVersion === version, error, version, previewVersion }) : null, loadComponent: c => beforeReplacingDraft('载入组件', () => setDraft(c)), loadFile, exportWorkspace: workspace, apply, undo, redo, setTransform: t => onTransform(t), setMode: mode => store.setMode(mode), setGear: changeGear, getMachineReport: fabricationReport, destroy };
    emit();
    return store;
}
