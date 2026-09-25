import { t } from '../i18n/locale.js';
import { useRef, useState } from "react";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { INDEX_TEETH, displayIndex, indexToAzimuthDeg, normalizeIndex } from "../domain/faceting.js";

/**
 * Horizontal index tape: a flat ruler strip the height of a form row.
 * Drag or click the tape to snap to the nearest tooth; steppers nudge ±1;
 * click the readout to type an exact index, including fractions (the final tooth aliases 0).
 */
export function IndexTape({ index, indexTeeth = INDEX_TEETH, onIndexChange, disabled = false }) {
  const tapeRef = useRef(null);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const cancelEditRef = useRef(false);
  const draggingRef = useRef(false);

  const shown = displayIndex(index, indexTeeth);
  const azimuth = indexToAzimuthDeg(index, indexTeeth);

  const emitFromClientX = (clientX) => {
    const rect = tapeRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    // Dragging snaps to whole teeth; typing preserves a fractional setting.
    onIndexChange(normalizeIndex(Math.round(ratio * indexTeeth), indexTeeth));
  };

  const onPointerDown = (event) => {
    if (disabled) return;
    draggingRef.current = true;
    tapeRef.current?.setPointerCapture?.(event.pointerId);
    emitFromClientX(event.clientX);
    event.preventDefault();
  };
  const onPointerMove = (event) => {
    if (!draggingRef.current || disabled) return;
    emitFromClientX(event.clientX);
  };
  const onPointerUp = () => {
    draggingRef.current = false;
  };

  const commitEdit = () => {
    if (cancelEditRef.current) {
      cancelEditRef.current = false;
      setEditing(false);
      return;
    }
    const numeric = Number(editValue);
    if (editValue.trim() !== "" && Number.isFinite(numeric) && numeric >= 0 && numeric <= indexTeeth) {
      onIndexChange(normalizeIndex(numeric, indexTeeth));
    }
    setEditing(false);
  };

  const ticks = [];
  for (let tooth = 0; tooth < indexTeeth; tooth += 1) {
    const major = tooth % Math.max(1, Math.round(indexTeeth / 4)) === 0;
    const mid = !major && tooth % Math.max(1, Math.round(indexTeeth / 12)) === 0;
    ticks.push(
      <i
        key={tooth}
        className={major ? "is-major" : mid ? "is-mid" : ""}
        style={{ left: `${(tooth / indexTeeth) * 100}%` }}
      />,
    );
  }

  return (
    <div
      className={disabled ? "index-tape is-disabled" : "index-tape"}
      role="slider"
      aria-label={t("{0} 齿索引", [indexTeeth])}
      aria-valuemin={0}
      aria-valuemax={indexTeeth}
      aria-valuenow={shown}
      aria-valuetext={`索引 ${shown}，方位角 ${azimuth.toFixed(2)}°`}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(event) => {
        if (editing || disabled) return;
        if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
          onIndexChange(normalizeIndex(index - 1, indexTeeth));
          event.preventDefault();
        }
        if (event.key === "ArrowRight" || event.key === "ArrowUp") {
          onIndexChange(normalizeIndex(index + 1, indexTeeth));
          event.preventDefault();
        }
      }}
    >
      <button
        type="button"
        className="index-tape-step"
        onClick={() => onIndexChange(normalizeIndex(index - 1, indexTeeth))}
        disabled={disabled}
        aria-label={t("索引减一")}
        tabIndex={-1}
      >
        <IconChevronLeft size={15} stroke={1.8} />
      </button>

      <div
        ref={tapeRef}
        className="index-tape-track"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="index-tape-ticks" aria-hidden="true">{t(ticks)}</div>
        {Array.from({ length: Math.min(4, indexTeeth) }, (_, ordinal) => Math.round(ordinal * indexTeeth / Math.min(4, indexTeeth))).map((tooth) => (
          <span key={tooth} className="index-tape-label" style={{ left: `${(tooth / indexTeeth) * 100}%` }} aria-hidden="true">
            {displayIndex(tooth, indexTeeth)}
          </span>
        ))}
        <span className="index-tape-handle" style={{ left: `${(normalizeIndex(index, indexTeeth) / indexTeeth) * 100}%` }} aria-hidden="true" />
      </div>

      <button
        type="button"
        className="index-tape-step"
        onClick={() => onIndexChange(normalizeIndex(index + 1, indexTeeth))}
        disabled={disabled}
        aria-label={t("索引加一")}
        tabIndex={-1}
      >
        <IconChevronRight size={15} stroke={1.8} />
      </button>

      {editing ? (
        <input
          className="index-tape-readout is-editing"
          value={editValue}
          autoFocus
          type="number"
          min="0"
          max={indexTeeth}
          step="any"
          onChange={(event) => setEditValue(event.target.value)}
          onBlur={commitEdit}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") commitEdit();
            if (event.key === "Escape") {
              cancelEditRef.current = true;
              setEditing(false);
            }
          }}
          aria-label={t("输入索引 0 到 {0}（支持小数）", [indexTeeth])}
        />
      ) : (
        <button
          type="button"
          className="index-tape-readout"
          onClick={() => {
            if (disabled) return;
            cancelEditRef.current = false;
            setEditValue(String(shown));
            setEditing(true);
          }}
          disabled={disabled}
          title={t("{0} 齿 · 拖动吸附整齿，点击输入小数索引", [indexTeeth])}
        >
          <strong>{String(shown).padStart(2, "0")}</strong>
          <small>{azimuth.toFixed(1)}°</small>
        </button>
      )}
    </div>
  );
}
