import { inspectLabDocument, millimetersPerModelUnit } from '../domain/labsContract/index.js';
import presetLock from './presetModuleLock.json' with { type: 'json' };
import lock from './labsModuleLock.json' with { type: 'json' };

// A fixed local module, imported only when an experiment opens. No shared React
// tree, project-store capability, iframe or runtime remote code download.
export const LABORATORIES = Object.freeze([
  Object.freeze({ id: 'preset', profile: 'preset', order: 20, name: '冠亭预设实验室', status: presetLock.enabled ? 'ready' : 'disabled',
    entryApiVersion: presetLock.entryApiVersion, moduleId: presetLock.moduleId, moduleVersion: presetLock.moduleVersion, contractVersion: presetLock.contractVersion,
    tags: ['冠部组合', '亭部调整', '形态与贴合'],
    description: '组合冠部与亭部、调整切面形态，并计算平腰与贴腰。',
    async load() {
      if (!presetLock.enabled) throw new Error('此实验室暂已停用，原实验稿仍保留。');
      const url = new URL(`${import.meta.env.BASE_URL}${presetLock.publicPath}index.js`, window.location.origin);
      const module = await import(/* @vite-ignore */ url.href);
      return { moduleInfo: module.moduleInfo, mount: module.mountPresetStudio };
    } }),
  Object.freeze({ id: 'pattern', order: 10, name: '图案实验室', status: lock.enabled ? 'ready' : 'disabled',
    entryApiVersion: lock.entryApiVersion, moduleId: lock.moduleId, moduleVersion: lock.moduleVersion, contractVersion: lock.contractVersion,
    tags: ['平面设计', '多分度', '独立实验稿'],
    description: '探索点、线、面的细致调整，以及磨砂细面与冠部图案。',
    async load() {
      if (!lock.enabled) throw new Error('此实验室暂已停用，原实验稿仍保留。');
      const url = new URL(`${import.meta.env.BASE_URL}${lock.publicPath}index.js`, window.location.origin);
      const module = await import(/* @vite-ignore */ url.href);
      return { moduleInfo: module.moduleInfo, mount: module.mountPatternLab };
    } }),
]);

export function labSourceSummary(document, profile = 'pattern') {
  if (!document) return null;
  return { name: document.name, teeth: document.indexGear.teeth,
    scale: millimetersPerModelUnit(document),
    supported: inspectLabDocument(document, { profile }).supported,
    frostedCount: document.facets.filter(f => f.metadata?.surfaceFinish?.state === 'frosted').length };
}

// Entry availability belongs to the selected laboratory; selecting never edits a document.
export function labEntryState(lab, document, { busy = false, hasPreview = false } = {}) {
  const source = labSourceSummary(document, lab?.profile);
  const blocked = busy ? '正在创建…' : hasPreview ? '请先返回编辑，保存或放弃未保存切割，再开始实验。'
    : lab?.status !== 'ready' ? '此实验室暂已停用，原实验稿仍保留。' : '';
  const sourceReason = blocked || (!source ? '请先选择来源设计' : !source.supported ? '此设计不在该实验室的接入范围内。原设计完整保留。' : '');
  return { source, canCreate: !blocked, canBring: !sourceReason, reason: sourceReason };
}
