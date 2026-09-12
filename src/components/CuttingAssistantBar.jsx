import { t } from '../i18n/locale.js';
import { IconPlayerPlay, IconPlayerPause, IconPlayerSkipBack, IconPlayerSkipForward, IconPlayerTrackNext, IconPlayerTrackPrev, IconX, IconRefresh } from "@tabler/icons-react";
import { displayIndex } from "../domain/faceting.js";
import { TechnicalPreview } from "./TechnicalPreview.jsx";

export function CuttingAssistantBar({ name, onExit }) {
  return <header className="app-header floating-toolbar is-optics-toolbar is-inspector-closed is-assistant-toolbar" aria-label={t("切割助手命令条")}>
    <strong className="assistant-project-name">{name}</strong>
    <button type="button" className="optics-exit-button" onClick={onExit}><IconX size={17} /><span>{t("退出助手")}</span></button>
  </header>;
}

export function IndexDial({ index }) {
  const angle = (index ?? 0) * Math.PI / 48;
  const at = (r, a) => [150 + r * Math.sin(a), 150 - r * Math.cos(a)];
  const pointer = at(98, angle);
  return <svg className="assistant-dial" viewBox="0 0 300 300" role="img" aria-label={index == null ? t("96 齿分度盘，切割已完成") : t("96 齿分度盘，当前分度 {0}", [displayIndex(index)])}>
    {Array.from({ length: 96 }, (_, i) => {
      const a = i * Math.PI / 48, from = at(i % 4 === 0 ? 111 : 117, a), to = at(126, a);
      return <line key={i} x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} stroke={i === index ? "#ed225d" : "#777"} strokeWidth={i % 4 === 0 ? 2 : 1.2} />;
    })}
    {[0,24,48,72].map(i => { const p = at(141, i * Math.PI / 48); return <text key={i} x={p[0]} y={p[1]} dominantBaseline="central" textAnchor="middle">{displayIndex(i)}</text>; })}
    {index != null && <g stroke="#ed225d" fill="#ed225d"><line x1={at(68,angle)[0]} y1={at(68,angle)[1]} x2={pointer[0]} y2={pointer[1]} /><circle cx={pointer[0]} cy={pointer[1]} r="4" /></g>}
    <text x="150" y="130" textAnchor="middle" className="dial-label">{t("分度")}</text>
    <text x="150" y="180" textAnchor="middle" className="dial-value">{index == null ? "—" : displayIndex(index)}</text>
  </svg>;
}

export function CuttingAssistantInspector({ replay, position, solid, follow, onFollow, duration, onDuration }) {
  const step = replay.steps[position];
  const location = replay.stepper.locate(position);
  const tier = location.tierIndex == null ? null : replay.tiers[location.tierIndex];
  const groupSteps = tier ? replay.steps.slice(tier.startPos, tier.startPos + tier.count) : [];
  return <aside className="assistant-inspector" aria-label={t("当前切割参数")}>
    <div className="assistant-operation"><span>{step ? t("下一刀") : t("切割完成")}</span><h2>{step?.patternName ?? (replay.total ? t("全部工序已完成") : t("当前没有切割工序"))}</h2></div>
    <IndexDial index={step?.index} />
    <dl className="assistant-readouts"><div><dt>{t("行业角")}</dt><dd>{t(step ? `${step.industryAngleDeg.toFixed(2)}°` : "—")}</dd></div><div><dt>{t("切入深度")}</dt><dd>{t(step?.depth.toFixed(3) ?? "—")}</dd><small>{t("工作台单位")}</small></div></dl>
    <section className="assistant-tier"><h3>{t("本组刀序")}</h3><div className="assistant-tier-indices">{groupSteps.map(s => <span key={s.seq} className={s.seq === position ? "is-current" : s.seq < position ? "is-complete" : ""} aria-current={s.seq === position ? "step" : undefined}>{displayIndex(s.index)}</span>)}</div><p>{step ? t("本组第 {0} 刀 / 共 {1} 刀", [location.stepInTier + 1, location.tierStepCount]) : t("已到达序列末尾")}</p></section>
    <div className="assistant-side-view"><TechnicalPreview solid={solid} view="side" label={t("当前施工侧视图")} /><span>{t("施工侧视 · 已完成")} {t(position)} {t("刀")}</span></div>
    <div className="assistant-view-settings"><label>{t("跟随当前面")}<input type="checkbox" role="switch" checked={follow} onChange={e => onFollow(e.target.checked)} /></label><label>{t("转场速度")}<select aria-label={t("转场速度")} value={duration} onChange={e => onDuration(Number(e.target.value))}><option value={1000}>{t("舒缓 · 1.0 秒")}</option><option value={600}>{t("标准 · 0.6 秒")}</option><option value={250}>{t("快速 · 0.25 秒")}</option></select></label><small>{follow ? t("45° 斜向观察 · 平滑缓动") : t("自由观察 · 开启跟随回到当前面")}</small></div>
  </aside>;
}

export function CuttingAssistantPlayer({ replay, position, onPositionChange, playing, onPlaying, speed, onSpeed, phase }) {
  const { total, stepper } = replay;
  const go = p => { onPlaying(false); onPositionChange(p); };
  const finished = position >= total;
  return <section className="assistant-player" aria-label={t("切割播放器")}>
    <div className="assistant-timeline"><div className="assistant-seek-track"><input type="range" aria-label={t("切割进度")} aria-valuetext={t("已完成 {0} / {1} 刀", [position, total])} min="0" max={total} step="1" value={position} disabled={!total} onChange={e => go(Number(e.target.value))} />
      <div className="assistant-chapters" aria-hidden="true">{replay.tiers.filter(t=>t.count).map(t=><i key={t.patternId} style={{left:`${100*t.startPos/(total||1)}%`}} />)}</div></div><span className="assistant-counter">{t("已完成")} {t(position)} / {t(total)} {t("刀")}</span></div>
    <div className="assistant-transport"><div className="assistant-controls" role="group" aria-label={t("切割步进")}>
      <button disabled={!position} onClick={()=>go(stepper.prevTierPos(position))}><IconPlayerSkipBack size={18} /><span>{t("上一组")}</span></button>
      <button disabled={!position} onClick={()=>go(position-1)}><IconPlayerTrackPrev size={18} /><span>{t("上一步")}</span></button>
      <button className="assistant-play" disabled={!total} aria-label={playing?t("暂停播放"):finished?t("从头播放"):t("播放")} onClick={()=>{if(finished)onPositionChange(0);onPlaying(!playing);}}>{playing?<IconPlayerPause size={25}/>:finished?<IconRefresh size={25}/>:<IconPlayerPlay size={25}/>}</button>
      <button disabled={finished} onClick={()=>go(position+1)}><span>{t("下一步")}</span><IconPlayerTrackNext size={18}/></button>
      <button disabled={finished} onClick={()=>go(stepper.nextTierPos(position))}><span>{t("下一组")}</span><IconPlayerSkipForward size={18}/></button>
    </div><label className="assistant-speed"><span>{t("播放速度")}</span><select aria-label={t("播放速度")} value={speed} onChange={e=>onSpeed(Number(e.target.value))}><option value={.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option></select></label></div>
    <p className="assistant-playback-status" role="status">{playing?t("自动播放中"):finished?(total?t("全部完成 · 可从头播放"):t("请先保存切割图层")):t("已暂停 · 手动步进或播放")}{t(!finished && ` · ${phase === "hold" ? t("切后观察 · 0.5 秒") : phase === "rotate" ? t("正在转向下一刀") : t("1× 刀前观察 3 秒")}`)}</p>
  </section>;
}
