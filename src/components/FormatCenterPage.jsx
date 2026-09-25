import { useEffect, useMemo, useRef, useState } from 'react';
import { IconAlertTriangle, IconArrowLeft, IconArrowRight, IconCircleCheck, IconFileImport, IconHome, IconLayersIntersect } from '@tabler/icons-react';
import { t } from '../i18n/locale.js';
import { APP_VERSION } from '../version.js';
import { CONCEPTS, FORMATS, formatById } from '../domain/formats/capabilities.js';
import { inspectFormatFile, inspectProjectSource, planTargets, targetsFor } from '../application/formatCenter.js';
import { downloadBlob } from '../utils/download.js';
import { LanguageSelector } from './LanguageSelector.jsx';
import { RepositoryLink } from './RepositoryLink.jsx';
import { TechnicalPreview } from './TechnicalPreview.jsx';
import './workspace-pages.css';
import './labs.css';
import './format-center.css';

const VIEWS = [['isometric', '45°'], ['top', '俯视'], ['front', '正视'], ['bottom', '底视']];
const TARGETS = {
  workbench: { label: '在工作台打开', extension: '', apps: '新建为独立项目，当前项目不变' },
  json: { label: '本软件项目', extension: '.json', apps: '不打开，直接另存为完整项目文件' },
  asc: { label: 'GemCAD 文本', extension: '.asc', apps: 'GemCAD 5、Gem Cut Studio、在线切型图库' },
  gcs: { label: 'Gem Cut Studio', extension: '.gcs', apps: 'Gem Cut Studio 1.x' },
};
const OUTCOME = {
  complete: '完整保留',
  approximate: '会简化 {0} 项',
  lossy: '会丢失 {0} 项',
  blocked: '不能转换',
};
const SUPPORT = { keep: '保留', approx: '简化', lose: '不保存', block: '不能转换' };
const REGIONS = [['table', '台面'], ['crown', '冠部'], ['girdle', '腰部'], ['pavilion', '亭部']];

function outcomeText(plan) {
  const count = plan.outcome === 'lossy' ? plan.report.lost.length : plan.report.approximate.length;
  return t(OUTCOME[plan.outcome], [String(count)]);
}

function summaryLine(plan) {
  const { report } = plan;
  if (plan.outcome === 'blocked') return t(report.blocked[0]?.note || report.blocked[0]?.label || '不能转换');
  if (plan.outcome === 'lossy') return t('{0}不会写入', [report.lost.map((item) => t(item.label)).join(t('、'))]);
  if (plan.outcome === 'approximate') return t('{0}会简化', [report.approximate.map((item) => t(item.label)).join(t('、'))]);
  return t('这个设计的全部信息都能写入');
}

function actionLabel(plan) {
  if (plan.target === 'workbench') return t('在工作台打开');
  return plan.outcome === 'complete' ? t('导出 {0}', [plan.fileName]) : t('了解差异，导出 {0}', [plan.fileName]);
}

function SourceFacts({ source }) {
  const summary = source.summary ?? {};
  const format = source.origin === 'project' ? t('当前项目') : `${t(formatById(source.format)?.label ?? '')} ${formatById(source.format)?.extension ?? ''}`;
  const regions = REGIONS.filter(([key]) => summary.regions?.[key]).map(([key, label]) => `${t(label)} ${summary.regions[key]}`);
  const ratio = source.preview?.solid && summary.dimensions?.lengthToWidth;
  return <div className="formats-facts">
    <span className="formats-badge">{format}</span>
    <h3>{source.name}</h3>
    {source.fileName ? <p className="formats-file-name">{source.fileName}</p> : null}
    <dl>
      <div><dt>{t('齿盘')}</dt><dd>{summary.targetGear ?? summary.gear ?? '—'}</dd></div>
      <div><dt>{t('层 / 面')}</dt><dd>{summary.tierCount ?? '—'} / {summary.facetCount ?? summary.effectiveFacetCount ?? '—'}</dd></div>
      <div><dt>{t('磨砂面')}</dt><dd>{summary.frostedCount ?? 0}</dd></div>
      <div><dt>{t('折射率')}</dt><dd>{summary.refractiveIndex ?? '—'}</dd></div>
      {ratio ? <div><dt>{t('长宽比')}</dt><dd>{ratio.toFixed(3)}</dd></div> : null}
    </dl>
    {regions.length ? <p className="formats-regions">{regions.join(' · ')}</p> : null}
  </div>;
}

