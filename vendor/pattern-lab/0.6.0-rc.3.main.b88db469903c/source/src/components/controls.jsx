import { useEffect, useState } from 'react';
import {
  IconUpload,
  IconDownload,
  IconDeviceFloppy,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconHelp,
  IconX,
  IconAdjustmentsHorizontal,
  IconEye,
  IconInfoCircle,
  IconPlayerPlay,
  IconFileAnalytics,
  IconPhoto,
  IconPointer,
  IconCircle,
  IconLine,
  IconHexagon,
  IconArrowsJoin,
  IconChevronDown,
  IconArrowUp,
  IconArrowDown,
  IconArrowLeft,
  IconArrowRight,
  IconPlus,
  IconPencil,
  IconCopy,
  IconTrash,
} from '@tabler/icons-react';

const TABLER = {
  upload: IconUpload,
  download: IconDownload,
  save: IconDeviceFloppy,
  undo: IconArrowBackUp,
  redo: IconArrowForwardUp,
  help: IconHelp,
  close: IconX,
  settings: IconAdjustmentsHorizontal,
  eye: IconEye,
  info: IconInfoCircle,
  play: IconPlayerPlay,
  analytics: IconFileAnalytics,
  photo: IconPhoto,
  select: IconPointer,
  vertex: IconCircle,
  edge: IconLine,
  face: IconHexagon,
  merge: IconArrowsJoin,
  chevron: IconChevronDown,
  up: IconArrowUp,
  down: IconArrowDown,
  left: IconArrowLeft,
  right: IconArrowRight,
  plus: IconPlus,
  edit: IconPencil,
  copy: IconCopy,
  trash: IconTrash,
};

export function Icon({ name, size = 16, stroke = 1.7 }) {
  const C = TABLER[name] ?? IconInfoCircle;
  return <C size={size} stroke={stroke} aria-hidden="true" />;
}

export function Button({ onClick, label, icon = '', className = '', title = '', disabled = false }) {
  return (
    <button
      type="button"
      className={`button ${className}`}
      title={title || label}
      onClick={onClick}
      disabled={disabled}
    >
      {icon ? <Icon name={icon} /> : null}
      <span>{label}</span>
    </button>
  );
}

export function IconButton({ onClick, icon, label, className = '', active = false, disabled = false }) {
  return (
    <button
      type="button"
      className={`icon-button ${className}${active ? ' active' : ''}`}
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon name={icon} />
    </button>
  );
}

export function Section({ title, extra = null, children }) {
  return (
    <section className="inspector-section">
      <div className="section-heading">
        <h3>{title}</h3>
        {extra}
      </div>
      {children}
    </section>
  );
}

export function FoldSection({ title, extra = null, children, open = false, className = '' }) {
  return (
    <details className={`fold-section ${className}`} open={open || undefined}>
      <summary>
        <span>{title}</span>
        {extra ? <span className="fold-extra">{extra}</span> : null}
        <Icon name="chevron" size={16} />
      </summary>
      <div className="fold-content">{children}</div>
    </details>
  );
}

export function Toggle({ label, checked, onChange, note = '', disabled = false }) {
  return (
    <label className="toggle-row">
      <span>{label}{note ? <small>{note}</small> : null}</span>
      <input type="checkbox" aria-label={label} checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <i aria-hidden="true" />
    </label>
  );
}

export function Note({ children }) {
  return (
    <p className="note">
      <Icon name="info" size={14} />
      <span>{children}</span>
    </p>
  );
}

/** Range slider that previews locally while dragging and commits on release,
 * matching the original input→label / change→recompile split. */
export function DeferredRange({ label, value, min, max, step, format, onCommit, disabled = false }) {
  const [draft, setDraft] = useState(null);
  const shown = draft ?? value;
  const percent = Math.min(100, Math.max(0, ((shown - min) / (max - min)) * 100));
  useEffect(() => setDraft(null), [value]);

  function commit() {
    if (draft === null) return;
    const v = Number(draft);
    setDraft(null);
    if (v !== value) onCommit(v);
  }

  return (
    <div className="field">
      <div className="field-top">
        <label>{label}</label>
        <code className="range-value">{format(shown)}</code>
      </div>
      <input
        className="range"
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={shown}
        disabled={disabled}
        style={{ '--value': percent + '%' }}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
    </div>
  );
}

/** Number input that commits on Enter / blur, never mid-keystroke. */
export function DeferredNumber({ label, value, min, max, step, unit = '', onCommit, disabled = false, mono = true, list, placeholder }) {
  const [draft, setDraft] = useState(null);
  useEffect(() => setDraft(null), [value]);

  function commit() {
    if (draft === null) return;
    const text = draft;
    setDraft(null);
    if (text === '') return;
    const n = Number(text);
    if (!Number.isFinite(n)) return;
    onCommit(n);
  }

  return (
    <div className="field compact">
      <div className="field-top">
        <label>{label}</label>
        <div className="numeric">
          <input
            aria-label={label}
            list={list}
            placeholder={placeholder}
            type="number"
            min={min}
            max={max}
            step={step}
            value={draft ?? value}
            disabled={disabled}
            style={mono ? undefined : { fontFamily: 'inherit' }}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              }
            }}
          />
          {unit ? <span>{unit}</span> : null}
        </div>
      </div>
    </div>
  );
}

/** Paired inputs share one draft; geometry updates only on release, Enter or blur. */
export function NumberSlider({ label, value, min, max, step, unit = '', onCommit }) {
  const [draft, setDraft] = useState(null);
  const shown = draft ?? value;
  useEffect(() => setDraft(null), [value]);
  function commit() {
    if (draft === null || draft === '') { setDraft(null); return; }
    const next = Math.min(max, Math.max(min, Number(draft)));
    setDraft(null);
    if (Number.isFinite(next) && next !== value) onCommit(next);
  }
  return <div className="field number-slider">
    <div className="field-top"><label>{label}</label><div className="numeric">
      <input aria-label={label} type="number" value={shown} min={min} max={max} step={step} placeholder="不同" onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }} />
      {unit && <span>{unit}</span>}
    </div></div>
    <input className="range" type="range" aria-label={`${label}滑动条`} min={min} max={max} step={step} value={shown === '' ? min : shown} style={{ '--value': `${((Number(shown || min) - min) / (max - min)) * 100}%` }} onChange={e => setDraft(e.target.value)} onPointerUp={commit} onKeyUp={commit} onBlur={commit} />
  </div>;
}
