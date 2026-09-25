import { useEffect, useRef } from 'react';
import { Button, IconButton } from '../controls.jsx';

export function Modal({ controller, title, large = false, subtitle = 'FACET 96 · PATTERN LAB', className = '', footer, children }) {
  const bodyRef = useRef(null);

  useEffect(() => {
    const previous = document.activeElement;
    bodyRef.current?.querySelector('button, a, input:not([hidden]), select, textarea')?.focus();
    return () => previous?.focus?.();
  }, []);

  function trapTab(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      controller.closeModal();
      return;
    }
    if (e.key !== 'Tab') return;
    const controls = [
      ...e.currentTarget.querySelectorAll('button, a, input:not([hidden]), select, textarea'),
    ].filter((x) => !x.disabled && x.getClientRects().length);
    if (!controls.length) return;
    const first = controls[0];
    const last = controls.at(-1);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) controller.closeModal();
      }}
    >
      <section
        className={`modal${large ? ' large' : ''} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onKeyDown={trapTab}
      >
        <header className="modal-header">
          <div>
            <h2 id="modal-title">{title}</h2>
            <span>{subtitle}</span>
          </div>
          <IconButton onClick={() => controller.closeModal()} icon="close" label="关闭对话框" />
        </header>
        <div className="modal-body" ref={bodyRef}>
          {children}
        </div>
        <footer className="modal-footer">
          <span className="hint">文件与计算均留在本机</span>
          <div>{footer ?? <Button onClick={() => controller.closeModal()} label="返回实验室" />}</div>
        </footer>
      </section>
    </div>
  );
}
