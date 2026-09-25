import './parameter-groups.css';
import { useMemo } from 'react';
import { t } from '../i18n/locale.js';
import { INDEX_GEARS, indexCompatibilityReport } from '../domain/indexing.js';

export function IndexCompatibilityPanel({ document, facets, error = '', canChangeGear, onGearChange }) {
  const gear = document.indexGear.teeth;
  const gears = useMemo(() => [...new Set([...INDEX_GEARS, gear])].sort((a, b) => a - b), [gear]);
  const rows = useMemo(() => error ? gears.map(teeth => ({ teeth, compatible: false }))
    : indexCompatibilityReport(facets, { gears }), [facets, gears, error]);
  return <section className="control-section index-compatibility" aria-label={t('分度与兼容性')}>
    <div className="parameter-group-content">
      <label className="gear-selector"><span>{t('切磨分度盘')}</span><select aria-label={t('设计分度盘')} value={gear} disabled={!canChangeGear} onChange={event => onGearChange(Number(event.target.value))}>
        {gears.map(teeth => <option key={teeth} value={teeth}>{teeth} {t('齿')}</option>)}
      </select></label>
      <div className="compatibility-grid" aria-label={t('分度匹配')}>
        {rows.map(row => <span key={row.teeth} className={`compatibility-cell ${row.compatible ? 'is-compatible' : 'is-incompatible'}${row.teeth === gear ? ' is-selected' : ''}`} aria-label={`${row.teeth} ${t(row.compatible ? '符合' : '不符合')}`}>
          <i aria-hidden="true" />{row.teeth}
        </span>)}
      </div>
    </div>
  </section>;
}