function Diagnostics({ items, title }) {
  if (!items.length) return null;
  return <details className="formats-tech">
    <summary>{t(title, [String(items.length)])}</summary>
    <ul>{items.map((item, index) => <li key={`${item.code}-${index}`} className={`is-${item.severity}`}>
      <span>{t(item.message)}</span>{item.line ? <small>{t('第 {0} 行', [String(item.line)])}</small> : null}
    </li>)}</ul>
  </details>;
}

function SourcePanel({ source }) {
  const [view, setView] = useState('isometric');
  if (source.status === 'error') {
    return <div className="formats-source-error" role="alert"><IconAlertTriangle size={18} />
      <div><strong>{t('这个文件无法读取')}</strong><p>{t(source.diagnostics[0]?.message ?? '')}</p><small>{t('原文件没有被修改。')}</small></div>
    </div>;
  }
  const notes = [];
  if (source.hasPreview) notes.push(t('编辑页还有未提交的切割预览；这里使用已保存的设计。'));
  if (source.present.has('tableless')) notes.push(t('这个设计没有唯一台面：可以直接转换为其他格式，但不能在工作台中打开。'));
  if (source.preview?.open) notes.push(t('切面没有把宝石完全包住；预览中的方框只用于显示。'));
  return <div className="formats-source">
    <figure className="formats-preview">
      <TechnicalPreview solid={source.preview.solid} view={view} frostedFaceIds={source.preview.frostedFaceIds} label={t('{0}的预览', [source.name])} />
      <div className="formats-views" role="group" aria-label={t('预览方向')}>
        {VIEWS.map(([id, label]) => <button key={id} type="button" aria-pressed={view === id} onClick={() => setView(id)}>{t(label)}</button>)}
      </div>
      {source.preview.frostedFaceIds?.size ? <figcaption><span className="formats-frost-swatch" aria-hidden="true" />{t('灰色为磨砂面')}</figcaption> : null}
    </figure>
    <div className="formats-source-copy">
      <SourceFacts source={source} />
      {notes.map((note) => <p key={note} className="formats-note">{note}</p>)}
      <Diagnostics items={source.diagnostics} title="读取说明（{0}）" />
    </div>
  </div>;
}

function ReportColumn({ kind, title, items }) {
  if (!items.length) return null;
  return <section className={`formats-report is-${kind}`}>
    <h4>{t(title)}<span>{items.length}</span></h4>
    <ul>{items.map((item) => <li key={item.id}><strong>{t(item.label)}</strong>{item.detail ? <span>{t(item.detail)}</span> : null}{item.note ? <em>{t(item.note)}</em> : null}</li>)}</ul>
  </section>;
}

function TargetDetail({ plan, source, onRun, busy }) {
  const { report } = plan;
  const blocked = plan.outcome === 'blocked';
  return <div className="formats-detail" aria-live="polite">
    {blocked
      ? <div className="formats-blocked"><IconAlertTriangle size={17} /><div><strong>{plan.target === 'workbench' ? t('不能在工作台打开') : t('不能转换为{0}', [t(TARGETS[plan.target].label)])}</strong><p>{t(report.blocked[0]?.note || plan.diagnostics.find((item) => item.severity === 'error')?.message || '')}</p></div></div>
      : <div className="formats-report-grid">
        <ReportColumn kind="lost" title="不会写入" items={report.lost} />
        <ReportColumn kind="approximate" title="会简化" items={report.approximate} />
        <ReportColumn kind="kept" title="完整保留" items={report.kept} />
      </div>}
    {report.verify.length ? <p className="formats-verify"><IconAlertTriangle size={15} />{t('在对方软件中请核对：{0}', [report.verify.map((item) => t(item.label)).join(t('、'))])}<span>{report.verify.map((item) => t(item.note)).join(' ')}</span></p> : null}
    <div className="formats-detail-actions">
      {plan.verified && plan.target !== 'workbench' ? <span className="formats-verified"><IconCircleCheck size={15} />{t('已读回核对，形状一致')}</span> : <span />}
      <button type="button" className="workspace-page-button labs-primary" disabled={blocked || busy} onClick={() => onRun(plan)}>{actionLabel(plan)}<IconArrowRight size={15} /></button>
    </div>
    <Diagnostics items={plan.diagnostics} title="技术细节（{0}）" />
    {source.origin === 'project' ? <p className="formats-json-note">{t('完整保存请在编辑页使用“文件 › 导出 JSON”：JSON 是唯一不丢信息的文件。')}</p> : null}
  </div>;
}

