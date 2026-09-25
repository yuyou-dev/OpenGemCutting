import { readLabDocument } from './labDocuments.js';
import { inspectLabRecipe } from '../domain/labsContract/index.js';

const copy = value => structuredClone(value);
const fail = (code, message) => Object.assign(new Error(message), { code });
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);

export function labSourceState(source, readProject) {
  if (!source) return { status: 'new', revision: null };
  let current;
  try { current = readProject(source.projectId); } catch { return { status: 'unreadable', revision: null }; }
  return { status: !current ? 'missing' : current.revision === source.revision ? 'current' : 'changed', revision: current?.revision ?? null };
}

/** One experiment capability. The module gets only options.persistence/onResult,
 * never a project store. Every write rechecks lifetime and the draft revision. */
export function createLabHost({ record: initial, lab, drafts, readProject, createProject, signal, onChange = () => {} }) {
  let record = copy(initial), pendingDraft = null, error = '', saving = false, reviewing = false, accepting = null;
  let queue = Promise.resolve(), pendingSaves = 0;
  const alive = context => { signal.throwIfAborted(); context?.signal?.throwIfAborted(); };
  const state = () => ({ record: copy(record), pendingDraft: copy(pendingDraft), error, saving, reviewing,
    sourceState: labSourceState(record.source, readProject) });
  const notify = () => { if (!signal.aborted) onChange(state()); };
  const change = async (update, context) => {
    alive(context);
    const next = await drafts.change(record.id, current => { alive(context); return update(current); },
      { expectedRevision: record.revision, signal: context?.signal ?? signal });
    alive(context); record = next; return next;
  };
  const checkPayload = payload => {
    if (payload.labId !== lab.moduleId || payload.moduleVersion !== lab.moduleVersion || payload.contractVersion !== lab.contractVersion || !same(payload.source, record.source))
      throw fail('LAB_IDENTITY', '实验稿版本或来源不匹配，原实验稿保留。');
  };
  function saveDraft(payload, context) {
    alive(context); checkPayload(payload);
    const next = copy(payload); pendingDraft = next; pendingSaves++; saving = true; error = ''; notify();
    const task = queue.catch(() => {}).then(async () => {
      try {
        if (!same(record.draft, next)) await change(current => {
          const versionBackups = current.versionBackups ?? [];
          if (current.draft && current.moduleVersion !== next.moduleVersion && !versionBackups.some(b => b.moduleVersion === current.moduleVersion)) {
            const { versionBackups: ignored, ...original } = current;
            versionBackups.push(original);
          }
          return { draft: next, moduleVersion: next.moduleVersion, candidate: null, versionBackups };
        }, context);
        if (pendingDraft === next) pendingDraft = null;
      } catch (e) { if (!signal.aborted) error = e.message; throw e; }
      finally { pendingSaves--; saving = pendingSaves > 0; notify(); }
    });
    queue = task; return task;
  }
  const options = {
    ...(record.source ? { source: copy(record.source) } : { newDesign: copy(record.newDesign) }), signal,
    presentation: { layout: 'embedded', resultAction: 'host' },
    persistence: {
      load(context) { alive(context); const current = drafts.read(record.id); if (!current) throw fail('DRAFT_MISSING', '实验稿不存在。'); record = current; return copy(current.draft); },
      save: saveDraft,
    },
    async onResult(candidate, context) {
      alive(context);
      if (candidate.moduleVersion !== lab.moduleVersion || candidate.contractVersion !== lab.contractVersion || !same(candidate.source, record.source))
        throw fail('CANDIDATE_IDENTITY', '候选版本或来源不匹配，未写入项目。');
      if (closing) return;
      reviewing = true; error = ''; notify();
      try {
        // Full host import + geometry recomputation, not the portable preflight.
        const { document, summary } = readLabDocument(candidate.document);
        alive(context);
        const sourceState = labSourceState(record.source, readProject);
        const existing = record.candidate;
        const id = existing && same(existing.document, document) ? existing.id : crypto.randomUUID();
        await change(() => ({ candidate: { id, document, summary, sourceState, recipe: inspectLabRecipe(document), diagnostics: copy(candidate.diagnostics),
          projectId: `experiment-${record.id}-${id}`, checkedAt: Date.now() } }), context);
      } catch (e) { if (!signal.aborted) error = e.message; throw e; }
      finally { reviewing = false; notify(); }
    },
  };
  let closing = false;
  return {
    options, state,
    setClosing(value) { closing = value; },
    hasUnsaved: () => Boolean(pendingDraft || saving),
    recovery: () => ({ format: 'facet-lab-recovery', version: 1, record: copy(record), pendingDraft: copy(pendingDraft) }),
    async retrySave() { if (pendingDraft) await saveDraft(pendingDraft); else await queue; },
    async dismissCandidate() { await change(() => ({ candidate: null })); error = ''; notify(); },
    async accept({ name, expectedSourceState } = {}) {
      if (accepting) return accepting;
      accepting = (async () => {
        alive();
        const candidate = record.candidate;
        if (!candidate) throw fail('NO_CANDIDATE', '请先返回候选并完成检查。');
        const sourceState = labSourceState(record.source, readProject);
        if (expectedSourceState && !same(sourceState, expectedSourceState)) { notify(); throw fail('SOURCE_CHANGED', '来源版本刚刚变化，请核对提示后再次保存为新项目。'); }
        let project;
        try {
          await change(current => {
            if (current.candidate?.id !== candidate.id) throw fail('STALE_CANDIDATE', '候选已变化，请重新检查。');
            alive();
            // Fixed destination is persisted before this transaction. If saving
            // the receipt fails after creation, retry finds that exact project.
            project = readProject(candidate.projectId);
            if (!project) {
              const validated = readLabDocument(candidate.document).document;
              const document = { ...validated, name: name?.trim() || `${validated.name} · 实验结果`, metadata: { ...validated.metadata,
                labReturn: { labId: lab.id, experimentId: record.id, candidateId: candidate.id, moduleVersion: lab.moduleVersion,
                  source: record.source ? { projectId: record.source.projectId, revision: record.source.revision } : null, sourceState } } };
              project = createProject(document, { id: candidate.projectId });
              if (!project) throw fail('PROJECT_SAVE_FAILED', '新项目保存失败。实验稿和候选仍保留，请重试或下载恢复文件。');
            }
            return { candidate: { ...candidate, returnedProjectId: project.id }, returns: [...current.returns.filter(r => r.candidateId !== candidate.id),
              { candidateId: candidate.id, projectId: project.id, createdAt: Date.now() }] };
          });
          error = ''; notify(); return project;
        } catch (e) { error = e.message; notify(); throw e; }
      })();
      try { return await accepting; } finally { accepting = null; }
    },
  };
}

export async function mountLaboratory(element, { lab, options }) {
  const module = await lab.load(); options.signal.throwIfAborted();
  if (module.moduleInfo.id !== lab.moduleId || module.moduleInfo.moduleVersion !== lab.moduleVersion || module.moduleInfo.contractVersion !== lab.contractVersion || module.moduleInfo.entryApiVersion !== (lab.entryApiVersion ?? 1))
    throw fail('MODULE_VERSION', '实验室模块版本不匹配，请核对固定模块包。');
  const instance = await module.mount(element, options);
  if (options.signal.aborted) { instance.dispose(); options.signal.throwIfAborted(); }
  return instance;
}
