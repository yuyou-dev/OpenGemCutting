import { useEffect, useId, useRef, useState } from 'react';
import { IconPrism } from '@tabler/icons-react';
import { t } from '../i18n/locale.js';
import { CONCAVE_PRESETS, concaveToolDepth } from '../application/concaveTools.js';
import './concave-panel.css';

function CutterIllustration({ type, fine }) {
  const id = useId();
  const radius = fine ? 12 : 23;
  if (type === 'triangular-prism') return <IconPrism stroke={1.2} color="#64766b" aria-hidden="true"/>;
  return <svg viewBox="0 0 84 72" aria-hidden="true">
    <defs><radialGradient id={`${id}-ball`} cx="30%" cy="23%" r="77%"><stop stopColor="#fff"/><stop offset=".34" stopColor="#d3d6d5"/><stop offset=".75" stopColor="#7d8481"/><stop offset="1" stopColor="#aeb4b1"/></radialGradient><linearGradient id={`${id}-metal`}><stop stopColor="#919995"/><stop offset=".28" stopColor="#edf0ee"/><stop offset=".7" stopColor="#b6bdb9"/><stop offset="1" stopColor="#7a827e"/></linearGradient></defs>
    <ellipse cx="42" cy="65" rx={radius + 3} ry="3" fill="#000" opacity=".06"/>
    {type === 'v-wheel' ? <><path d="M 42 7 L 76 36 L 42 64 L 8 36 Z" fill={`url(#${id}-metal)`} stroke="#89918d"/><path d="M 8 36 H 76 M 42 7 V 64" stroke="#89918d"/><ellipse cx="42" cy="36" rx="6" ry="4" fill="#747e78"/></> : type === 'sphere' ? <circle cx="42" cy="35" r="26" fill={`url(#${id}-ball)`} stroke="#909894" strokeWidth=".6"/> : <><path d={`M ${42-radius} 16 v 40 a ${radius} 8 0 0 0 ${radius*2} 0 V 16 Z`} fill={`url(#${id}-metal)`} stroke="#89918d" strokeWidth=".7"/><ellipse cx="42" cy="16" rx={radius} ry="8" fill="#e3e7e5" stroke="#89918d" strokeWidth=".7"/></>}
  </svg>;
}

function RotationDial({ value, repeat, disabled, onPreview, onFinish, onCancel }) {
  const dragging = useRef(false);
  const point = (angle, radius) => [50 + radius * Math.cos(angle * Math.PI / 180), 50 - radius * Math.sin(angle * Math.PI / 180)];
  const update = event => {
    const rect = event.currentTarget.getBoundingClientRect();
    const angle = Math.atan2(rect.top + rect.height / 2 - event.clientY, event.clientX - rect.left - rect.width / 2) * 180 / Math.PI;
    onPreview(Math.round(((angle + 360) % 360) * 10) / 10);
  };
  return <svg className="concave-rotation-dial" viewBox="0 0 100 100" role="slider" tabIndex={disabled ? -1 : 0} aria-disabled={disabled}
    aria-label={t('旋转凹切组')} aria-valuemin={0} aria-valuemax={360} aria-valuenow={value} aria-valuetext={`${value}°`}
    onPointerDown={e => { if (!disabled) { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); update(e); } }}
    onPointerMove={e => { if (!disabled && dragging.current && e.currentTarget.hasPointerCapture(e.pointerId)) update(e); }}
    onPointerUp={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) { dragging.current = false; e.currentTarget.releasePointerCapture(e.pointerId); onFinish(); } }}
    onPointerCancel={() => { dragging.current = false; onCancel(); }} onBlur={onFinish}
    onKeyDown={e => { if (e.key === 'Escape') dragging.current = false; if (disabled) return; const delta = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key]; if (delta) { e.preventDefault(); onPreview((value + delta * (e.shiftKey ? 10 : 1) + 360) % 360); } }}
    onKeyUp={e => { if (e.key.startsWith('Arrow')) onFinish(); }}>
    <circle cx="50" cy="50" r="39" fill="none" stroke="currentColor" opacity=".25"/>
    {Array.from({ length: 24 }, (_, i) => { const a = point(i * 15, i % 6 ? 36 : 33), b = point(i * 15, 40); return <line key={i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="currentColor" opacity=".35"/>; })}
    {Array.from({ length: repeat }, (_, i) => { const p = point(value + i * 360 / repeat, 31); return <circle key={i} cx={p[0]} cy={p[1]} r={i ? 2.5 : 4} fill="var(--create)" opacity={i ? .5 : 1}/>; })}
    <line x1="50" y1="50" x2={point(value, 31)[0]} y2={point(value, 31)[1]} stroke="var(--create)" strokeWidth="2"/>
    <circle cx="50" cy="50" r="3" fill="var(--create)"/><text x="94" y="53" fontSize="8" fill="currentColor">0</text>
  </svg>;
}