function CompareTable({ present }) {
  return <section className="formats-compare" aria-labelledby="formats-compare-title">
    <div className="labs-section-heading"><h2 id="formats-compare-title">{t('各格式能保存什么')}</h2><span>{t('标记“本设计”的行与当前来源有关')}</span></div>
    <div className="formats-table-scroll">
      <table>
        <thead><tr><th scope="col">{t('设计信息')}</th>{FORMATS.map((format) => <th scope="col" key={format.id}>{t(format.label)}<small>{format.extension}{format.write ? '' : ` · ${t('只读')}`}</small></th>)}</tr></thead>
        <tbody>{CONCEPTS.filter((concept) => !concept.condition).map((concept) => <tr key={concept.id} className={present?.has(concept.id) ? 'is-present' : ''}>
          <th scope="row">{t(concept.label)}{present?.has(concept.id) ? <b>{t('本设计')}</b> : null}<small>{t(concept.hint)}</small></th>
          {FORMATS.map((format) => {
            const support = concept.support[format.id];
            return <td key={format.id} className={`is-${support}`}><span>{t(SUPPORT[support])}</span>{concept.notes?.[format.id] ? <small>{t(concept.notes[format.id])}</small> : null}</td>;
          })}
        </tr>)}</tbody>
      </table>
    </div>
    <ul className="formats-footnotes">
      {FORMATS.map((format) => <li key={format.id}><strong>{t(format.label)} {format.extension}</strong>{t(format.note)}</li>)}
      <li><strong>{t('分度方向')}</strong>{t('Gem Cut Studio 的亭部分度与 GemCAD 反向计数；转换按 Gem Cut Studio 1.1 实际存档校准，并用带旋向的设计实机核对，切面方向保持不变。')}</li>
    </ul>
  </section>;
}

