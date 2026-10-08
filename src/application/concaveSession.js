import { updateConcaveTool } from './concaveTools.js';

/** A concave draft is separate from the committed document and planar CUT session. */
export function startConcaveSession(base, operation) {
  const tool = updateConcaveTool(base, operation).find(cut => cut.id === operation.toolId);
  const original = base.concaveCuts?.find(cut => cut.id === operation.toolId);
  return { base, operation, tool, mode: original ? 'edit' : 'create', dirty: !original };
}

export function updateConcaveSession(session, patch) {
  const operation = { ...session.operation, ...patch, toolId: session.tool.id };
  const next = startConcaveSession(session.base, operation);
  const original = session.base.concaveCuts?.find(cut => cut.id === session.tool.id);
  return { ...next, dirty: !original || JSON.stringify(next.tool) !== JSON.stringify(original) };
}

/** Optical metadata changes may rebase a draft; geometry replacement invalidates it. */
export function rebaseConcaveSession(session, document) {
  if (!session || session.base === document) return session;
  const base = session.base;
  return base.stock === document.stock && base.facets === document.facets && base.concaveCuts === document.concaveCuts
    ? { ...session, base: document } : null;
}
