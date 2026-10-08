import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkbenchDocument } from '../domain/document.js';
import { createCommandHistory, executeFacetingCommand, undoFacetingCommand, exportFacetingJSON } from '../domain/faceting.js';
import { createDocumentOpticsCommand, DEFAULT_OPTICS_SETTINGS } from '../domain/optics.js';
import { startConcaveSession, updateConcaveSession, rebaseConcaveSession } from './concaveSession.js';
import { evaluateConcaveUpdate, receiveConcaveUpdate } from './concaveEvaluation.js';
import { concaveToolDepth } from './concaveTools.js';

test('concave creation and cumulative edits remain a preview until one explicit commit', () => {
  const base = createWorkbenchDocument('Preview');
  const original = exportFacetingJSON(base);
  let history = createCommandHistory(base);
  let session = startConcaveSession(base, { toolId: 'draft', preset: 'flute' });
  session = updateConcaveSession(session, { toolDepth: .4 });
  session = updateConcaveSession(session, { phaseDeg: 17 });
  session = updateConcaveSession(session, { repeat: 3 });
  assert.equal(session.mode, 'create');
  assert.equal(session.tool.phaseDeg, 17);
  assert.equal(session.tool.repeat, 3);
  assert.ok(Math.abs(concaveToolDepth(base, session.tool) - .4) < 1e-8);
  const preview = receiveConcaveUpdate(base, evaluateConcaveUpdate(base, session.operation));
  assert.equal(exportFacetingJSON(history.present), original);
  assert.equal((history.present.concaveCuts ?? []).length, 0);
  history = executeFacetingCommand(history, preview.command);
  assert.equal(history.present.concaveCuts.length, 1);
  assert.equal(history.present.concaveCuts[0].phaseDeg, 17);
  history = undoFacetingCommand(history);
  assert.equal(exportFacetingJSON(history.present), original);
});

test('editing an existing concave layer preserves its identity and cancel leaves committed parameters unchanged', () => {
  const base = evaluateConcaveUpdate(createWorkbenchDocument(), { toolId: 'saved', preset: 'flute' }).document;
  const session = startConcaveSession(base, { toolId: 'saved' });
  assert.equal(session.mode, 'edit');
  assert.equal(session.dirty, false);
  const changed = updateConcaveSession(session, { repeat: 7 });
  assert.equal(changed.tool.id, 'saved');
  assert.equal(changed.dirty, true);
  assert.equal(base.concaveCuts[0].repeat, 5);
  assert.equal(updateConcaveSession(changed, { repeat: 5 }).dirty, false);
});

test('optical metadata rebases the concave draft but replacement geometry invalidates it', () => {
  const initial = createCommandHistory(createWorkbenchDocument());
  const base = initial.present;
  const session = startConcaveSession(base, { toolId: 'draft', preset: 'flute' });
  const history = executeFacetingCommand(initial, createDocumentOpticsCommand(DEFAULT_OPTICS_SETTINGS));
  const rebased = rebaseConcaveSession(session, history.present);
  assert.equal(rebased.base, history.present);
  assert.equal(rebased.tool, session.tool);
  assert.equal(rebaseConcaveSession(session, createWorkbenchDocument()), null);
});
