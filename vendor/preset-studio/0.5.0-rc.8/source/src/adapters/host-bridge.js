import { clone } from '../domain/math.js';
import { prepareHostCommand } from './opengemcutting.js';
/** Async bridge: all impact checks precede ONE history write. Host owns sessions. */
export function createHostBridge({ getDocument, getRevision, canApply, analyzeImpact, confirmImpact, dispatch, domain }) {
    for (const [k, f] of Object.entries({ getDocument, getRevision, canApply, analyzeImpact, dispatch }))
        if (typeof f !== 'function')
            throw new Error(`缺少宿主接口 ${k}`);
    let pending = false;
    return { get pending() { return pending; }, async apply(payload) {
            if (pending)
                throw new Error('已有提交正在进行');
            if (!canApply())
                throw new Error('宿主当前只读或不允许应用');
            pending = true;
            try {
                const revision = getRevision(), before = getDocument(), prepared = prepareHostCommand({ document: before, component: clone(payload.component), transform: clone(payload.transform), replaceInstanceId: payload.replaceInstanceId, instanceId: payload.instanceId ?? payload.id, domain });
                const impact = await analyzeImpact(before, prepared.document, payload);
                if (!impact || impact.canApply !== true)
                    throw new Error(impact?.message || '宿主切割影响检查未通过');
                if (impact.requiresConfirmation) {
                    if (typeof confirmImpact !== 'function' || !await confirmImpact(impact))
                        return { applied: false, cancelled: true };
                }
                if (getRevision() !== revision || !canApply())
                    throw new Error('确认期间文档或编辑权限发生变化，请重新预览');
                await dispatch(prepared.command, { expectedRevision: revision, instanceId: prepared.instanceId, impact });
                return { applied: true, instanceId: prepared.instanceId, revision: getRevision() };
            }
            finally {
                pending = false;
            }
        } };
}
