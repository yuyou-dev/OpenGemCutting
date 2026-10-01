import { LAB_PROFILES, inspectLabDocument, millimetersPerModelUnit } from '../domain/labsContract/index.js';
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

// The contract reports paths; the designer needs to know what in the design blocks entry.
const ENTRY_REASONS = [
  [/^\$\.(stock|cuttingReference)/, () => '这颗设计从异形底胚或原石开始，该实验室只接受方块底胚'],
  [/^\$\.concaveCuts/, () => '设计含凹切（包括已停用的），该实验室暂不支持凹切'],
  [/^\$\.facets$/, (document, profile) => `设计共有 ${document.facets.length} 道平切（含被覆盖的），超过该实验室上限 ${LAB_PROFILES[profile]?.maxFacets} 道`],
  [/^\$\.indexGear/, () => '分度盘不在 1–360 整齿范围内'],
  [/extensions/, () => '设计含该实验室无法识别的必需扩展数据'],
];
export function labEntryReason(document, errors, profile = 'pattern') {
  const match = errors.map(e => ENTRY_REASONS.find(([path]) => path.test(e.path))).find(Boolean);
  const detail = match ? match[1](document, profile) : '设计文件的格式或版本不受该实验室支持';
  return `此设计暂时不能带入：${detail}。原设计完整保留。`;
}

export function labSourceSummary(document, profile = 'pattern') {
  if (!document) return null;
  const inspection = inspectLabDocument(document, { profile });
  return { name: document.name, teeth: document.indexGear.teeth,
    scale: millimetersPerModelUnit(document),
    supported: inspection.supported,
    reason: inspection.supported ? '' : labEntryReason(document, inspection.errors, profile),
    frostedCount: document.facets.filter(f => f.metadata?.surfaceFinish?.state === 'frosted').length };
}

// Entry availability belongs to the selected laboratory; selecting never edits a document.
export function labEntryState(lab, document, { busy = false, hasPreview = false } = {}) {
  const source = labSourceSummary(document, lab?.profile);
  const blocked = busy ? '正在创建…' : hasPreview ? '请先返回编辑，保存或放弃未保存切割，再开始实验。'
    : lab?.status !== 'ready' ? '此实验室暂已停用，原实验稿仍保留。' : '';
  const sourceReason = blocked || (!source ? '请先选择来源设计' : !source.supported ? source.reason : '');
  return { source, canCreate: !blocked, canBring: !sourceReason, reason: sourceReason };
}
