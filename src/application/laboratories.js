import { inspectLabDocument, millimetersPerModelUnit } from '../domain/labsContract/index.js';
import lock from './labsModuleLock.json' with { type: 'json' };

// A fixed local module, imported only when an experiment opens. No shared React
// tree, project-store capability, iframe or runtime remote code download.
export const LABORATORIES = Object.freeze([
  Object.freeze({ id: 'pattern', order: 10, name: '图案实验室', status: lock.enabled ? 'ready' : 'disabled',
    entryApiVersion: lock.entryApiVersion, moduleId: lock.moduleId, moduleVersion: lock.moduleVersion, contractVersion: lock.contractVersion,
    description: '探索点、线、面的细致调整，以及磨砂细面与冠部图案。',
    async load() {
      if (!lock.enabled) throw new Error('此实验室暂已停用，原实验稿仍保留。');
      const url = new URL(`${import.meta.env.BASE_URL}${lock.publicPath}index.js`, window.location.origin);
      const module = await import(/* @vite-ignore */ url.href);
      return { moduleInfo: module.moduleInfo, mount: module.mountPatternLab };
    } }),
]);

export function labSourceSummary(document) {
  if (!document) return null;
  return { name: document.name, teeth: document.indexGear.teeth,
    scale: millimetersPerModelUnit(document),
    supported: inspectLabDocument(document).supported,
    frostedCount: document.facets.filter(f => f.metadata?.surfaceFinish?.state === 'frosted').length };
}
