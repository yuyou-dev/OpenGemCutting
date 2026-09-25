import { useEffect, useRef, useState } from 'react';
import { PROJECT_TEMPLATES as TEMPLATES, generateProjectPlan, readPresetPlan, readProjectFile, createProject } from '../state/projectLibrary.js';
import { fetchPresetCatalog } from '../state/presetCatalog.js';
import { Button, Icon } from './controls.jsx';
import { Modal } from './dialogs/Modal.jsx';

const TABS = [
  ['generate', '对称预设生成'],
  ['preset', '琢型库导入'],
  ['upload', '上传计划'],
];

export function NewProjectDialog({ onClose, onCreated }) {
  const [tab, setTab] = useState('generate');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // generate
  const [template, setTemplate] = useState('eight');
  const [density, setDensity] = useState(3);
  const [sizeMm, setSizeMm] = useState(10);
  const [genName, setGenName] = useState('八向图案');
  const [genNameDirty, setGenNameDirty] = useState(false);

  // preset library
  const [catalog, setCatalog] = useState(null);
  const [catalogStatus, setCatalogStatus] = useState('');
  const [query, setQuery] = useState('');
  const [presetPlan, setPresetPlan] = useState(null);
  const [presetId, setPresetId] = useState('');
  const [presetName, setPresetName] = useState('');

  // upload
  const fileRef = useRef(null);
  const [uploadPlan, setUploadPlan] = useState(null);
  const [uploadName, setUploadName] = useState('');
  const [fileName, setFileName] = useState('');

  useEffect(() => {
    if (tab !== 'preset' || catalog) return;
    let cancelled = false;
    setCatalogStatus('正在读取 Facet 96 预设…');
    fetchPresetCatalog()
      .then((data) => {
        if (cancelled) return;
        setCatalog(data);
        setCatalogStatus(`来源 ${data.sourceProject} ${data.sourceVersion} · ${data.presets.length} 个预设 · ${data.presets.filter((p) => p.compatibility.supported).length} 个可导入`);
      })
      .catch((e) => { if (!cancelled) setCatalogStatus(e.message); });
    return () => { cancelled = true; };
  }, [tab, catalog]);

  function switchTab(next) {
    setTab(next);
    setError('');
  }

  function pickTemplate(id) {
    setTemplate(id);
    if (!genNameDirty) setGenName(TEMPLATES.find((t) => t.id === id).name);
  }

  async function choosePreset(p) {
    if (!p.compatibility.supported || busy) return;
    setBusy(true);
    setError('');
    setPresetId(p.id);
    try {
      const plan = await readPresetPlan(p);
      setPresetPlan(plan);
      setPresetName(p.name);
    } catch (e) {
      setPresetPlan(null);
      setPresetId('');
      setError(`未导入：${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function chooseFile(file) {
    if (!file) return;
    setError('');
    setUploadPlan(null);
    setFileName('');
    try {
      const plan = await readProjectFile(file);
      setUploadPlan(plan);
      setUploadName(plan.name ?? '');
      setFileName(file.name);
    } catch (e) {
      setError(`未导入：${e.message}`);
    }
  }

  function create() {
    setError('');
    try {
      let plan;
      let name;
      if (tab === 'generate') {
        const t = TEMPLATES.find((x) => x.id === template);
        plan = generateProjectPlan(template, density, sizeMm);
        name = genName.trim() || t.name;
      } else if (tab === 'preset') {
        if (!presetPlan) {
          setError('请先在琢型库中选择一个预设。');
          return;
        }
        plan = presetPlan;
        name = presetName.trim() || presetPlan.name;
      } else {
        if (!uploadPlan) {
          setError('请先选择并解析一个 JSON 计划文件。');
          return;
        }
        plan = uploadPlan;
        name = uploadName.trim() || uploadPlan.name;
      }
      const record = createProject(plan, name);
      onCreated(record.id);
    } catch (e) {
      setError(e.message);
    }
  }

  const presets = (catalog?.presets ?? []).filter((p) =>
    [p.name, p.designer, p.shape].join(' ').toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <Modal controller={{ closeModal: onClose }} title="新建工程" large
      footer={<>
        <Button onClick={onClose} label="取消" className="subtle" />
        <Button onClick={create} label="创建工程" className="primary" disabled={busy} />
      </>}>
      <div className="segment new-project-tabs" role="tablist" aria-label="新建方式">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => switchTab(id)}>{label}</button>
        ))}
      </div>

      {tab === 'generate' ? (
        <div className="new-project-form">
          <label className="select-field"><span>工程名称</span>
            <input type="text" value={genName} maxLength={80} onChange={(e) => { setGenName(e.target.value); setGenNameDirty(true); }} />
          </label>
          <label className="select-field"><span>图案模板</span>
            <select value={template} onChange={(e) => pickTemplate(e.target.value)}>
              {TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>
          <div className="design-field-pair">
            <label className="select-field"><span>图案密度</span>
              <select value={density} onChange={(e) => setDensity(Number(e.target.value))}>
                {[1, 2, 3, 4].map((v) => <option key={v} value={v}>{v} 级</option>)}
              </select>
            </label>
            <label className="select-field"><span>成品宽度（4–30 mm）</span>
              <input type="number" min={4} max={30} step={0.5} value={sizeMm} onChange={(e) => setSizeMm(Number(e.target.value))} />
            </label>
          </div>
          <p className="field-note">创建后模板、密度与宽度将锁定，不能在编辑器内更换。</p>
        </div>
      ) : tab === 'preset' ? (
        <div className="new-project-form">
          <input className="facet-search" type="search" aria-label="搜索预设琢型" placeholder="搜索琢型、形状或设计师…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <p className="preset-status" role="status">{busy ? '正在导入预设…' : catalogStatus}</p>
          <div className="preset-grid">
            {presets.map((p) => (
              <button key={p.id} type="button" className={`preset-card${presetId === p.id && presetPlan ? ' selected' : ''}`}
                disabled={busy || !p.compatibility.supported} onClick={() => choosePreset(p)}>
                <img src={`/facet96-presets/${p.previews.top}`} alt="" loading="lazy" />
                <strong>{p.name}</strong>
                <span>{p.shape} · {p.facetCount} 面</span>
                <small>{p.designer}</small>
                {!p.compatibility.supported ? <small>暂不兼容 · 顶点连接检查未通过</small> : null}
              </button>
            ))}
          </div>
          {catalog && !presets.length ? <p>没有匹配的琢型，请更换关键词。</p> : null}
          {presetPlan ? (
            <label className="select-field"><span>工程名称</span>
              <input type="text" value={presetName} maxLength={80} onChange={(e) => setPresetName(e.target.value)} />
            </label>
          ) : null}
        </div>
      ) : (
        <div className="new-project-form">
          <input ref={fileRef} type="file" accept=".json,application/json" hidden
            onChange={(e) => chooseFile(e.target.files?.[0])} />
          <Button onClick={() => { fileRef.current.value = ''; fileRef.current.click(); }} label="选择 JSON 计划文件" icon="upload" className="create" />
          <p className="field-note">支持图案实验室计划 JSON 与 Facet 96 文档，不超过 5 MB；约束图不是琢型计划，不能作为新建来源。</p>
          {uploadPlan ? (
            <>
              <p className="new-project-staged"><Icon name="info" size={14} />已解析「{fileName}」：{uploadPlan.planes.length} 个切面 · {uploadPlan.machine.teeth} 齿。</p>
              <label className="select-field"><span>工程名称</span>
                <input type="text" value={uploadName} maxLength={80} onChange={(e) => setUploadName(e.target.value)} />
              </label>
            </>
          ) : null}
        </div>
      )}

      {error ? <p className="new-project-error" role="alert">{error}</p> : null}
    </Modal>
  );
}
