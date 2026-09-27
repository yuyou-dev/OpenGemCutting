import { memo, useEffect, useMemo, useRef } from 'react';
import { IconX } from '@tabler/icons-react';
import { libraryView } from '../application/viewModels.js';

const PresetCard = memo(function PresetCard({ card, onSelect }) {
    return <button type="button" className={`ps-preset-card${card.active ? ' is-active' : ''}`} title={card.name} aria-pressed={card.active} onClick={() => onSelect(card.id)}>
        <span className="ps-card-thumb" dangerouslySetInnerHTML={{ __html: card.thumb }} />
        <span className="ps-card-name">{card.name}</span>
        <small className="ps-card-meta"><span>{card.planes} 面</span><span>{card.gearNote}</span></small>
    </button>;
});

const LIBRARY_TABS = [['crown', '冠部'], ['pavilion', '亭部']];

export function LibraryPanel({ store, model, ui, onClose }) {
    const dialog = useRef(null);
    useEffect(() => { dialog.current.showModal(); }, []);
    const view = useMemo(() => libraryView(ui, model.machine.teeth), [ui, model.machine.teeth]);
    const dismiss = () => dialog.current.close();
    const select = id => {
        store.selectPreset(id, dismiss);
    };
    const onKeyDown = e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); dismiss(); }
        if (e.key === 'Tab') {
            const controls = [...dialog.current.querySelectorAll('button,input')].filter(el => !el.disabled);
            const first = controls[0], last = controls.at(-1);
            if (e.shiftKey && e.target === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && e.target === last) { e.preventDefault(); first.focus(); }
        }
    };
    return <dialog ref={dialog} id="ps-library-drawer" className="ps-library-dialog" aria-labelledby="ps-library-title" onClose={onClose}
        onKeyDownCapture={onKeyDown}
        onClick={e => { if (e.target === e.currentTarget) dismiss(); }}>
        <aside className="ps-library">
        <div className="ps-section-head"><h2 id="ps-library-title">预设库</h2><button type="button" aria-label="收起预设库" autoFocus onClick={dismiss}><IconX size={18} /></button></div>
        <p className="ps-library-intro">选择冠部或亭部，返回画布继续设计。</p>
        <div className="ps-tabs ps-segmented" role="tablist" aria-label="预设来源">
            {LIBRARY_TABS.map(([key, name]) => <button key={key} type="button" role="tab" aria-selected={ui.library === key} className={ui.library === key ? 'is-active' : ''} onClick={() => store.setLibraryTab(key)}>{name}</button>)}
        </div>
        <input className="ps-search" type="search" placeholder="搜索名称、结构、标签…" aria-label="搜索预设" value={ui.search} onChange={e => store.setSearch(e.target.value)} />
        <div className="ps-filters">{view.filters.map(f => <button key={f.key} type="button" className={ui.filter === f.key ? 'is-active' : ''} onClick={() => store.setFilter(f.key)}>{f.name}</button>)}</div>
        <div className="ps-library-count">{view.count}</div>
        <div className="ps-cards">{view.cards.length ? view.cards.map(c => <PresetCard key={c.id} card={c} onSelect={select} />) : <div className="ps-empty">没有匹配的预设<br />试试其他名称或结构分类</div>}</div>
        </aside>
    </dialog>;
}
