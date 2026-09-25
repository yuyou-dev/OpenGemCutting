/** Multi-project local library: one record per prefixed localStorage key.
 * Every function takes an injectable storage (defaults to globalThis.localStorage)
 * so the module stays node-testable without a DOM. */

export const PROJECT_PREFIX = 'suva-facet-pattern-lab:project:v1:';
export const LEGACY_STORAGE_KEY = 'suva-facet-pattern-lab-v1';

const store = (storage) => storage ?? globalThis.localStorage;

export function makeProject(plan, { name, now } = {}) {
  const timestamp = now ?? new Date().toISOString();
  const projectName = String(name ?? plan?.name ?? '').trim() || '未命名工程';
  return {
    schemaVersion: 1,
    id: 'project-' + crypto.randomUUID(),
    name: projectName,
    createdAt: timestamp,
    updatedAt: timestamp,
    plan: { ...plan, name: projectName },
  };
}

/** Bad records (broken JSON, wrong version, missing fields) parse to null. */
export function parseProject(raw) {
  try {
    const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (p?.schemaVersion !== 1) return null;
    if (typeof p.id !== 'string' || !p.id) return null;
    if (typeof p.name !== 'string' || !p.name.trim()) return null;
    if (!p.plan || typeof p.plan !== 'object') return null;
    return {
      schemaVersion: 1,
      id: p.id,
      name: p.name,
      createdAt: typeof p.createdAt === 'string' ? p.createdAt : new Date().toISOString(),
      updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt : new Date().toISOString(),
      plan: { ...p.plan, name: p.name },
      ...(p.recovery?{recovery:p.recovery}:{}),
    };
  } catch {
    return null;
  }
}

function summaryOf(record) {
  return {
    id: record.id,
    name: record.name,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    teeth: record.plan?.machine?.teeth ?? null,
    sizeMm: record.plan?.sizeMm ?? null,
    symmetry: record.plan?.metadata?.symmetry ?? null,
  };
}

/** Prefix scan, newest first; summaries carry no plan body. */
export function listProjects(storage) {
  const s = store(storage);
  const projects = [];
  try {
    for (let i = 0; i < s.length; i++) {
      const key = s.key(i);
      if (typeof key !== 'string' || !key.startsWith(PROJECT_PREFIX)) continue;
      const record = parseProject(s.getItem(key));
      if (record) projects.push(summaryOf(record));
    }
  } catch {
    return [];
  }
  return projects.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
}

export function readProject(storage, id) {
  const s = store(storage);
  try {
    return parseProject(s.getItem(PROJECT_PREFIX + id));
  } catch {
    return null;
  }
}

export function saveProject(storage, record) {
  const s = store(storage);
  s.setItem(PROJECT_PREFIX + record.id, JSON.stringify(record));
  return record;
}

export function renameProject(storage, id, name) {
  const record = readProject(storage, id);
  if (!record) return null;
  const clean = String(name).trim().slice(0, 80);
  if (!clean) return null;
  return saveProject(storage, { ...record, name: clean, plan: { ...record.plan, name: clean }, updatedAt: new Date().toISOString() });
}

export function duplicateProject(storage, id) {
  const record = readProject(storage, id);
  if (!record) return null;
  const copy = makeProject(structuredClone(record.plan), { name: `${record.name} 副本` });
  return saveProject(storage, copy);
}

export function deleteProject(storage, id) {
  const s = store(storage);
  s.removeItem(PROJECT_PREFIX + id);
}

/** One-shot migration of the legacy single-slot autosave into a project.
 * Idempotent: the legacy key is removed on success, later calls return null. */
export function migrateLegacyProject(storage) {
  const s = store(storage);
  let plan = null;
  try {
    const raw = s.getItem(LEGACY_STORAGE_KEY);
    if (raw === null || raw === undefined) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.kind === 'facet-pattern-plan' && Array.isArray(parsed.planes)) plan = parsed;
  } catch {
    return null;
  }
  if (!plan) return null;
  const record = saveProject(s, {...makeProject(plan, { name: plan.name || '迁移的设计' }),recovery:{originalStorageKey:LEGACY_STORAGE_KEY,originalPlan:structuredClone(plan)}});
  s.removeItem(LEGACY_STORAGE_KEY);
  return record;
}
