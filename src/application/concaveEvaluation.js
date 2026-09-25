import { createFacetingDocument, createReplaceDocumentCommand } from '../domain/faceting.js';
import { adoptWorkerGeometry } from '../domain/documentGeometry.js';
import { prepareConcaveTool } from './designOperations.js';

/** Runs in our bundled worker; uses the same validation/solver as manual/MCP. */
export function evaluateConcaveUpdate(document, operation) {
  const prepared = prepareConcaveTool(document, operation);
  return { document: prepared.document, solid: prepared.solid };
}

/** Only our worker's response, never imported file data. Reattach immutable
 * document inputs so history and UI keep the validated geometry caches. */
export function receiveConcaveUpdate(base, result) {
  const document = createFacetingDocument({ ...base, concaveCuts: result.document.concaveCuts });
  adoptWorkerGeometry(document, result.solid);
  return { document, solid: result.solid, command: createReplaceDocumentCommand(document, { description: '调整凹切' }) };
}
