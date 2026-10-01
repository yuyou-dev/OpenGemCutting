import { createLabDatabase } from '../application/labDatabase.js';
import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n/locale.js';
import { LABORATORIES, labEntryState } from '../application/laboratories.js';
import { validateLabDraftRecord } from '../domain/labDrafts.js';
import { labSourceState } from '../application/labHost.js';
import { LabWorkspaceHost, downloadLabRecovery, sourceStateText } from './LabWorkspaceHost.jsx';
import { LanguageSelector } from './LanguageSelector.jsx';
import { Modal } from './Modal.jsx';
import { APP_VERSION } from '../version.js';
import { IconArrowLeft, IconArrowRight, IconClock, IconHome, IconLayersIntersect, IconRosette, IconDiamond, IconCheck, IconInfoCircle, IconPlus, IconFolder } from '@tabler/icons-react';
import { RepositoryLink } from './RepositoryLink.jsx';
import './workspace-pages.css';
import './labs.css';

export function LabsPage({ document: sourceDocument, hasPreview, prepareSource, readProject, peekProject, createProject, onReturned, onHome, onEditor, laboratories = LABORATORIES }) {
  const channel = useRef(null), refreshSequence = useRef(0);
  const storeRef = useRef(null); storeRef.current ??= createLabDatabase({ indexedDB: window.indexedDB, legacyStorage: window.localStorage, onChange: () => channel.current?.postMessage({ changed: true }) });
  const drafts = storeRef.current, workspace = useRef(null), importInput = useRef(null), mounted = useRef(true), starting = useRef(false);
  const [listing, setListing] = useState({ records: [], unreadable: [] }), [current, setCurrent] = useState(null), [error, setError] = useState('');
  const [headerSlot, setHeaderSlot] = useState(null);
  const [newLab, setNewLab] = useState(null), [teeth, setTeeth] = useState(96), [sizeMm, setSizeMm] = useState(10), [busy, setBusy] = useState(false);
  const labs = [...laboratories].sort((a,b) => a.order-b.order);
  const [selectedId, setSelectedId] = useState(() => labs[0]?.id);
  const selected = labs.find(lab => lab.id === selectedId) ?? labs[0];
  const entry = labEntryState(selected, sourceDocument, { busy, hasPreview }), source = entry.source;
  const refresh = async () => {
    const sequence = ++refreshSequence.current;
    try {
      const migration = await drafts.migrateLegacy();
      const next = await drafts.list();
      if (mounted.current && sequence === refreshSequence.current) setListing({ ...next, unreadable: [...next.unreadable, ...migration.unreadable] });
    } catch (e) { if (mounted.current) setError(e.message); }
  };
  useEffect(() => {
    mounted.current = true;
    if (typeof BroadcastChannel !== 'undefined') {
      channel.current = new BroadcastChannel('facet96:experiments'); channel.current.onmessage = refresh;
    }
    refresh();
    window.addEventListener('storage', refresh); window.addEventListener('focus', refresh);
    return () => { mounted.current = false; window.removeEventListener('storage', refresh); window.removeEventListener('focus', refresh); channel.current?.close(); channel.current = null; };
  }, []);
  const navigate = destination => {
    if (current) workspace.current?.leave(destination);
    else if (destination === 'home') onHome(); else if (destination === 'editor') onEditor();
  };
  function leave(destination) { setCurrent(null); refresh(); if (destination === 'home') onHome(); else if (destination === 'editor') onEditor(); }
  async function start(lab, fromSource) {
    if (starting.current) return;
    starting.current = true; setBusy(true); setError('');
    try {
      const snapshot = await prepareSource(fromSource, lab.profile);
      if (!mounted.current) return;
      const record = await drafts.create({ labId: lab.id, moduleVersion: lab.moduleVersion, contractVersion: lab.contractVersion,
        ...(fromSource ? { source: snapshot } : { newDesign: { name: t(lab.id === 'preset' ? '冠亭设计实验' : '图案实验'), teeth, symmetry: {96:8,99:9,120:10,360:12}[teeth], density: 1, sizeMm } }) });
      if (mounted.current) { setNewLab(null); setCurrent({ lab, record }); }
    } catch (e) { if (mounted.current) setError(e.message); }
    finally { starting.current = false; if (mounted.current) setBusy(false); }
  }
  async function resume(record) {
    setError('');
    try { await prepareSource(false); const lab = labs.find(l => l.id === record.labId && l.status === 'ready'); if (!lab) throw new Error(t('该实验室暂不可用，实验稿仍保留。')); const latest = await drafts.read(record.id); if (!latest) throw new Error(t('实验稿不存在。')); if (mounted.current) setCurrent({lab,record:latest}); }
    catch(e) { setError(e.message); }
  }
  async function recover(file) {
    if (!file) return;
    try {
      const value = JSON.parse(await file.text());
      if (!mounted.current) return;
      if (value.format !== 'facet-lab-recovery' || value.version !== 1 || !value.record) throw new Error(t('恢复文件格式不受支持，原文件未改动。'));
      const r=validateLabDraftRecord(value.record), lab=labs.find(l=>l.id===r.labId); if (!lab) throw new Error(t('找不到此恢复文件对应的实验室。'));
      await prepareSource(false);
      if (!mounted.current) return;
      const record=await drafts.create({...r,draft:value.pendingDraft??r.draft,recoveredFrom:r.id});
      refresh(); await resume(record);
    } catch(e) { setError(e.message); }
    finally { if (importInput.current) importInput.current.value=''; }
  }
  return <main className={`workspace-lab ${current ? 'has-native-lab' : ''}`}>
    <header className="lab-topbar"><button className="workspace-page-brand" onClick={() => navigate('home')} aria-label={t('返回主页')}><img src={`${import.meta.env.BASE_URL}brand/logo-header.webp`} alt=""/><span><strong>{t('切磨工作台')} <small>{APP_VERSION}</small></strong><em>SUVA · FACET 96</em></span></button>
      <nav className="lab-navigation" aria-label={t('工作区导航')}><button className="workspace-page-button" onClick={() => navigate('home')}><IconHome size={16}/>{t('主页')}</button>{source ? <button className="workspace-page-button" onClick={() => navigate('editor')}><IconArrowLeft size={16}/>{t('返回编辑')}</button> : null}</nav><div ref={setHeaderSlot} className="labs-header-slot"/><div className="lab-topbar-actions"><LanguageSelector/><RepositoryLink/></div></header>
    {current ? <LabWorkspaceHost ref={workspace} {...current} headerSlot={headerSlot} drafts={drafts} readProject={readProject} createProject={createProject} onLeave={leave} onReturned={onReturned}/> : <div className="lab-layout"><div className="labs-content">
      {error ? <div className="labs-error" role="alert">{t(error)}</div> : null}
      <div className="labs-heading"><div><span className="lab-eyebrow">FACET LABS</span><h1>{t('实验室')}</h1><p>{t('选择一个实验室，开始新的探索。')}</p></div><span className="labs-phase"><IconInfoCircle size={19}/>{t('独立实验，检查后另存新项目。')}</span></div>
      <fieldset className="labs-grid"><legend className="labs-sr-only">{t('选择实验室')}</legend>{labs.map(lab => {
        const Mark = lab.id === 'preset' ? IconDiamond : IconRosette;
        return <label key={lab.id} className={`labs-choice ${selected?.id === lab.id ? 'is-selected' : ''}`}>
          <input type="radio" name="laboratory" value={lab.id} checked={selected?.id === lab.id} onChange={() => setSelectedId(lab.id)} disabled={busy} aria-label={t(lab.name)}/>
          <Mark className="labs-choice-mark" size={128} stroke={.8} aria-hidden="true"/>
          <span className="labs-choice-copy"><strong>{t(lab.name)}</strong><span className="labs-choice-description">{t(lab.description)}</span><span className="labs-choice-tags">{(lab.tags ?? []).map(tag => <span key={tag}>{t(tag)}</span>)}</span>{lab.status !== 'ready' ? <span className="labs-status">{t('已停用')}</span> : null}</span>
          {selected?.id === lab.id ? <IconCheck className="labs-choice-check" size={20} aria-hidden="true"/> : null}
        </label>;
      })}</fieldset>
      <section className="labs-start" aria-label={t('选择起点')}>
        <div className="labs-selection"><IconLayersIntersect size={36} stroke={1.3}/><div><h2>{t('已选择：{0}', [t(selected?.name ?? '')])}</h2><p>{t('接下来选择起点，开始实验。')}</p></div></div>
        <div className="labs-start-controls">
          <h3>{t('选择起点')}</h3>
          <div className="labs-source-line"><div className="labs-source-name"><IconFolder size={20}/><strong>{source?.name ?? t('尚未选择项目')}</strong>{source ? <small>{t('{0} 分度', [source.teeth])}</small> : null}</div><button className="workspace-page-button" onClick={() => navigate(source ? 'editor' : 'home')}>{t(source ? '返回编辑' : '选择来源设计')}<IconArrowRight size={17}/></button></div>
          <div className="labs-start-actions"><button className="workspace-page-button labs-primary" disabled={!entry.canBring} onClick={() => start(selected,true)}>{t('带入当前设计')}<IconArrowRight size={17}/></button><button className="workspace-page-button labs-create" disabled={!entry.canCreate} onClick={() => setNewLab(selected)}><IconPlus size={19}/>{t('新建实验')}</button></div>
          <p className="labs-entry-reason" role="status">{entry.reason ? t(entry.reason) : t('带入时保留已保存版本的快照，实验稿与原项目分别保存。')}</p>
          {source && source.scale == null ? <p className="labs-source-warning">{t('此设计未标定实际尺寸。冠亭实验按模型单位编辑；图案实验需先标定尺寸才能生成细边。')}</p> : null}
        </div>
      </section>
      <section className="labs-recent"><div className="labs-section-heading"><h2>{t('最近实验')}</h2><span>{listing.records.length}</span><button className="workspace-page-button" onClick={() => importInput.current.click()}>{t('从恢复文件另存')}</button><input ref={importInput} type="file" accept=".json,application/json" hidden onChange={e=>recover(e.target.files[0])}/></div>
        {!listing.records.length ? <div className="labs-recent-empty"><IconClock size={23}/><div><strong>{t('还没有实验记录')}</strong><p>{t('从当前设计或新实验开始，实验稿将在这里继续。')}</p></div></div> : listing.records.map(r => <article className="labs-recent-row" key={r.id}><div><strong>{r.draft?.plan?.name ?? r.source?.document.name ?? r.newDesign?.name}</strong><span className="labs-draft-kind">{r.legacyCopy ? t('旧版更新副本') + ' · ' : ''}{t(labs.find(lab => lab.id === r.labId)?.name ?? r.labId)}</span><p>{r.source ? `${t('来源设计')}：${r.source.document.name} · v${r.source.revision}` : t('从实验室新建')}</p><small>{t(sourceStateText(labSourceState(r.source,peekProject)))} · {new Date(r.updatedAt).toLocaleString()}</small>{r.returns.length ? <small>{t('已带回 {0} 个独立版本',[r.returns.length])}</small> : null}</div><button className="workspace-page-button" disabled={hasPreview} onClick={()=>resume(r)}>{t('继续实验')}</button><button className="workspace-page-button" onClick={()=>downloadLabRecovery({format:'facet-lab-recovery',version:1,record:r,pendingDraft:null})}>{t('下载恢复文件')}</button></article>)}
        {listing.unreadable.map(({id,raw})=><div className="labs-error" key={id}><span>{t('有一份实验记录无法读取，原始数据仍保留。')}</span><button onClick={()=>downloadLabRecovery(raw,'unreadable-experiment')}>{t('下载原始记录')}</button></div>)}</section>
      <footer className="labs-footer"><span>SUVA · FACET 96</span><span>{t('实验结果用于设计比较，实际加工仍需独立验收。')}</span></footer>
    </div></div>}
    {newLab ? <Modal title={t('新建实验')} eyebrow={newLab.name} closeLabel={t('取消')} onClose={()=>!busy&&setNewLab(null)} footerActions={<button className="primary-action modal-button" disabled={busy || !(sizeMm>0)} onClick={()=>start(newLab,false)}>{t(busy ? '正在创建…' : '开始实验')}</button>}><p>{t('创建独立实验稿，不改变当前项目。')}</p><div className="labs-new-fields"><label>{t('基准盘')}<select value={teeth} onChange={e=>setTeeth(Number(e.target.value))}>{[96,99,120,360].map(n=><option key={n}>{n}</option>)}</select></label><label>{t('初始宽度（mm）')}<input type="number" min="0.1" step="0.1" value={sizeMm} onChange={e=>setSizeMm(Number(e.target.value))}/></label></div></Modal> : null}
  </main>;
}
