import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n/locale.js';
import { LABORATORIES, labSourceSummary } from '../application/laboratories.js';
import { createLabDraftStore, validateLabDraftRecord } from '../domain/labDrafts.js';
import { labSourceState } from '../application/labHost.js';
import { LabWorkspaceHost, downloadLabRecovery, sourceStateText } from './LabWorkspaceHost.jsx';
import { LanguageSelector } from './LanguageSelector.jsx';
import { Modal } from './Modal.jsx';
import { APP_VERSION } from '../version.js';
import { IconArrowLeft, IconArrowRight, IconClock, IconHome, IconLayersIntersect, IconRosette } from '@tabler/icons-react';
import { RepositoryLink } from './RepositoryLink.jsx';
import './workspace-pages.css';
import './labs.css';

export function LabsPage({ document: sourceDocument, hasPreview, prepareSource, readProject, createProject, onReturned, onHome, onEditor, laboratories = LABORATORIES }) {
  const storeRef = useRef(null); storeRef.current ??= createLabDraftStore(window.localStorage, { locks: navigator.locks });
  const drafts = storeRef.current, workspace = useRef(null), importInput = useRef(null), mounted = useRef(true), starting = useRef(false);
  const [listing, setListing] = useState({ records: [], unreadable: [] }), [current, setCurrent] = useState(null), [error, setError] = useState('');
  const [headerSlot, setHeaderSlot] = useState(null);
  const [newLab, setNewLab] = useState(null), [teeth, setTeeth] = useState(96), [sizeMm, setSizeMm] = useState(10), [busy, setBusy] = useState(false);
  const source = labSourceSummary(sourceDocument), labs = [...laboratories].sort((a,b) => a.order-b.order), featured = labs[0];
  const refresh = () => { try { setListing(drafts.list()); } catch (e) { setError(e.message); } };
  useEffect(() => { mounted.current = true; refresh(); const listener = () => refresh(); window.addEventListener('storage',listener); return () => { mounted.current = false; window.removeEventListener('storage',listener); }; }, []);
  const navigate = destination => {
    if (current) workspace.current?.leave(destination);
    else if (destination === 'home') onHome(); else if (destination === 'editor') onEditor();
  };
  function leave(destination) { setCurrent(null); refresh(); if (destination === 'home') onHome(); else if (destination === 'editor') onEditor(); }
  async function start(lab, fromSource) {
    if (starting.current) return;
    starting.current = true; setBusy(true); setError('');
    try {
      const snapshot = await prepareSource(fromSource);
      if (!mounted.current) return;
      const record = drafts.create({ labId: lab.id, moduleVersion: lab.moduleVersion, contractVersion: lab.contractVersion,
        ...(fromSource ? { source: snapshot } : { newDesign: { name: t('图案实验'), teeth, symmetry: {96:8,99:9,120:10,360:12}[teeth], density: 1, sizeMm } }) });
      setNewLab(null); setCurrent({ lab, record });
    } catch (e) { if (mounted.current) setError(e.message); }
    finally { starting.current = false; if (mounted.current) setBusy(false); }
  }
  async function resume(record) {
    setError('');
    try { await prepareSource(false); const lab = labs.find(l => l.id === record.labId && l.status === 'ready'); if (!lab) throw new Error(t('该实验室暂不可用，实验稿仍保留。')); if (mounted.current) setCurrent({lab,record:drafts.read(record.id)}); }
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
      const record=drafts.create({...r,draft:value.pendingDraft??r.draft,recoveredFrom:r.id});
      refresh(); await resume(record);
    } catch(e) { setError(e.message); }
    finally { if (importInput.current) importInput.current.value=''; }
  }
  return <main className={`workspace-lab ${current ? 'has-native-lab' : ''}`}>
    <header className="lab-topbar"><button className="workspace-page-brand" onClick={() => navigate('home')} aria-label={t('返回主页')}><img src={`${import.meta.env.BASE_URL}brand/logo-header.webp`} alt=""/><span><strong>{t('切磨工作台')} <small>{APP_VERSION}</small></strong><em>SUVA · FACET 96</em></span></button>
      <nav className="lab-navigation" aria-label={t('工作区导航')}><button className="workspace-page-button" onClick={() => navigate('home')}><IconHome size={16}/>{t('主页')}</button>{source ? <button className="workspace-page-button" onClick={() => navigate('editor')}><IconArrowLeft size={16}/>{t('返回编辑')}</button> : null}</nav><div ref={setHeaderSlot} className="labs-header-slot"/><div className="lab-topbar-actions"><LanguageSelector/><RepositoryLink/></div></header>
    {current ? <LabWorkspaceHost ref={workspace} {...current} headerSlot={headerSlot} drafts={drafts} readProject={readProject} createProject={createProject} onLeave={leave} onReturned={onReturned}/> : <div className="lab-layout"><div className="labs-content">
      <section className="labs-source" aria-label={t('来源设计')}><IconLayersIntersect size={20}/><div className="labs-source-copy"><span className="labs-label">{t('来源设计')}</span><strong>{source?.name ?? t('尚未选择项目')}</strong><p>{t('带入时保留已保存版本的快照，实验稿与原项目分别保存。')}</p>
        {source?.supported && source.scale == null ? <p className="labs-source-warning">{t('此设计未标定实际尺寸。进入后点击“标定尺寸”设置实际宽度，才能移动点或生成磨砂细边；查看与选择不受影响。')}</p> : null}{hasPreview ? <p className="labs-source-warning">{t('请先返回编辑，保存或放弃未保存切割，再开始实验。')}</p> : null}{source && !source.supported ? <p className="labs-source-warning">{t('此设计不在当前平面接入范围内。原设计完整保留。')}</p> : null}</div>
        {source ? <span className="labs-source-gear">{t('{0} 分度',[source.teeth])}<small>{source.scale ?? t('未指定')} mm / {t('模型单位')}</small></span> : null}<button className="workspace-page-button" onClick={() => navigate(source ? 'editor' : 'home')}>{t(source ? '返回编辑' : '选择来源设计')}<IconArrowRight size={15}/></button></section>
      {error ? <div className="labs-error" role="alert">{t(error)}</div> : null}
      <div className="labs-heading"><div><span className="lab-eyebrow">FACET LABS</span><h1>{t('实验室')}</h1><p>{t('为下一种刻面，留一处探索空间。')}</p></div><span className="labs-phase">{t('独立实验 · 检查后带回')}</span></div>
      <section className="labs-feature" aria-labelledby="pattern-lab-title"><div className="labs-feature-mark" aria-hidden="true"><IconRosette size={80} stroke={.75}/><span>01 / PATTERN</span></div><div className="labs-feature-copy"><div className="labs-title-line"><h2 id="pattern-lab-title">{t(featured.name)}</h2><span className="labs-status">{t(featured.status === 'ready' ? '可用' : '已停用')}</span></div><p>{t(featured.description)}</p><div className="labs-feature-tags"><span>{t('平面设计')}</span><span>{t('多分度')}</span><span>{t('独立实验稿')}</span></div><div className="labs-entry-actions"><button className="workspace-page-button labs-primary" disabled={busy || !source?.supported || hasPreview || featured.status !== 'ready'} onClick={() => start(featured,true)}>{t('带入当前设计')}<IconArrowRight size={16}/></button><button className="workspace-page-button" disabled={busy || hasPreview || featured.status !== 'ready'} onClick={() => setNewLab(featured)}>{t('新建实验')}</button></div></div><aside className="labs-feature-note"><span className="labs-label">{t('从设计出发')}</span><p>{t('使用当前设计，或从新的图案开始。')}</p><span className="labs-label">{t('把探索留成独立版本')}</span><p>{t('实验自动保存；返回前检查，再另存为新项目。')}</p></aside></section>
      <section className="labs-list"><div className="labs-section-heading"><h2>{t('实验室列表')}</h2><span>{t('随工具接入逐步扩展')}</span></div>{labs.map((lab,index) => <div className="labs-list-row" key={lab.id}><span className="labs-list-number">{String(index+1).padStart(2,'0')}</span><strong>{t(lab.name)}</strong><span className="labs-list-description">{t(lab.description)}</span><span className="labs-status">{t(lab.status === 'ready' ? '可用' : '已停用')}</span><button className="workspace-page-button" disabled={hasPreview || lab.status!=='ready'} onClick={() => setNewLab(lab)}>{t('新建实验')}</button></div>)}</section>
      <section className="labs-recent"><div className="labs-section-heading"><h2>{t('最近实验')}</h2><span>{listing.records.length}</span><button className="workspace-page-button" onClick={() => importInput.current.click()}>{t('从恢复文件另存')}</button><input ref={importInput} type="file" accept=".json,application/json" hidden onChange={e=>recover(e.target.files[0])}/></div>
        {!listing.records.length ? <div className="labs-recent-empty"><IconClock size={23}/><div><strong>{t('还没有实验记录')}</strong><p>{t('从当前设计或新图案开始，实验稿将在这里继续。')}</p></div></div> : listing.records.map(r => <article className="labs-recent-row" key={r.id}><div><strong>{r.draft?.plan?.name ?? r.source?.document.name ?? r.newDesign?.name}</strong><p>{r.source ? `${t('来源设计')}：${r.source.document.name} · v${r.source.revision}` : t('从实验室新建')}</p><small>{t(sourceStateText(labSourceState(r.source,readProject)))} · {new Date(r.updatedAt).toLocaleString()}</small>{r.returns.length ? <small>{t('已带回 {0} 个独立版本',[r.returns.length])}</small> : null}</div><button className="workspace-page-button" disabled={hasPreview} onClick={()=>resume(r)}>{t('继续实验')}</button><button className="workspace-page-button" onClick={()=>downloadLabRecovery({format:'facet-lab-recovery',version:1,record:r,pendingDraft:null})}>{t('下载恢复文件')}</button></article>)}
        {listing.unreadable.map(id=><div className="labs-error" key={id}><span>{t('有一份实验记录无法读取，原始数据仍保留。')}</span><button onClick={()=>downloadLabRecovery(drafts.raw(id),'unreadable-experiment')}>{t('下载原始记录')}</button></div>)}</section>
      <footer className="labs-footer"><span>SUVA · FACET 96</span><span>{t('实验结果用于设计比较，实际加工仍需独立验收。')}</span></footer>
    </div></div>}
    {newLab ? <Modal title={t('新建实验')} closeLabel={t('取消')} onClose={()=>!busy&&setNewLab(null)} footerActions={<button className="primary-action modal-button" disabled={busy || !(sizeMm>0)} onClick={()=>start(newLab,false)}>{t(busy ? '正在创建…' : '开始实验')}</button>}><p>{t('创建独立实验稿，不改变当前项目。')}</p><div className="labs-new-fields"><label>{t('基准盘')}<select value={teeth} onChange={e=>setTeeth(Number(e.target.value))}>{[96,99,120,360].map(n=><option key={n}>{n}</option>)}</select></label><label>{t('初始宽度（mm）')}<input type="number" min="0.1" step="0.1" value={sizeMm} onChange={e=>setSizeMm(Number(e.target.value))}/></label></div></Modal> : null}
  </main>;
}
