import { useEffect, useState } from 'react';
import { Modal } from '../dialogs/Modal.jsx';
import { Button, Toggle } from '../controls.jsx';

export function NumberField({ label, value, min, max, step = 1, unit = '', onChange, slider = false, disabled = false }) {
  const [draft, setDraft] = useState(null);
  const decimals = String(step).split('.')[1]?.length ?? 0;
  const display = value.toFixed(decimals);
  useEffect(() => setDraft(null), [value]);
  const commit = () => {
    if (draft === null) return;
    const text = draft;
    setDraft(null);
    if (text !== '' && Number.isFinite(Number(text))) onChange(Number(text));
  };
  return <label className="lightlab-number-field">
    <span>{label}</span>
    <div className="numeric"><input aria-label={label} type="number" value={draft ?? display} min={min} max={max} step={step} disabled={disabled} onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { e.preventDefault(); setDraft(null); } }} /><span>{unit}</span></div>
    {slider && <input className="range" type="range" aria-label={`${label}滑杆`} value={value} min={min} max={max} step={step} disabled={disabled} style={{ '--value': `${(value - min) / (max - min) * 100}%` }} onChange={e => onChange(Number(e.target.value))} />}
  </label>;
}

export function SelectField({ label, value, onChange, children, disabled = false }) {
  return <label className="lightlab-select-field"><span>{label}</span><select aria-label={label} value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>{children}</select></label>;
}

export function ColorField({ label, value, onChange }) {
  return <label className="lightlab-color-field"><span>{label}</span><div><input type="color" aria-label={label} value={value} onChange={e => onChange(e.target.value)} /><code>{value.toUpperCase()}</code></div></label>;
}

export function ComparisonDialog({ title, subtitle, onClose, children, footer, large = false }) {
  return <Modal controller={{ closeModal: onClose }} title={title} subtitle={subtitle}
    className="lightlab-dialog" large={large} footer={footer ?? <Button label="完成" onClick={onClose} />}>
    {children}
  </Modal>;
}

export { Button, Toggle };