export function ConcavePanel({ document, selectedId, onSelect, canEdit, isCommitting, blockedReason, onReturnPlanar, onChange, onReplace, onCancel }) {
  const cuts = document.concaveCuts ?? [];
  const selected = cuts.find(cut => cut.id === selectedId) ?? cuts.at(-1);
  const [choosing, setChoosing] = useState(!cuts.length);
  const [draft, setDraft] = useState(null);
  useEffect(() => { setDraft(null); }, [selected]);
  const values = draft && draft.id === selected?.id ? draft : {};
  const depth = selected ? concaveToolDepth(document, selected) : 0;
  const inputDepth = values.toolDepth ?? depth;
  const phase = values.phaseDeg ?? selected?.phaseDeg ?? 0;
  const pending = useRef(null), frame = useRef(null);
  useEffect(() => () => { if (frame.current) cancelAnimationFrame(frame.current); }, []);
  const preview = patch => {
    setDraft({ id: selected.id, ...patch });
    pending.current = { toolId: selected.id, ...patch };
    if (!frame.current) frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (pending.current) onChange(pending.current, true);
    });
  };
  const finish = () => {
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = null;
    if (pending.current) onChange(pending.current, false);
    pending.current = null;
  };
  const cancel = () => {
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = null; pending.current = null; setDraft(null); onCancel();
  };
  const replace = next => onReplace({ kind: 'facet-parameter-group', schemaVersion: 1, group: 'concave', concaveCuts: next });
  const add = preset => {
    const toolId = crypto.randomUUID();
    if (onChange({ toolId, preset }, false)) { onSelect(toolId); setChoosing(false); }
  };
  return <section className="concave-panel" aria-label={t('凹切图层')} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); cancel(); setChoosing(false); } }}>
    <div className="concave-panel-heading"><span>{t('凹切图层')} <small>{cuts.length}</small></span><button type="button" aria-expanded={choosing || !cuts.length} onClick={() => setChoosing(!choosing)}>{t(choosing && cuts.length ? '收起刀具' : '＋ 添加凹切')}</button></div>
    {!canEdit && !isCommitting && <div className="concave-blocked">{t(blockedReason)}{onReturnPlanar && <button type="button" onClick={onReturnPlanar}>{t('返回平切')}</button>}</div>}
    {(choosing || !cuts.length) && <div className="concave-tool-choices">{CONCAVE_PRESETS.map(preset => <button key={preset.id} type="button" disabled={!canEdit} aria-label={t('添加{0}', [t(preset.label)])} onClick={() => add(preset.id)}><CutterIllustration type={preset.type} fine={preset.id === 'fine-flute'}/><span>{t(preset.label)}</span>{preset.type === 'v-wheel' && <small>90°</small>}</button>)}</div>}
    {!cuts.length && <p className="concave-empty">{t('选择刀具，在宝石上添加凹切')}</p>}
    <div className="concave-layer-list">{cuts.map((cut, i) => <div key={cut.id} className={`concave-layer${selected?.id === cut.id ? ' is-selected' : ''}`}>
      <label><input type="checkbox" checked={cut.enabled} disabled={!canEdit} aria-label={t('启用凹切 {0}', [i + 1])} onChange={e => replace(cuts.map(c => c.id === cut.id ? { ...c, enabled: e.target.checked } : c))}/></label>
      <button className="concave-layer-select" type="button" aria-pressed={selected?.id === cut.id} onClick={() => { finish(); onSelect(cut.id); setChoosing(false); }}><span><b>N{i + 1}</b> {t(cut.label || cut.type)}</span><small>{t('{0} 次重复 · {1}°', [cut.repeat, Number(cut.phaseDeg.toFixed(2))])}</small></button>
      <button type="button" className="concave-delete" disabled={!canEdit} aria-label={t('删除凹切 {0}', [i + 1])} onClick={() => replace(cuts.filter(c => c.id !== cut.id))}>{t('删除')}</button>
    </div>)}</div>
    {selected && <div className="concave-parameters">
      {selected.type === 'triangular-prism' && <fieldset className="concave-shape-parameters" disabled={!canEdit}>
        <legend>{t('三角柱尺寸')}</legend>
        {[["tipAngle", "尖角", "°", 1, 179, 1], ["width", "宽度", "", .001, undefined, .01], ["length", "长度", "", .001, undefined, .01]].map(([key, label, unit, min, max, step]) => <label key={key}>{t(label)}<span><input type="number" aria-label={t(`三角柱${label}`)} min={min} max={max} step={step} value={values[key] ?? selected[key]} onChange={event => { if (Number.isFinite(event.target.valueAsNumber)) preview({ [key]: event.target.valueAsNumber }); }} onBlur={finish} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}/>{unit}</span></label>)}
        <small>{t('尖角与宽度决定槽形，长度沿刀具轴向；尺寸使用项目坐标。')}</small>
      </fieldset>}

      <div className="concave-direction"><RotationDial value={phase} repeat={selected.repeat} disabled={!canEdit} onPreview={value => preview({ phaseDeg: value })} onFinish={finish} onCancel={cancel}/>
        <div><label>{t('整组旋转')}<span><input type="number" aria-label={t('凹切旋转角度')} step="0.1" value={Number(phase.toFixed(2))} disabled={!canEdit} onChange={e => { if (Number.isFinite(e.target.valueAsNumber)) preview({ phaseDeg: e.target.valueAsNumber }); }} onBlur={finish} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}/>°</span></label><small>{t('自由角度 · 不受平切分度盘限制')}</small></div>
      </div>
      <label>{t('重复')}<input type="number" aria-label={t('凹切重复')} min="1" max="120" step="1" value={selected.repeat} disabled={!canEdit} onChange={e => { const repeat = e.target.valueAsNumber; if (Number.isInteger(repeat) && repeat >= 1 && repeat <= 120) onChange({ toolId: selected.id, repeat }, false); }}/></label>
      <label>{t('凹切深度')}<input type="number" aria-label={t('凹切深度')} step="0.01" value={Number(inputDepth.toFixed(4))} disabled={!canEdit} onChange={e => { if (Number.isFinite(e.target.valueAsNumber)) preview({ toolDepth: e.target.valueAsNumber }); }} onBlur={finish} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}/></label>
      <input aria-label={t('调整凹切深度')} type="range" min={Math.min(0, depth)} max={Math.max(selected.radius * 2 + .25, depth)} step="0.005" value={inputDepth} disabled={!canEdit} onChange={e => preview({ toolDepth: e.target.valueAsNumber })} onPointerUp={finish} onPointerCancel={cancel} onKeyUp={e => { if (e.key !== 'Escape') finish(); }} onBlur={finish}/>
      <p aria-live="polite">{t(isCommitting ? '正在完成凹切，请稍候。' : '拖动转盘或深度，实时查看造型；松手保存。')}</p>
    </div>}
  </section>;
}
