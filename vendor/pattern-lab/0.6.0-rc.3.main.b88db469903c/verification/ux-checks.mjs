import assert from 'node:assert/strict';

export function checkNavigation(nav) {
  const settle = camera => { let frames = 0; while (nav.advanceViewportCamera(camera)) assert.ok(++frames < 200); };
  const camera = nav.createViewportCamera({ yaw: 0, pitch: 0, panY: 0 });
  nav.dragViewport(camera, 10, 15);
  assert.equal(camera.targetYaw, .08); assert.equal(camera.targetPitch, -.12);
  nav.advanceViewportCamera(camera); assert.equal(camera.yaw, .08 * .16); assert.equal(camera.pitch, -.12 * .16);
  settle(camera);
  nav.dragViewport(camera, 23, -11, true); settle(camera);
  assert.equal(camera.panX, 23); assert.equal(camera.panY, -11); assert.equal(camera.yaw, .08);
  nav.zoomViewport(camera, -100); settle(camera); assert.equal(camera.zoom, Math.exp(.12));
  nav.zoomViewport(camera, -1e6); settle(camera); assert.equal(camera.zoom, 2.8);
  nav.zoomViewport(camera, 1e6); settle(camera); assert.equal(camera.zoom, .48);
  nav.keyViewport(camera, 'ArrowRight', true); settle(camera); assert.equal(camera.panX, 37);
  nav.keyViewport(camera, '0', false, { yaw: 0, pitch: 0, panY: 0 }); assert.equal(camera.zoom, 1);
  assert.equal(nav.keyViewport(camera, 'q'), false);
  return { version: nav.navigationVersion, rotation: .008, wheel: .0012, zoomRange: [.48, 2.8], panUnits: 'CSS px', easing: [.16, .18] };
}

/** Real PC 08.024. 10 mm is an explicit QA calibration, never a claimed size. */
export async function checkScaleWorkflow(api, document) {
  const source = { projectId: 'qa-columbia', revision: 1, document }, original = structuredClone(source);
  let draft, callbacks = 0;
  const session = await api.createLabSession({ source, persistence: { save: value => { draft = value; } }, onResult: () => callbacks++ });
  const c = session.controller, passed = [], outputs = {};
  const check = async (name, fn) => { await fn(); passed.push(name); };
  const targetIdentity = 'vertex:asc-tier-16:45|asc-tier-16:51|table-facet:96';
  const select = () => {
    const v = c.getSnapshot().editTargets.vertices.find(v => v.identity === targetIdentity);
    assert.ok(v); c.selectEditTarget({ kind: 'vertex', key: v.key }); return v;
  };
  try {
    const before = c.exportDocument();
    await check('unscaled point and bevel explain calibration and preserve geometry', async () => {
      assert.equal(c.getSnapshot().compiled.audit.mmPerUnit, null); select();
      assert.equal(await c.moveSelectionBy(.001, 0), false); assert.equal(c.getSnapshot().modal.kind, 'scale');
      assert.equal(c.getSnapshot().editFeedback.code, 'PHYSICAL_SCALE_REQUIRED');
      c.closeModal(); c.setBevelEnabled(true); assert.equal(c.getSnapshot().modal.kind, 'scale');
      assert.deepEqual(c.exportDocument(), before); c.closeModal();
    });
    await check('explicit measured-width calibration is undoable and leaves source planes unchanged', () => {
      assert.equal(c.calibrateWidth(10), true);
      assert.equal(c.getSnapshot().physicalDimensions.millimetres[0], 10);
      assert.deepEqual(c.exportDocument().facets, before.facets);
      c.undo(); assert.equal(c.getSnapshot().compiled.audit.mmPerUnit, null);
      c.redo(); assert.equal(c.getSnapshot().physicalDimensions.millimetres[0], 10);
      outputs.calibrated = c.exportDocument();
    });
    for (const mode of ['integer', 'exact']) await check(`${mode} point movement succeeds with original outline lock and can undo`, async () => {
      c.setDirectionMode(mode); c.setEditSettings({ mode: 'topology', lockOutline: true });
      const v = select(), before = c.exportDocument(), mm = c.getSnapshot().compiled.audit.mmPerUnit;
      assert.equal(await c.moveSelectionBy(.001, 0), true);
      const moved = c.getSnapshot().editSelection;
      assert.ok(Math.abs((moved.point[0] - v.point[0]) * mm - .001) < 1e-9);
      outputs[mode + 'Point'] = c.exportDocument();
      c.undo(); assert.deepEqual(c.exportDocument(), before);
    });
    await check('infeasible target reports actual reason and next action, no partial save', async () => {
      select(); const before = c.exportDocument();
      assert.equal(await c.moveSelectionBy(100, 0), false);
      assert.deepEqual(c.exportDocument(), before);
      assert.ok(c.getSnapshot().editFeedback.code); assert.ok(c.getSnapshot().editFeedback.next);
    });
    await check('bevel configuration, disabled/enabled and undo preserve actual result', () => {
      c.setBevelEnabled(true); assert.ok(c.getSnapshot().plan.bevelResult.planes.length);
      c.setBevelShoulder(.012); assert.equal(c.getSnapshot().plan.bevel.shoulderMm, .012);
      outputs.bevel = c.exportDocument();
      c.setBevelEnabled(false); assert.equal(c.getSnapshot().plan.bevelResult.planes.length, 0);
      c.undo(); assert.deepEqual(c.exportDocument(), outputs.bevel);
    });
    await check('flush persists without candidate callback; rc.1/rc.2 drafts resume calibration and actual bevels', async () => {
      await session.flush(); assert.equal(callbacks, 0);
      for (const moduleVersion of ['0.6.0-rc.1', '0.6.0-rc.2']) {
        const old = { ...structuredClone(draft), moduleVersion }, before = structuredClone(old);
        const next = await api.createLabSession({ source, persistence: { load: () => old, save: () => {} } });
        try {
          assert.deepEqual(next.controller.exportDocument(), outputs.bevel);
          assert.equal(next.controller.getSnapshot().compiled.audit.mmPerUnit, c.getSnapshot().compiled.audit.mmPerUnit);
        } finally { next.dispose(); }
        assert.deepEqual(old, before);
      }
    });
    await check('three repeated document reentries keep fine geometry and provenance', async () => {
      for (let i = 0; i < 3; i++) {
        const next = await api.createLabSession({ source: { ...source, document: outputs.bevel } });
        try { assert.deepEqual(next.controller.exportDocument(), outputs.bevel); }
        finally { next.dispose(); }
      }
    });
    assert.deepEqual(source, original);
    return { passed, explicitTestWidthMm: 10, sourceUnchanged: true, outputs };
  } finally { session.dispose(); }
}
