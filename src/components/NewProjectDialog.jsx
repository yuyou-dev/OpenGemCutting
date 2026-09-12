import { t } from '../i18n/locale.js';
import { useId, useMemo, useRef, useState } from 'react';
import { IconCheck, IconCube, IconDownload, IconFileUpload, IconShape, IconX } from '@tabler/icons-react';
import { STOCK_PRESETS, createPresetStockDocument } from '../domain/stockPresets.js';
import { createStockSolid } from '../domain/stockGeometry.js';
import { createWorkbenchDocument } from '../domain/document.js';
import { buildConstructionStages } from '../domain/constructionHistory.js';
import { TechnicalPreview } from './TechnicalPreview.jsx';
import { GemViewport } from './GemViewport.jsx';
import { useDialogFocus } from './useDialogFocus.js';
import './NewProjectDialog.css';

export function NewProjectDialog({ onClose, onDefault, onPreset, onUpload }) {
  const panelRef = useRef(null), titleId = useId();
  const [mode, setMode] = useState('default');
  const [selected, setSelected] = useState(STOCK_PRESETS[0].id);
  useDialogFocus(panelRef, onClose);
  const presets = useMemo(() => STOCK_PRESETS.map(p => {
    const document = createPresetStockDocument(p);
    return { ...p, document, solid: createStockSolid(document.stock) };
  }), []);
  const standard = useMemo(() => buildConstructionStages(createWorkbenchDocument('默认起点')).at(-1).afterSolid, []);
  const preset = presets.find(p => p.id === selected);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <section className="modal-panel stock-start-panel" ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header className="asc-transfer-heading"><div><span className="asc-eyebrow">NEW DESIGN · STARTING SHAPE</span><h2 id={titleId}>{t("从什么形状开始？")}</h2></div><button className="modal-close" aria-label={t("关闭新建项目")} onClick={onClose}><IconX size={17}/></button></header>
      <div className="stock-start-body">
        <p className="stock-start-intro">{t("选择适合设计的起点。确认后创建独立项目，当前设计仍会保留。")}</p>
        <div className="stock-start-modes" role="group" aria-label={t("选择设计起点")}>
          <button aria-pressed={mode === 'default'} onClick={() => setMode('default')}><IconCube size={21}/><span><strong>{t("默认起点")}</strong><small>{t("无需准备模型")}</small></span></button>
          <button aria-pressed={mode === 'preset'} onClick={() => setMode('preset')}><IconShape size={21}/><span><strong>{t("预设底胚")}</strong><small>{t("四种异形柱体")}</small></span></button>
          <button aria-pressed={false} onClick={onUpload}><IconFileUpload size={21}/><span><strong>{t("上传底胚")}</strong><small>{t("OBJ 文件 · 先检查再创建")}</small></span></button>
        </div>
        {mode === 'default' ? <div className="stock-start-default"><TechnicalPreview solid={standard} view="isometric" label={t("默认起点真实预览")}/><div><span className="stock-start-kicker">{t("熟悉的起点")}</span><h3>{t("从默认圆柱外观开始")}</h3><p>{t("沿用当前新建方式，包含默认台面与腰部。创建后即可安排下一道切割。")}</p><p className="stock-start-note">{t("不需要上传文件，也无需选择异形底胚。")}</p></div></div> : <div className="stock-start-presets">
          <div className="stock-start-grid" role="group" aria-label={t("选择预设底胚")}>{presets.map(p => <button key={p.id} className="stock-preset-card" aria-pressed={p.id === selected} aria-label={t("选择{0}底胚", [t(p.name)])} onClick={() => setSelected(p.id)}><span className="stock-preset-outline"><TechnicalPreview solid={p.solid} view="top" label={t("{0}横截面", [p.name])}/></span><span className="stock-preset-caption"><strong>{t(p.name)}</strong>{p.id === selected && <IconCheck size={16}/>}<small>{t(p.symmetry)}</small></span></button>)}</div>
          <div className="stock-start-detail"><div className="stock-start-preview"><GemViewport key={preset.id} polyhedron={preset.solid}/></div><div className="stock-start-description"><h3>{t(preset.name)}{t("柱状底胚")}</h3><p>{t(preset.symmetry)} {t("· 高度为最大横向尺寸的 100%")}</p><p>{preset.solid.faces.length} {t("个底胚面片 · 从零切割开始")}{preset.holes.length ? t(' · 孔洞贯穿上下表面') : ''}</p><a href={`/stock-presets/${preset.id}.obj`} download><IconDownload size={15}/>{t("下载此底胚 OBJ")}</a></div></div>
        </div>}
      </div>
      <footer className="modal-actions asc-transfer-actions"><button className="secondary-button modal-button" onClick={onClose}>{t("取消")}</button><button className="primary-action modal-button" onClick={() => mode === 'default' ? onDefault() : onPreset(preset.document)}>{mode === 'default' ? t("使用默认起点") : t("使用{0}底胚", [t(preset.name)])} {t("· 新建项目")}</button></footer>
    </section>
  </div>;
}
