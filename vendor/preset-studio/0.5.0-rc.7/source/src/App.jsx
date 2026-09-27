import { useEffect, useState, useSyncExternalStore, useRef } from 'react';
import { createStudioStore } from './application/studioStore.js';
import { PendingDraftDialog } from './components/PendingDraftDialog.jsx';
import { Header } from './components/Header.jsx';
import { LibraryPanel } from './components/LibraryPanel.jsx';
import { ViewportColumn } from './components/ViewportColumn.jsx';
import { InspectorPanel } from './components/InspectorPanel.jsx';
import { Toast } from './components/Toast.jsx';
import { TransferDialog } from './components/TransferDialog.jsx';
import { StudioDialog } from './components/StudioDialogs.jsx';
import { RepairDialog } from './components/RepairDialog.jsx';
import { CreativeComparison } from './components/CreativeComparison.jsx';

const MODE_KEYS = { v: 'orbit', q: 'axial', g: 'axial', r: 'axial', s: 'axial' };

export function PresetStudioApp({ initialDocument, onApply, store: providedStore, presentation } = {}) {
    const [store] = useState(() => providedStore ?? createStudioStore({ onApply }));
    const embedded = presentation?.layout === 'embedded';
    const rootRef = useRef(null);
    const [libraryOpen, setLibraryOpen] = useState(false);
    useEffect(() => { store.setOnApply(onApply); }, [store, onApply]);
    useEffect(() => {
        store.start(initialDocument); // Host document loads once per mount, as in v0.2.1.
        if (!embedded) window.presetStudio = store.api;
        return () => { if (window.presetStudio === store.api)
            delete window.presetStudio; if (!providedStore) store.destroy(); };
    }, [store]);
    useEffect(() => {
        if (embedded) return;
        const beforeUnload = e => { if (store.hasPendingDraft()) { e.preventDefault(); e.returnValue = ''; } };
        window.addEventListener('beforeunload', beforeUnload);
        return () => window.removeEventListener('beforeunload', beforeUnload);
    }, [store]);
    const snap = useSyncExternalStore(store.subscribe, store.getState, store.getState);
    useEffect(() => {
        const onKey = e => {
            const { dialog, transferOpen } = store.getState().overlay;
            if (dialog || transferOpen || libraryOpen || store.getState().overlay.discard)
                return;
            if (e.target?.matches?.('input,select,textarea') || !store.unlocked())
                return;
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                e.shiftKey ? store.redo() : store.undo();
                return;
            }
            const mode = MODE_KEYS[e.key.toLowerCase()];
            if (mode && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                store.setMode(mode);
            }
        };
        const target = embedded ? rootRef.current : window;
        target.addEventListener('keydown', onKey);
        return () => target.removeEventListener('keydown', onKey);
    }, [store, libraryOpen]);
    const { model, ui, preview, session, overlay } = snap;
    const stats = preview.lastPreview?.stats;
    const footerStatus = stats ? `${preview.renderMode || '—'} · ${model.stock.polys.length} 原石面 · ${stats.vertices} 顶点 · JSON 文件保存` : '平面半空间 / 保留完整工序 / 连续几何精度';
    return <div ref={rootRef} className={`ps-app${embedded ? ' ps-embedded' : ''}`}>
        <div className="ps-chrome" inert={overlay.transferOpen || overlay.dialog || overlay.discard ? true : undefined}>
            {!embedded ? <Header onHelp={() => store.openDialog({ type: 'help' })} onFiles={() => store.openTransfer()} /> : null}
            <main className="ps-main">
                <ViewportColumn store={store} model={model} ui={ui} preview={preview} session={session} libraryOpen={libraryOpen} onOpenLibrary={() => setLibraryOpen(true)} />
                <InspectorPanel store={store} model={model} ui={ui} preview={preview} />
            </main>
            <footer className="ps-footer"><span>{footerStatus}</span><span>几何预览 ≠ 光学认证 · R = 归一化参考半径</span></footer>
        </div>
        {libraryOpen ? <LibraryPanel store={store} model={model} ui={ui} onClose={() => setLibraryOpen(false)} /> : null}
        {overlay.discard ? <PendingDraftDialog store={store} pending={overlay.discard} /> : null}
        <Toast toast={overlay.toast} />
        {overlay.transferOpen ? <TransferDialog store={store} snap={snap} /> : null}
        {overlay.dialog?.type === 'creative' ? <CreativeComparison store={store} dialog={overlay.dialog} /> : overlay.dialog?.type === 'repair' ? <RepairDialog store={store} dialog={overlay.dialog} /> : overlay.dialog ? <StudioDialog store={store} dialog={overlay.dialog} model={model} /> : null}
    </div>;
}

export default function App() {
    return <PresetStudioApp />;
}
