import { IconPlayerTrackNext, IconPlayerTrackPrev, IconX } from "@tabler/icons-react";
import { FACET_REGION_LABELS, displayIndex } from "../domain/faceting.js";

function useAssistantStepper(replay, position, onPositionChange) {
  const { stepper, steps, total } = replay;
  const clamped = Math.max(0, Math.min(total, Math.round(position)));
  const step = clamped < total ? steps[clamped] : null;
  const prevTierPos = stepper.prevTierPos(clamped);
  const nextTierPos = stepper.nextTierPos(clamped);

  const regionLabel = step ? FACET_REGION_LABELS[step.region] : "";
  const stepTitle = step && !step.patternName.includes(regionLabel) ? `${step.patternName} · ${regionLabel}` : step?.patternName;
  const stepInfo = clamped === 0
    ? "毛坯 · 尚未下刀"
    : clamped >= total
      ? `成品 · 全部 ${total} 刀完成`
      : `${stepTitle} · ${step.industryAngleDeg.toFixed(2)}° · 索引 ${displayIndex(step.index)}`;

  const goTo = (next) => onPositionChange(Math.max(0, Math.min(total, Math.round(next))));
  const jumpToRatio = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
    goTo(Math.max(0, Math.min(1, ratio)) * total);
  };

  return { clamped, total, stepInfo, prevTierPos, nextTierPos, goTo, jumpToRatio };
}

export function CuttingAssistantBar({ onExit }) {
  return (
    <header className="app-header floating-toolbar is-optics-toolbar is-inspector-closed is-assistant-toolbar" aria-label="切割助手命令条">
      <div className="assistant-title">
        <strong>切割助手<sup className="viewport-mode-beta">β</sup></strong>
      </div>
      <button type="button" className="optics-exit-button" onClick={onExit}>
        <IconX size={15} stroke={1.9} /><span>退出助手</span>
      </button>
    </header>
  );
}

export function CuttingAssistantPlayer({ replay, position, onPositionChange }) {
  const { clamped, total, stepInfo, prevTierPos, nextTierPos, goTo, jumpToRatio } =
    useAssistantStepper(replay, position, onPositionChange);

  return (
    <div className="assistant-player" aria-label="切割步进播放条">
      <span className="assistant-step-info" title={stepInfo}>{stepInfo}</span>
      <div className="assistant-controls" role="group" aria-label="切割步进">
        <button type="button" disabled={prevTierPos === clamped} onClick={() => goTo(prevTierPos)}>上一组</button>
        <button type="button" disabled={clamped <= 0} onClick={() => goTo(clamped - 1)}>
          <IconPlayerTrackPrev size={13} stroke={1.8} />上一步
        </button>
        <button type="button" disabled={clamped >= total} onClick={() => goTo(clamped + 1)}>
          下一步<IconPlayerTrackNext size={13} stroke={1.8} />
        </button>
        <button type="button" disabled={nextTierPos === clamped} onClick={() => goTo(nextTierPos)}>下一组</button>
      </div>
      <div
        className="assistant-progress"
        role="slider"
        tabIndex={0}
        aria-label="切割进度"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={clamped}
        aria-valuetext={`第 ${clamped} / ${total} 步`}
        onClick={jumpToRatio}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") { event.preventDefault(); goTo(clamped - 1); }
          if (event.key === "ArrowRight") { event.preventDefault(); goTo(clamped + 1); }
        }}
      >
        <i style={{ width: `${total > 0 ? (clamped / total) * 100 : 0}%` }} />
      </div>
      <span className="assistant-counter">第 {clamped} / {total} 步</span>
    </div>
  );
}
