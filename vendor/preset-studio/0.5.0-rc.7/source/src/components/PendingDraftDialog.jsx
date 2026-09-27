import { useEffect, useRef } from 'react';

/** Native top-layer dialog also works above the preset library drawer. */
export function PendingDraftDialog({ store, pending }) {
    const ref = useRef(null);
    useEffect(() => { ref.current.showModal(); }, []);
    return <dialog ref={ref} className="ps-pending-dialog" aria-labelledby="ps-pending-title" onCancel={e => { e.preventDefault(); store.cancelDiscard(); }}>
        <h2 id="ps-pending-title">保留未应用的修改？</h2>
        <p>「{pending.name}」还有未应用／未更新的整组切割。</p>
        <p>{pending.label}会放弃当前预览中的修改。若要保留，请返回编辑并先点击「应用整组切割」或「更新这一组切割」。</p>
        <footer><button type="button" autoFocus onClick={store.cancelDiscard}>继续编辑</button><button type="button" className="ps-primary" onClick={store.confirmDiscard}>放弃修改并继续</button></footer>
    </dialog>;
}