/** Format center page: one source, every destination with an honest report. */
export function FormatCenterPage({ document: projectDocument, hasPreview, intent, onOpenDocument, onHome, onEditor }) {
  const [source, setSource] = useState(() => (intent === 'project' && projectDocument ? inspectProjectSource(projectDocument, { hasPreview }) : null));
  const [selected, setSelected] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const fileInput = useRef(null);
  const plans = useMemo(() => (source ? planTargets(source) : {}), [source]);
  const targets = targetsFor(source);
  // A new source starts on its first destination that can actually be written.
  const active = targets.includes(selected) ? selected : targets.find((target) => plans[target]?.outcome !== 'blocked') ?? targets[0] ?? null;
  const choose = (next) => { setSelected(null); setMessage(''); setSource(next); };
  // "Import from GemCAD / Gem Cut Studio" keeps its one-click file chooser; if
  // the browser refuses without a fresh click, the drop area stays in view.
  useEffect(() => { if (intent === 'file') fileInput.current?.click(); }, [intent]);

  const pickProject = () => {
    if (projectDocument) choose(inspectProjectSource(projectDocument, { hasPreview }));
  };
  const readFile = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      choose(inspectFormatFile(new Uint8Array(await file.arrayBuffer()), file.name));
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };
  const run = (plan) => {
    if (plan.outcome === 'blocked') return;
    if (plan.target === 'workbench') {
      onOpenDocument(plan.document);
      return;
    }
    downloadBlob(new Blob([plan.text], { type: plan.mime }), plan.fileName);
    setMessage(t('已导出 {0}。原设计没有改变。', [plan.fileName]));
  };

  return <main className="workspace-lab workspace-formats">
    <header className="lab-topbar"><button className="workspace-page-brand" onClick={onHome} aria-label={t('返回主页')}><img src={`${import.meta.env.BASE_URL}brand/logo-header.webp`} alt="" /><span><strong>{t('切磨工作台')} <small>{APP_VERSION}</small></strong><em>SUVA · FACET 96</em></span></button>
      <nav className="lab-navigation" aria-label={t('工作区导航')}><button className="workspace-page-button" onClick={onHome}><IconHome size={16} />{t('主页')}</button>{projectDocument ? <button className="workspace-page-button" onClick={onEditor}><IconArrowLeft size={16} />{t('返回编辑')}</button> : null}</nav>
      <div className="lab-topbar-actions"><LanguageSelector /><RepositoryLink /></div></header>
    <div className="lab-layout"><div className="formats-content">
      <div className="labs-heading"><div><span className="lab-eyebrow">FORMAT CENTER</span><h1>{t('格式中心')}</h1><p>{t('打开 GemCAD、Gem Cut Studio 的设计，或把当前设计交给其他软件。转换前先看清会保留什么、会少什么。')}</p></div><span className="labs-phase">{t('GemCAD · Gem Cut Studio · 本软件')}</span></div>

      <section className="formats-step" aria-labelledby="formats-source-title">
        <div className="formats-step-heading"><span>1</span><h2 id="formats-source-title">{t('选择来源')}</h2></div>
        <div className="formats-pickers">
          {projectDocument ? <button type="button" className={`formats-picker${source?.origin === 'project' ? ' is-selected' : ''}`} aria-pressed={source?.origin === 'project'} onClick={pickProject}>
            <IconLayersIntersect size={20} /><span><small>{t('当前项目')}</small><strong>{projectDocument.name}</strong><em>{t('交给 GemCAD 或 Gem Cut Studio')}</em></span>
          </button> : null}
          <label className={`formats-picker formats-drop${dragging ? ' is-dragging' : ''}${source?.origin === 'file' ? ' is-selected' : ''}`}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => { event.preventDefault(); setDragging(false); readFile(event.dataTransfer.files?.[0]); }}>
            <IconFileImport size={20} /><span><small>{t('其他软件的文件')}</small><strong>{t(busy ? '正在读取…' : '选择或拖入文件')}</strong><em>GemCAD .asc / .gem · Gem Cut Studio .gcs · {t('本软件')} .json</em></span>
            <input ref={fileInput} type="file" accept=".asc,.gem,.gcs,.json,text/plain,application/xml,application/json" className="sr-only" onChange={(event) => readFile(event.target.files?.[0])} />
          </label>
        </div>
        {source ? <SourcePanel key={`${source.origin}:${source.fileName}:${source.name}`} source={source} /> : <p className="formats-empty">{t('先选择当前项目或一个文件。读取不会修改原文件，也不会改变当前项目。')}</p>}
      </section>

      {targets.length ? <section className="formats-step" aria-labelledby="formats-target-title">
        <div className="formats-step-heading"><span>2</span><h2 id="formats-target-title">{t('选择去向')}</h2></div>
        <div className="formats-targets" role="radiogroup" aria-labelledby="formats-target-title">
          {targets.map((target) => {
            const plan = plans[target];
            return <button key={target} type="button" role="radio" aria-checked={active === target} className={`formats-target is-${plan.outcome}${active === target ? ' is-selected' : ''}`} onClick={() => setSelected(target)}>
              <span className="formats-target-title"><strong>{t(TARGETS[target].label)}</strong>{TARGETS[target].extension ? <em>{TARGETS[target].extension}</em> : null}</span>
              <span className="formats-target-apps">{t(TARGETS[target].apps)}</span>
              <span className={`formats-outcome is-${plan.outcome}`}>{outcomeText(plan)}</span>
              <span className="formats-target-summary">{summaryLine(plan)}</span>
            </button>;
          })}
        </div>
        {active ? <TargetDetail plan={plans[active]} source={source} onRun={run} busy={busy} /> : null}
        {message ? <p className="formats-message" role="status">{message}</p> : null}
      </section> : null}

      <CompareTable present={source?.status === 'error' ? null : source?.present} />
      <footer className="labs-footer"><span>SUVA · FACET 96</span><span>{t('转换只读取原文件；本软件项目（JSON）始终是完整主文件。')}</span></footer>
    </div></div>
  </main>;
}
