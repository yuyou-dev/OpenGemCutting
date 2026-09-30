import { t } from '../i18n/locale.js';
import { useId, useMemo, useRef, useState } from 'react';
import { IconCheck, IconCube, IconDiamond, IconDownload, IconFileUpload, IconShape, IconX } from '@tabler/icons-react';
import { STOCK_PRESETS, createPresetStockDocument } from '../domain/stockPresets.js';
import { createStockSolid } from '../domain/stockGeometry.js';
import { INDEX_GEARS, compatibleRepeat } from '../domain/indexing.js';
import { withDocumentIndexGear } from '../domain/faceting.js';
import { createWorkbenchDocument, girdleFacetChoices, squareStartAvailable } from '../domain/document.js';
import { buildConstructionStages } from '../domain/constructionHistory.js';
import { TechnicalPreview } from './TechnicalPreview.jsx';
import { GemViewport } from './GemViewport.jsx';
import { useDialogFocus } from './useDialogFocus.js';
import './NewProjectDialog.css';

export function NewProjectDialog({ onClose, onDefault, onPreset, onUpload, onStartPreset, indexTeeth, onIndexTeethChange }) {
  const panelRef = useRef(null), titleId = useId();
  const [mode, setMode] = useState('default');
  const [selected, setSelected] = useState(STOCK_PRESETS[0].id);
  useDialogFocus(panelRef, onClose);
  const presets = useMemo(() => STOCK_PRESETS.map(p => {
    const document = createPresetStockDocument(p);
    return { ...p, document, solid: createStockSolid(document.stock) };
  }), []);
  const [outlineChoice, setOutline] = useState('cylinder');
  const [girdleChoice, setGirdleChoice] = useState(null);
  const squareAvailable = squareStartAvailable(indexTeeth);
  const outline = outlineChoice === 'square' && squareAvailable ? 'square' : 'cylinder';
  const girdleChoices = girdleFacetChoices(indexTeeth);
  // A wheel change keeps the chosen count only when the new wheel divides it.
  const girdleFacets = girdleChoices.includes(girdleChoice) ? girdleChoice : compatibleRepeat(indexTeeth);
  const start = outline === 'square' ? { outline } : { outline, girdleFacets };
  const standard = useMemo(() => buildConstructionStages(createWorkbenchDocument('默认起点', indexTeeth, start)).at(-1).afterSolid, [indexTeeth, outline, girdleFacets]);
  const preset = presets.find(p => p.id === selected);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <section className="modal-panel stock-start-panel" ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header className="asc-transfer-heading"><div><span className="asc-eyebrow">NEW DESIGN · STARTING SHAPE</span><h2 id={titleId}>{t("从什么形状开始？")}</h2></div><button className="modal-close" aria-label={t("关闭新建项目")} onClick={onClose}><IconX size={17}/></button></header>
      <div className="stock-start-body">
        <p className="stock-start-intro">{t("选择适合设计的起点。确认后创建独立项目，当前设计仍会保留。")}</p>
        <label className="gear-selector project-gear"><span>{t("切磨设备分度盘")}</span><select aria-label={t("切磨设备分度盘")} value={indexTeeth} onChange={event => onIndexTeethChange(Number(event.target.value))}>{INDEX_GEARS.map(teeth => <option value={teeth} key={teeth}>{teeth} {t("齿")}</option>)}</select></label>
        <div className="stock-start-modes" role="group" aria-label={t("选择设计起点")}>
          <button aria-pressed={mode === 'default'} onClick={() => setMode('default')}><IconCube size={21}/><span><strong>{t("默认起点")}</strong><small>{t("无需准备模型")}</small></span></button>
          <button onClick={onStartPreset}><IconDiamond size={21}/><span><strong>{t("从预设琢型开始")}</strong><small>{t("选择已有切工，继续设计")}</small></span></button>
          <button aria-pressed={mode === 'preset'} onClick={() => setMode('preset')}><IconShape size={21}/><span><strong>{t("预设底胚")}</strong><small>{t("四种异形柱体")}</small></span></button>
          <button aria-pressed={false} onClick={onUpload}><IconFileUpload size={21}/><span><strong>{t("上传底胚")}</strong><small>{t("OBJ 文件 · 先检查再创建")}</small></span></button>
        </div>
        {mode === 'default' ? <div className="stock-start-default"><TechnicalPreview solid={standard} view="isometric" label={t("默认起点真实预览")}/><div><span className="stock-start-kicker">{t("熟悉的起点")}</span><h3>{outline === 'square' ? t("从正方形外观开始") : t("从默认圆柱外观开始")}</h3><p>{t("沿用当前新建方式，包含默认台面与腰部。创建后即可安排下一道切割。")}</p>
          <div className="stock-start-outline" role="group" aria-label={t("默认起点外形")}>
            <button type="button" aria-pressed={outline === 'cylinder'} onClick={() => setOutline('cylinder')}>{t("圆柱")}</button>
            <button type="button" aria-pressed={outline === 'square'} disabled={!squareAvailable} onClick={() => setOutline('square')}>{t("正方形 · 四次对称")}</button>
          </div>
          {outline === 'cylinder' ? <label className="stock-start-girdle"><span>{t("腰棱数")}</span><select aria-label={t("默认起点腰棱数")} value={girdleFacets} onChange={event => setGirdleChoice(Number(event.target.value))}>{girdleChoices.map(count => <option key={count} value={count}>{t("{0} 面", [count])}</option>)}</select><small>{t("只列出 {0} 齿分度盘能整齿等分的面数。", [indexTeeth])}</small></label>
            : <p className="stock-start-girdle-note">{t("G1 腰部切 4 个面，四边正对 {0} 齿方向；之后可像普通腰部层一样编辑。", [[0, 1, 2, 3].map(q => q * indexTeeth / 4 || indexTeeth).join(' / ')])}</p>}
          {!squareAvailable ? <p className="stock-start-girdle-note">{t("{0} 齿不能被 4 整除，无法整齿切出正方形。", [indexTeeth])}</p> : null}
          <p className="stock-start-note">{t("此方式不使用实体底胚。底胚只能在新建时选择，创建后不可更换或缩放。")}</p></div></div> : <div className="stock-start-presets">
          <div className="stock-start-grid" role="group" aria-label={t("选择预设底胚")}>{presets.map(p => <button key={p.id} className="stock-preset-card" aria-pressed={p.id === selected} aria-label={t("选择{0}底胚", [t(p.name)])} onClick={() => setSelected(p.id)}><span className="stock-preset-outline"><TechnicalPreview solid={p.solid} view="top" label={t("{0}横截面", [p.name])}/></span><span className="stock-preset-caption"><strong>{t(p.name)}</strong>{p.id === selected && <IconCheck size={16}/>}<small>{t(p.symmetry)}</small></span></button>)}</div>
          <div className="stock-start-detail"><div className="stock-start-preview"><GemViewport key={preset.id} polyhedron={preset.solid}/></div><div className="stock-start-description"><h3>{t("{0}柱状底胚", [t(preset.name)])}</h3><p>{t(preset.symmetry)} {t("· 高度为最大横向尺寸的 100%")}</p><p>{preset.solid.faces.length} {t("个底胚面片 · 从零切割开始")}{preset.holes.length ? t(' · 孔洞贯穿上下表面') : ''}</p><a href={`${import.meta.env.BASE_URL}stock-presets/${preset.id}.obj`} download><IconDownload size={15}/>{t("下载此底胚 OBJ")}</a></div></div>
        </div>}
      </div>
      <footer className="modal-actions asc-transfer-actions"><button className="secondary-button modal-button" onClick={onClose}>{t("取消")}</button><button className="primary-action modal-button" onClick={() => mode === 'default' ? onDefault(indexTeeth, start) : onPreset(withDocumentIndexGear(preset.document, indexTeeth))}>{mode === 'default' ? t("使用默认起点") : t("使用{0}底胚", [t(preset.name)])} {t("· 新建项目")}</button></footer>
    </section>
  </div>;
}
