import { useEffect, useRef, useState } from 'react';

/** Shared modal chrome: Escape cancels, Tab is trapped, confirm errors stay inline. */
export function Modal({ title, confirmText, onConfirm, onClose, confirmDisabled = false, children, className = '', cancelText = '取消' }) {
    const [error, setError] = useState('');
    const backdropRef = useRef(null);
    const closeRef = useRef(onClose);
    closeRef.current = onClose;
    useEffect(() => {
        const node = backdropRef.current, previouslyFocused = document.activeElement;
        const timer = setTimeout(() => node.querySelector('input,button')?.focus(), 0);
        const onKey = e => {
            if (e.key === 'Escape') {
                e.preventDefault();
                closeRef.current();
            }
            if (e.key === 'Tab') {
                const focus = [...node.querySelectorAll('button,input,select,[tabindex]')].filter(x => !x.disabled), first = focus[0], last = focus.at(-1);
                if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                }
                else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        };
        node.addEventListener('keydown', onKey);
        return () => { clearTimeout(timer); node.removeEventListener('keydown', onKey); previouslyFocused?.focus?.(); };
    }, []);
    const confirm = async () => { try {
        await onConfirm?.();
        closeRef.current();
    }
    catch (e) {
        setError(e.message);
    } };
    return <div className="ps-dialog-backdrop" ref={backdropRef}>
        <section className={`ps-dialog ${className}`} role="dialog" aria-modal="true" aria-labelledby="ps-modal-title">
            <h2 id="ps-modal-title">{title}</h2>
            {children}
            <div className="ps-error-inline" role="alert">{error}</div>
            <footer><button type="button" onClick={() => closeRef.current()}> {cancelText} </button><button type="button" className="ps-primary" onClick={confirm} disabled={confirmDisabled}>{confirmText}</button></footer>
        </section>
    </div>;
}
