import { createPortal } from 'react-dom';
import { IconChevronDown } from '@tabler/icons-react';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { createLabHost, mountLaboratory } from '../application/labHost.js';
import { Modal } from './Modal.jsx';
import { downloadBlob } from '../utils/download.js';
import { t } from '../i18n/locale.js';

export const sourceStateText = state => ({ new: '从实验室新建', current: '来源版本未变化', changed: '来源已有新版本；本实验仍基于进入时的快照',
  missing: '来源项目已删除；本实验的来源快照仍保留', unreadable: '暂时无法读取来源项目；本实验的来源快照仍保留' }[state?.status] ?? '');
export function downloadLabRecovery(value, name = 'experiment-recovery') {
  downloadBlob(new Blob([typeof value === 'string' ? value : JSON.stringify(value,null,2)], { type: 'application/json' }), `${name}.json`);
}

/** Generic native container: each registration supplies the same lifecycle. */
export const LabWorkspaceHost = forwardRef(function LabWorkspaceHost({ lab, record, headerSlot, drafts, readProject, createProject, onLeave, onReturned }, ref) {
  const element = useRef(null), runtime = useRef(null), driver = useRef(null), lifetime = useRef(null);
  const callbacks = useRef({ onLeave, onReturned }); callbacks.current = { onLeave, onReturned };
  const [state, setState] = useState({ record, sourceState: null }), [phase, setPhase] = useState('loading');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [mountKey, setMountKey] = useState(0);
  const pendingAction = useRef(false), [name, setName] = useState('');
  const candidate = state.record.candidate, reviewRef = useRef(false); reviewRef.current = Boolean(candidate);
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    setPhase('loading'); setError(''); let mounted;
    const host = createLabHost({ record: drafts.read(record.id), lab, drafts, readProject, createProject,
      signal: controller.signal, onChange: setState }); driver.current = host;
    mountLaboratory(element.current, { lab, options: host.options }).then(instance => {
      if (controller.signal.aborted) { instance.dispose(); return; }
      mounted = instance; runtime.current = instance; setState(host.state()); setPhase('ready');
      if (document.visibilityState === 'hidden' || host.state().record.candidate) instance.pause();
    }).catch(e => { if (!controller.signal.aborted) { setError(e.message); setPhase('error'); } });
    const visibility = () => { if (document.visibilityState === 'hidden') mounted?.pause(); else if (!reviewRef.current) mounted?.resume(); };
    const beforeUnload = event => { if (host.hasUnsaved()) { event.preventDefault(); event.returnValue = ''; } };
    const pageHide = () => controller.abort();
    const pageShow = event => { if (event.persisted) setMountKey(k => k + 1); };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('beforeunload', beforeUnload); window.addEventListener('pagehide', pageHide); window.addEventListener('pageshow', pageShow);
    return () => { controller.abort(); mounted?.dispose(); runtime.current = null;
      document.removeEventListener('visibilitychange', visibility); window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('pagehide', pageHide); window.removeEventListener('pageshow', pageShow); };
  }, [record.id, lab, drafts, readProject, createProject, mountKey]);
  useEffect(() => {
    if (candidate) { setName(`${candidate.document.name} · ${t('实验结果')}`); runtime.current?.pause(); }
    else if (document.visibilityState !== 'hidden') runtime.current?.resume();
  }, [candidate?.id]);
  async function leave(destination) {
    if (pendingAction.current) return;
    if (phase !== 'ready') {
      if (driver.current?.hasUnsaved()) { setError(t('实验稿尚未保存，请重试保存或下载恢复文件。')); return; }
      lifetime.current?.abort(); callbacks.current.onLeave(destination); return;
    }
    pendingAction.current = true; setBusy(true); setError('');
    try {
      driver.current.setClosing(true);
      if (runtime.current.flush) {
        runtime.current.pause();
        await runtime.current.flush();
      } else if (!candidate) {
        element.current.inert = true;
        await runtime.current.returnResult();
      }
      if (driver.current.hasUnsaved()) throw new Error(t('实验稿尚未保存，请重试保存或下载恢复文件。'));
      lifetime.current.abort(); callbacks.current.onLeave(destination);
    } catch (e) { setError(e.message); if (!candidate) runtime.current?.resume(); }
    finally { pendingAction.current = false; setBusy(false); driver.current?.setClosing(false); if (element.current) element.current.inert = false; }
  }
  useImperativeHandle(ref, () => ({ leave }));
  async function retrySave() {
    if (pendingAction.current) return; pendingAction.current = true; setBusy(true);
    try { await driver.current.retrySave(); setMountKey(k => k + 1); } catch (e) { setError(e.message); }
    finally { pendingAction.current = false; setBusy(false); }
  }
  async function accept() {
    if (pendingAction.current) return; pendingAction.current = true; setBusy(true); setError('');
    try { const project = await driver.current.accept({ name, expectedSourceState: state.sourceState }); callbacks.current.onReturned(project); }
    catch (e) { setError(e.message); setState(driver.current.state()); }
    finally { pendingAction.current = false; setBusy(false); }
  }
  async function review() {
    if (pendingAction.current || !runtime.current) return;
    pendingAction.current = true; setBusy(true); setError('');
    try { await runtime.current.returnResult(); } catch (e) { setError(e.message); }
    finally { pendingAction.current = false; setBusy(false); }
  }
  const dismiss = async () => { if (!busy) { try { await driver.current.dismissCandidate(); setError(''); } catch (e) { setError(e.message); } } };
  const workspaceControls = <div className="labs-workspace-bar">
    <details className="labs-document-menu" onKeyDown={e => { if (e.key === 'Escape') { e.currentTarget.open = false; e.currentTarget.querySelector('summary').focus(); } }}><summary><span className="labs-document-kind">{t(lab.name)}</span><strong>{state.record.draft?.plan?.name ?? record.source?.document.name ?? record.newDesign?.name}</strong><span className="labs-save-state" role="status">{t(state.saving ? '正在保存实验稿…' : driver.current?.hasUnsaved() ? '实验稿尚未保存' : '独立实验稿已保留')}</span><IconChevronDown size={13}/></summary>
      <div className="labs-document-popover"><strong>{t('来源设计')}</strong><p>{record.source?.document.name ?? t('从实验室新建')}</p>{record.source ? <p>{t(sourceStateText(state.sourceState))} · v{record.source.revision}</p> : null}<p>{t('实验稿与来源分别保存，带回会创建新项目。')}</p><button className="workspace-page-button" onClick={() => downloadLabRecovery(driver.current.recovery(), `experiment-${record.id}`)}>{t('下载恢复文件')}</button></div>
    </details>
    <div className="labs-workspace-actions"><button className="workspace-page-button labs-mobile-review labs-primary" disabled={busy || phase !== 'ready'} onClick={review}>{t('检查并带回')}</button><button className="workspace-page-button" onClick={() => leave('overview')} disabled={busy}>{t('保存并退出实验')}</button></div>
  </div>;
  return <section className="labs-workspace" aria-label={t('实验工作区')}>
    {headerSlot ? createPortal(workspaceControls, headerSlot) : workspaceControls}
    {state.sourceState && !['new', 'current'].includes(state.sourceState.status) ? <p className="labs-source-alert" role="status">{t(sourceStateText(state.sourceState))}</p> : null}
    {error || state.error ? <div className="labs-error" role="alert"><span>{t(error || state.error)}</span><button onClick={retrySave} disabled={busy}>{t('重试保存与恢复')}</button><button onClick={() => downloadLabRecovery(driver.current.recovery())}>{t('下载恢复文件')}</button></div> : null}
    {phase === 'loading' ? <p className="labs-loading" role="status">{t('正在载入实验室与已保存的实验稿…')}</p> : null}
    {phase === 'error' ? <div className="labs-loading"><p>{t('载入失败，原实验稿仍保留。')}</p><button onClick={() => setMountKey(k => k + 1)}>{t('重新载入')}</button></div> : null}
    <div ref={element} className="labs-module-root" data-lab-module={lab.id} />
    {candidate ? <Modal title={t('检查实验结果')} onClose={dismiss} closeLabel={t('继续实验')} footerActions={<button className="primary-action modal-button" disabled={busy || phase !== 'ready'} onClick={accept}>{t(busy ? '正在保存…' : candidate.returnedProjectId ? '打开已带回项目' : '带回为新项目')}</button>}>
      <p>{t('实际几何已由工作台重新计算并校验。带回会创建独立项目，来源设计保持原样。')}</p><label className="labs-result-name">{t('新项目名称')}<input value={name} onChange={e => setName(e.target.value)} /></label>
      <dl className="labs-result-facts"><div><dt>{t('全部平切工序')}</dt><dd>{candidate.document.facets.length}</dd></div><div><dt>{t('最终有效面')}</dt><dd>{candidate.summary.effectiveFacetIds.length}</dd></div><div><dt>{t('基准盘')}</dt><dd>{candidate.document.indexGear.teeth}</dd></div><div><dt>{t('毫米尺度')}</dt><dd>{candidate.summary.millimetersPerModelUnit ?? t('未指定')}</dd></div></dl>
      <p className="labs-source-warning">{t(sourceStateText(state.sourceState))}</p>{candidate.recipe?.status === 'stale' ? <p>{t('旧实验配方已失效；保留实际平面和来源，不自动重放。')}</p> : null}
      {candidate.summary.construction.some(c => c.status === 'stale') ? <p>{t('存在已失效的构造来源，实际平面仍完整保留。')}</p> : null}
      {candidate.diagnostics?.warnings?.length ? <details><summary>{t('查看实验室检查提示')}</summary>{candidate.diagnostics.warnings.map((w,i) => <p key={i}>{w}</p>)}</details> : null}{error ? <p role="alert" className="labs-source-warning">{t(error)}</p> : null}
    </Modal> : null}
  </section>;
});
