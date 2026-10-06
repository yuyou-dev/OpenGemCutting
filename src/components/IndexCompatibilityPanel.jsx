import './parameter-groups.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n/locale.js';
import { INDEX_GEARS, indexCompatibilityReport } from '../domain/indexing.js';

function CompatibilityGrid({ rows, gear }) {
  return <div className="compatibility-grid" aria-label={t('分度匹配')}>
    {rows.map(row => <span key={row.teeth} className={`compatibility-cell ${row.compatible ? 'is-compatible' : 'is-incompatible'}${row.teeth === gear ? ' is-selected' : ''}`} aria-label={`${row.teeth} ${t(row.compatible ? '符合' : '不符合')}`}>
      <i aria-hidden="true" />{row.teeth}
    </span>)}
  </div>;
}

/**
 * The design wheel and whole-tooth compatibility of the current facets on
 * every common wheel. `compact` fits one header row: the wheel select and a
 * summary chip whose popover holds the same per-wheel dots.
 */
export function IndexCompatibilityPanel({ document, facets, error = '', canChangeGear, onGearChange, compact = false }) {
  const gear = document.indexGear.teeth;
  const gears = useMemo(() => [...new Set([...INDEX_GEARS, gear])].sort((a, b) => a - b), [gear]);
  const rows = useMemo(() => error ? gears.map(teeth => ({ teeth, compatible: false }))
    : indexCompatibilityReport(facets, { gears }), [facets, gears, error]);
  const [open, setOpen] = useState(false);
  const popoverRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => { if (!popoverRef.current?.contains(event.target)) setOpen(false); };
    // Capture phase: Escape closes only the popover and never reaches the editor's CUT Escape.
    const escape = (event) => { if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); setOpen(false); } };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', escape, true);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', escape, true); };
  }, [open]);
  const select = <select aria-label={t('设计分度盘')} value={gear} disabled={!canChangeGear} onChange={event => onGearChange(Number(event.target.value))}>
    {gears.map(teeth => <option key={teeth} value={teeth}>{teeth} {t('齿')}</option>)}
  </select>;
  if (compact) {
    const compatible = rows.filter(row => row.compatible).length;
    const ownWheel = rows.find(row => row.teeth === gear)?.compatible;
    return <div className="index-compatibility is-compact" ref={popoverRef}>
      <label className="gear-selector" title={canChangeGear ? t('切磨分度盘') : t('请先保存或取消当前操作')}><span className="sr-only">{t('切磨分度盘')}</span>{select}</label>
      <button type="button" className={`compatibility-summary${ownWheel ? '' : ' is-incompatible'}`} aria-expanded={open} aria-label={t('分度兼容：{0} / {1} 个分度盘整齿', [compatible, rows.length])} onClick={() => setOpen(value => !value)}>
        <i aria-hidden="true" />{t('兼容 {0}/{1}', [compatible, rows.length])}
      </button>
      {open ? <div className="compatibility-popover" role="dialog" aria-label={t('分度与兼容性')}>
        <strong>{t('分度匹配')}</strong>
        <p>{t('当前设计（含未保存预览）的每个刻面能否落在这些分度盘的整齿上。')}</p>
        <CompatibilityGrid rows={rows} gear={gear} />
      </div> : null}
    </div>;
  }
  return <section className="control-section index-compatibility" aria-label={t('分度与兼容性')}>
    <div className="parameter-group-content">
      <label className="gear-selector"><span>{t('切磨分度盘')}</span>{select}</label>
      <CompatibilityGrid rows={rows} gear={gear} />
    </div>
  </section>;
}
