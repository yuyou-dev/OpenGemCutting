import { IconPlayerPlay, IconPlayerPause, IconPlayerSkipBack, IconPlayerSkipForward, IconPlayerTrackNext, IconPlayerTrackPrev, IconX, IconRefresh } from "@tabler/icons-react";
import { displayIndex } from "../domain/faceting.js";
import { TechnicalPreview } from "./TechnicalPreview.jsx";

export function CuttingAssistantBar({ name, onExit }) {
  return <header className="app-header floating-toolbar is-optics-toolbar is-inspector-closed is-assistant-toolbar" aria-label="切割助手命令条">
    <strong className="assistant-project-name">{name}</strong>
    <button type="button" className="optics-exit-button" onClick={onExit}><IconX size={17} /><span>退出助手</span></button>
  </header>;
}

export function IndexDial({ index }) {
  const angle = (index ?? 0) * Math.PI / 48;
  const at = (r, a) => [150 + r * Math.sin(a), 150 - r * Math.cos(a)];
  const pointer = at(98, angle);
  return <svg className="assistant-dial" viewBox="0 0 300 300" role="img" aria-label={index == null ? "96 齿分度盘，切割已完成" : `96 齿分度盘，当前分度 ${displayIndex(index)}`}>
    {Array.from({ length: 96 }, (_, i) => {
      const a = i * Math.PI / 48, from = at(i % 4 === 0 ? 111 : 117, a), to = at(126, a);
      return <line key={i} x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} stroke={i === index ? "#ed225d" : "#777"} strokeWidth={i % 4 === 0 ? 2 : 1.2} />;
    })}
    {[0,24,48,72].map(i => { const p = at(141, i * Math.PI / 48); return <text key={i} x={p[0]} y={p[1]} dominantBaseline="central" textAnchor="middle">{displayIndex(i)}</text>; })}
    {index != null && <g stroke="#ed225d" fill="#ed225d"><line x1={at(68,angle)[0]} y1={at(68,angle)[1]} x2={pointer[0]} y2={pointer[1]} /><circle cx={pointer[0]} cy={pointer[1]} r="4" /></g>}
    <text x="150" y="130" textAnchor="middle" className="dial-label">分度</text>
    <text x="150" y="180" textAnchor="middle" className="dial-value">{index == null ? "—" : displayIndex(index)}</text>
  </svg>;
}

export function CuttingAssistantInspector({ replay, position, solid, follow, onFollow, duration, onDuration }) {
  const step = replay.steps[position];
  const location = replay.stepper.locate(position);
  const tier = location.tierIndex == null ? null : replay.tiers[location.tierIndex];
  const groupSteps = tier ? replay.steps.slice(tier.startPos, tier.startPos + tier.count) : [];
  return <aside className="assistant-inspector" aria-label="当前切割参数">
    <div className="assistant-operation"><span>{step ? "下一刀" : "切割完成"}</span><h2>{step?.patternName ?? (replay.total ? "全部工序已完成" : "当前没有切割工序")}</h2></div>
    <IndexDial index={step?.index} />
    <dl className="assistant-readouts"><div><dt>行业角</dt><dd>{step ? `${step.industryAngleDeg.toFixed(2)}°` : "—"}</dd></div><div><dt>切入深度</dt><dd>{step?.depth.toFixed(3) ?? "—"}</dd><small>工作台单位</small></div></dl>
    <section className="assistant-tier"><h3>本组刀序</h3><div className="assistant-tier-indices">{groupSteps.map(s => <span key={s.seq} className={s.seq === position ? "is-current" : s.seq < position ? "is-complete" : ""} aria-current={s.seq === position ? "step" : undefined}>{displayIndex(s.index)}</span>)}</div><p>{step ? `本组第 ${location.stepInTier + 1} 刀 / 共 ${location.tierStepCount} 刀` : "已到达序列末尾"}</p></section>
    <div className="assistant-side-view"><TechnicalPreview solid={solid} view="side" label="当前施工侧视图" /><span>施工侧视 · 已完成 {position} 刀</span></div>
    <div className="assistant-view-settings"><label>跟随当前面<input type="checkbox" role="switch" checked={follow} onChange={e => onFollow(e.target.checked)} /></label><label>转场速度<select aria-label="转场速度" value={duration} onChange={e => onDuration(Number(e.target.value))}><option value={1000}>舒缓 · 1.0 秒</option><option value={600}>标准 · 0.6 秒</option><option value={250}>快速 · 0.25 秒</option></select></label><small>{follow ? "45° 斜向观察 · 平滑缓动" : "自由观察 · 开启跟随回到当前面"}</small></div>
  </aside>;
}

export function CuttingAssistantPlayer({ replay, position, onPositionChange, playing, onPlaying, speed, onSpeed }) {
  const { total, stepper } = replay;
  const go = p => { onPlaying(false); onPositionChange(p); };
  const finished = position >= total;
  return <section className="assistant-player" aria-label="切割播放器">
    <div className="assistant-timeline"><div className="assistant-seek-track"><input type="range" aria-label="切割进度" aria-valuetext={`已完成 ${position} / ${total} 刀`} min="0" max={total} step="1" value={position} disabled={!total} onChange={e => go(Number(e.target.value))} />
      <div className="assistant-chapters" aria-hidden="true">{replay.tiers.filter(t=>t.count).map(t=><i key={t.patternId} style={{left:`${100*t.startPos/(total||1)}%`}} />)}</div></div><span className="assistant-counter">已完成 {position} / {total} 刀</span></div>
    <div className="assistant-transport"><div className="assistant-controls" role="group" aria-label="切割步进">
      <button disabled={!position} onClick={()=>go(stepper.prevTierPos(position))}><IconPlayerSkipBack size={18} /><span>上一组</span></button>
      <button disabled={!position} onClick={()=>go(position-1)}><IconPlayerTrackPrev size={18} /><span>上一步</span></button>
      <button className="assistant-play" disabled={!total} aria-label={playing?"暂停播放":finished?"从头播放":"播放"} onClick={()=>{if(finished)onPositionChange(0);onPlaying(!playing);}}>{playing?<IconPlayerPause size={25}/>:finished?<IconRefresh size={25}/>:<IconPlayerPlay size={25}/>}</button>
      <button disabled={finished} onClick={()=>go(position+1)}><span>下一步</span><IconPlayerTrackNext size={18}/></button>
      <button disabled={finished} onClick={()=>go(stepper.nextTierPos(position))}><span>下一组</span><IconPlayerSkipForward size={18}/></button>
    </div><label className="assistant-speed"><span>播放速度</span><select aria-label="播放速度" value={speed} onChange={e=>onSpeed(Number(e.target.value))}><option value={.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option></select></label></div>
    <p className="assistant-playback-status" role="status">{playing?"自动播放中":finished?(total?"全部完成 · 可从头播放":"请先保存切割图层"):"已暂停 · 手动步进或播放"} · 1× 每刀停留 3 秒</p>
  </section>;
}
