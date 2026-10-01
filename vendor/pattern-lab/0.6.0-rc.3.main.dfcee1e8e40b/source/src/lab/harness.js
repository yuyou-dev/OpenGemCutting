// The development page and the packaged example use this same tiny host adapter.
// Its draft and candidate live only in memory; no main-project code or storage.
export function setupHarness(mountPatternLab, moduleInfo) {
  let instance = null, draft = null, pending = null, candidate = null, source = null;
  const status = document.querySelector('#result');
  async function mount() {
    pending?.abort(); instance?.dispose(); instance = null;
    const request = new AbortController(); pending = request;
    status.textContent = '加载中…';
    try {
      const mounted = await mountPatternLab(document.querySelector('#lab'), {
        ...(source ? { source } : { newDesign: { teeth: 99, symmetry: 9 } }), signal: request.signal,
        presentation: { layout: 'embedded', resultAction: 'host' },
        persistence: { load: () => draft, save: value => { draft = value; } },
        onResult: result => {
          candidate = result;
          status.textContent = `候选已返回：${result.document.indexGear.teeth} 齿 / ${result.document.facets.length} 条工序`;
        },
      });
      if (request.signal.aborted) { mounted.dispose(); return; }
      instance = mounted;
      status.textContent = `已挂载 · 模块 ${moduleInfo.moduleVersion} / 契约 ${moduleInfo.contractVersion}`;
    } catch (error) { if (!request.signal.aborted) status.textContent = `加载失败：${error.message}`; }
  }
  document.querySelector('#mount').onclick = mount;
  document.querySelector('#source-file').onchange = async event => {
    const file = event.target.files[0]; if (!file) return;
    try {
      const document = JSON.parse(await file.text());
      source = { projectId: 'verification-source', revision: 1, document }; draft = null;
      window.document.querySelector('#source-name').textContent = document.name ?? file.name;
      await mount();
    } catch (error) { status.textContent = `载入失败：${error.message}`; }
    event.target.value = '';
  };
  document.querySelector('#candidate').onclick = () => instance?.returnResult().catch(error => { status.textContent = `返回失败：${error.message}`; });
  document.querySelector('#save-exit').onclick = async () => {
    try { instance?.pause(); await instance?.flush(); pending?.abort(); instance?.dispose(); instance = null; status.textContent = '实验稿已保存并退出'; }
    catch (error) { instance?.resume(); status.textContent = `保存失败，未退出：${error.message}`; }
  };
  document.querySelector('#pause').onclick = () => { instance?.pause(); status.textContent = '已暂停'; };
  document.querySelector('#resume').onclick = () => { instance?.resume(); status.textContent = '已继续'; };
  document.querySelector('#unmount').onclick = () => {
    pending?.abort(); instance?.dispose(); instance = null; status.textContent = '已卸载';
  };
  window.addEventListener('pagehide', () => { pending?.abort(); instance?.dispose(); }, { once: true });
  // Verification-only hook; not part of the module's public API.
  window.labHarness = { get instance() { return instance; }, get draft() { return draft; }, get candidate() { return candidate; }, get source() { return source; } };
}
