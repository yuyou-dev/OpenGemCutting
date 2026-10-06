import { useEffect, useState } from 'react';
import { IconArrowsMaximize } from '@tabler/icons-react';
import { t } from '../i18n/locale.js';
import { OpticsViewport } from './OpticsViewport.jsx';
import './quick-optics-preview.css';

/** Navigation belongs to this preview; geometry and material remain shared. */
export function QuickOpticsPreview({ polyhedron, facets, settings, active, onExpand }) {
  const [interacting, setInteracting] = useState(false);
  const [view, setView] = useState('top');
  const [resetViewRequest, setResetViewRequest] = useState(0);
  useEffect(() => {
    if (!active) { setInteracting(false); return; }
    const pointers = new Set();
    const begin = event => { pointers.add(event.pointerId); setInteracting(true); };
    const end = event => { pointers.delete(event.pointerId); setInteracting(pointers.size > 0); };
    const reset = () => { pointers.clear(); setInteracting(false); };
    document.addEventListener('pointerdown', begin, true);
    document.addEventListener('pointerup', end, true);
    document.addEventListener('pointercancel', end, true);
    window.addEventListener('blur', reset);
    return () => {
      document.removeEventListener('pointerdown', begin, true);
      document.removeEventListener('pointerup', end, true);
      document.removeEventListener('pointercancel', end, true);
      window.removeEventListener('blur', reset);
    };
  }, [active]);
  return <section className="quick-optics-preview" aria-label={t('快捷光学仿真')}>
    <header><span>{t('光学预览')}<small>{t('全抛光')}</small></span><div>
      <button type="button" onClick={() => { setView('top'); setResetViewRequest(value => value + 1); }}>{t('台面')}</button>
      <button type="button" onClick={onExpand}><IconArrowsMaximize size={13} aria-hidden="true" />{t('展开')}</button>
    </div></header>
    <div className="quick-optics-canvas">
      {active ? <OpticsViewport polyhedron={polyhedron} facets={facets} settings={settings} inspectorOpen={false}
        compact resetViewRequest={resetViewRequest} interactionActive={interacting} viewMode={view} onViewModeChange={setView} /> : null}
    </div>
  </section>;
}
