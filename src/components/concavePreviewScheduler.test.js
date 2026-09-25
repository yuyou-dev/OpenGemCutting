import test from 'node:test';
import assert from 'node:assert/strict';
import { createConcavePreviewScheduler } from './concavePreviewScheduler.js';
function setup() {
  const sent = [], previews = [], commits = [], errors = [];
  const worker = { postMessage: message => sent.push(message), terminate() {} };
  const scheduler = createConcavePreviewScheduler({ createWorker: () => worker,
    onPreview: (base, result) => previews.push({ base, result }), onCommit: (base, result) => commits.push({ base, result }), onError: error => errors.push(error) });
  return { scheduler, sent, previews, commits, errors, reply: data => worker.onmessage({ data }) };
}
const op = depth => ({ toolId: 'tool', toolDepth: depth });
test('continuous input keeps one in flight and only the latest waiting position; release commits exactly once', () => {
  const h = setup(), base = {};
  h.scheduler.preview(base, op(0));
  for (let i = 1; i <= 100; i++) h.scheduler.preview(base, op(i));
  assert.equal(h.sent.length, 1);
  h.reply({ result: 'first-frame' });
  assert.equal(h.previews.length, 1); assert.equal(h.sent.length, 2);
  assert.equal(h.sent[1].operation.toolDepth, 100); assert.equal(h.sent[1].document, undefined);
  h.scheduler.finish(base, op(100)); h.reply({ result: 'final-frame' });
  assert.equal(h.commits.length, 1); assert.equal(h.commits[0].result, 'final-frame');
  assert.equal(h.sent.length, 2);
});
test('release reuses a completed preview; cancel and document replacement discard stale replies', () => {
  const h = setup(), base = {};
  h.scheduler.preview(base, op(1)); h.reply({ result: 'ready' });
  h.scheduler.finish(base, op(1)); assert.equal(h.sent.length, 1); assert.equal(h.commits.length, 1);
  h.scheduler.preview(base, op(2)); h.scheduler.cancel();
  const next = {}; h.scheduler.preview(next, op(3));
  h.reply({ result: 'stale' }); assert.equal(h.previews.length, 1); assert.equal(h.sent.at(-1).document, next);
  h.reply({ error: 'invalid geometry' }); assert.deepEqual(h.errors, ['invalid geometry']);
  h.scheduler.destroy(); h.reply({ result: 'after unmount' }); assert.equal(h.commits.length, 1);
});

test('release before a preview frame still runs off-thread and can be canceled before commit', () => {
  const h = setup(), base = {};
  h.scheduler.finish(base, op(1));
  assert.equal(h.sent.length, 1); assert.equal(h.commits.length, 0);
  h.scheduler.cancel(); h.reply({ result: 'canceled release' });
  assert.equal(h.commits.length, 0);
  h.scheduler.finish(base, op(2)); h.reply({ result: 'new release' });
  assert.equal(h.commits.length, 1); assert.equal(h.commits[0].result, 'new release');
});
