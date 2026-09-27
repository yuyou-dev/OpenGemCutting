import { useEffect, useRef, useState } from 'react';
import { IconFileDescription, IconUpload, IconX } from '@tabler/icons-react';
import { TRANSFER_EXPORTS, transferFilename, readTransferFile } from '../domain/transfer.js';

/** The only file entry: validated import with impact confirmation, four managed export types. */
export function TransferDialog({ store, snap }) {
    const [tab, setTab] = useState('import');
    const [selected, setSelected] = useState('workspace');
    const [plan, setPlan] = useState(null);
    const [busy, setBusy] = useState(false);
    const [committing, setCommitting] = useState(false);
    const [message, setMessage] = useState({ text: '', error: false });
    const [dragOver, setDragOver] = useState(false);
    const requestRef = useRef(0), readVersionRef = useRef(null);
    const backdropRef = useRef(null), fileInputRef = useRef(null), filenameRef = useRef(null);
    const closeRef = useRef(() => { });
    closeRef.current = () => { if (!committing) {
        requestRef.current++;
        store.closeTransfer();
    } };
    useEffect(() => {
        const node = backdropRef.current, previouslyFocused = document.activeElement;
        const focusTimer = setTimeout(() => node.querySelector('[data-io-tab="import"]')?.focus(), 0);
        const onKey = e => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                closeRef.current();
                return;
            }
            if (e.target.dataset?.ioTab && ['ArrowLeft', 'ArrowRight'].includes(e.key)) {
                e.preventDefault();
                setTab(t => { const next = t === 'import' ? 'export' : 'import'; setMessage({ text: '', error: false }); setTimeout(() => node.querySelector(`[data-io-tab="${next}"]`)?.focus(), 0); return next; });
            }
            if (e.key === 'Tab') {
                const focusable = [...node.querySelectorAll('button,input,select,[tabindex]')].filter(x => !x.disabled && !x.hidden && x.tabIndex >= 0 && x.getClientRects().length), first = focusable[0], last = focusable.at(-1);
                if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last?.focus();
                }
                else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first?.focus();
                }
            }
        };
        node.addEventListener('keydown', onKey);
        return () => { clearTimeout(focusTimer); node.removeEventListener('keydown', onKey); previouslyFocused?.focus?.({ preventScroll: true }); };
    }, []);
    const choose = async fileList => {
        if (committing)
            return;
        const token = ++requestRef.current;
        setPlan(null);
        if (fileList.length !== 1) {
            setBusy(false);
            setMessage({ text: '请一次选择一个组件、工作区、本体文档或网格文件。', error: true });
            return;
        }
        setBusy(true);
        readVersionRef.current = store.getVersion();
        setMessage({ text: '', error: false });
        try {
            const nextPlan = await readTransferFile(fileList[0]);
            if (token !== requestRef.current)
                return;
            if (readVersionRef.current !== store.getVersion())
                throw new Error('读取期间工作区已变化，请重新选择文件');
            setPlan(nextPlan);
            setMessage({ text: '校验通过。确认导入前，当前设计不会改变。', error: false });
        }
        catch (e) {
            if (token === requestRef.current)
                setMessage({ text: e.message, error: true });
        }
        finally {
            if (token === requestRef.current)
                setBusy(false);
        }
    };
    const confirm = () => {
        if (tab === 'import') {
            if (!plan || busy)
                return;
            setCommitting(true);
            Promise.resolve().then(() => store.applyImportPlan(plan, readVersionRef.current)).then(() => store.closeTransfer()).catch(e => { setCommitting(false); setMessage({ text: e.message, error: true }); });
        }
        else {
            try {
                const name = transferFilename(filenameRef.current.value, selected);
                store.exportFile(selected, name);
                setMessage({ text: `已生成 ${name}。请查看浏览器下载记录。`, error: false });
            }
            catch (e) {
                setMessage({ text: e.message, error: true });
            }
        }
    };
    const switchTab = next => { setTab(next); setMessage({ text: '', error: false }); };
    const choice = TRANSFER_EXPORTS.find(x => x.id === selected);
    const status = store.exportStatus(selected); // snap prop keeps this fresh while open
    void snap;
    const confirmLabel = tab === 'import' ? (committing ? '正在导入…' : '确认导入') : '导出文件';
    const confirmDisabled = tab === 'import' ? !plan || busy || committing : !status.enabled;
    return <div className="ps-dialog-backdrop ps-transfer-backdrop" ref={backdropRef}>
        <section className="ps-dialog ps-transfer-dialog" role="dialog" aria-modal="true" aria-labelledby="ps-transfer-title" aria-describedby="ps-transfer-subtitle">
            <header className="ps-transfer-header">
                <div><h2 id="ps-transfer-title">导入 / 导出</h2><p id="ps-transfer-subtitle">项目、冠亭预设与三维模型，集中管理。</p></div>
                <button type="button" className="ps-icon-button" aria-label="关闭导入导出" onClick={() => closeRef.current()}><IconX size={20} stroke={1.5} /></button>
            </header>
            <div className="ps-tabs ps-transfer-tabs" role="tablist" aria-label="文件操作">
                <button type="button" role="tab" data-io-tab="import" aria-controls="ps-transfer-panel" aria-selected={tab === 'import'} tabIndex={tab === 'import' ? 0 : -1} className={tab === 'import' ? 'is-active' : ''} onClick={() => switchTab('import')}>导入文件</button>
                <button type="button" role="tab" data-io-tab="export" aria-controls="ps-transfer-panel" aria-selected={tab === 'export'} tabIndex={tab === 'export' ? 0 : -1} className={tab === 'export' ? 'is-active' : ''} onClick={() => switchTab('export')}>导出文件</button>
            </div>
            <div id="ps-transfer-panel" className="ps-transfer-panel" role="tabpanel" aria-labelledby={`ps-transfer-tab-${tab}`}>
                {tab === 'import' ? <div className="ps-transfer-import-grid">
                    <button type="button" className={`ps-transfer-dropzone${dragOver ? ' is-dragover' : ''}`} disabled={busy} onClick={() => fileInputRef.current.click()} onDragOver={e => { e.preventDefault(); setDragOver(true); }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false); }} onDrop={e => { e.preventDefault(); setDragOver(false); choose([...e.dataTransfer.files]); }}>
                        <IconUpload size={28} stroke={1.5} />
                        <strong>{busy ? '正在读取和校验…' : plan ? '重新选择文件' : '选择文件，或拖放到这里'}</strong>
                        <span>JSON · OBJ · STL</span>
                        <small>单个文件不超过 8 MiB</small>
                    </button>
                    <div className="ps-transfer-file-info">
                        {plan && ['component', 'workspace', 'native'].includes(plan.kind) && store.hasPendingDraft() ? <p className="ps-transfer-warning">当前有未应用的整组切割。确认导入会替换当前编辑内容；如需保留，请取消并先应用或导出完整工作区。</p> : null}
                        {plan ? <>
                            <div className="ps-transfer-file-title"><IconFileDescription size={21} stroke={1.5} /><strong>{plan.name}</strong></div>
                            <div className="ps-transfer-file-type">{plan.label} · {(plan.bytes / 1024).toFixed(1)} KB</div>
                            <p className="ps-transfer-summary">{plan.summary}</p>
                            <div className="ps-transfer-impact"><strong>导入后会发生什么</strong><p>{plan.impact}</p></div>
                            {plan.warnings.length ? <p className="ps-transfer-warning">{plan.warnings.map((w, i) => <span key={i}>{w}<br /></span>)}</p> : null}
                        </> : <>
                            <h3>支持的文件</h3>
                            <dl className="ps-transfer-support">
                                <dt>JSON</dt><dd>冠亭预设、完整工作区<br />OpenGemCutting 本体文档</dd>
                                <dt>OBJ / STL</dt><dd>闭合原石网格<br />最多 2000 个原石面</dd>
                            </dl>
                            <p className="ps-transfer-hint">先读取和校验，再确认导入。<br />选择文件不会立刻覆盖当前设计。</p>
                        </>}
                    </div>
                </div> : <div className="ps-transfer-export-grid">
                    <nav className="ps-transfer-formats" aria-label="导出类型">
                        {TRANSFER_EXPORTS.map(x => <button key={x.id} type="button" className={selected === x.id ? 'is-active' : ''} aria-pressed={selected === x.id} onClick={() => { setSelected(x.id); setMessage({ text: '', error: false }); }}><span>{x.title}</span><small>{x.format}</small></button>)}
                    </nav>
                    <div className="ps-transfer-export-detail">
                        <div className="ps-transfer-format">{choice.format}</div>
                        <h3>{choice.title}</h3>
                        <p>{choice.description}</p>
                        <label htmlFor="ps-transfer-filename">文件名<input id="ps-transfer-filename" ref={filenameRef} key={selected} maxLength={160} defaultValue={choice.filename} autoComplete="off" spellCheck="false" /></label>
                        <div className="ps-transfer-impact"><strong>保存范围</strong><p>{choice.note}</p></div>
                        {status.detail ? <p className="ps-transfer-scope">{status.detail}</p> : null}
                        {!status.enabled ? <p className="ps-transfer-warning" role="alert">{status.reason}</p> : null}
                    </div>
                </div>}
            </div>
            <div className={`ps-transfer-message${message.error ? ' is-error' : ''}`} role={message.error ? 'alert' : 'status'} aria-live="polite">{message.text}</div>
            <footer className="ps-transfer-footer">
                <small>文件只在当前浏览器处理，不会上传。</small>
                <div><button type="button" onClick={() => closeRef.current()}>关闭</button><button type="button" className="ps-primary" disabled={confirmDisabled} onClick={confirm}>{confirmLabel}</button></div>
            </footer>
            <input ref={fileInputRef} type="file" accept=".json,.obj,.stl" hidden onChange={e => { const files = [...e.target.files]; e.target.value = ''; if (files.length)
        void choose(files); }} />
        </section>
    </div>;
}
