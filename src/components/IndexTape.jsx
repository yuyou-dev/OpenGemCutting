import { useRef, useState } from "react";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { INDEX_TEETH, displayIndex, indexToAzimuthDeg, normalizeIndex } from "../domain/faceting.js";

/**
 * Horizontal 96-tooth index tape: a flat ruler strip the height of a form row.
 * Drag or click the tape to snap to the nearest tooth; steppers nudge ±1;
 * click the readout to type an exact display index (1–96, 96 aliases 0).
 */
export function IndexTape({ index, onIndexChange, disabled = false }) {
  const tapeRef = useRef(null);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const cancelEditRef = useRef(false);
  const draggingRef = useRef(false);

  const shown = displayIndex(index);
  const azimuth = indexToAzimuthDeg(index);

  const emitFromClientX = (clientX) => {
    const rect = tapeRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    // Tape runs 3 o'clock (index 0/96) at the left to just before one full turn
    // at the right, i.e. linear in azimuth: index = round(ratio * 96) % 96.
    onIndexChange(normalizeIndex(Math.round(ratio * INDEX_TEETH)));
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
    const numeric = Math.round(Number(editValue));
    if (Number.isFinite(numeric)) {
      onIndexChange(normalizeIndex(Math.min(INDEX_TEETH, Math.max(1, numeric)) % INDEX_TEETH));
    }
    setEditing(false);
  };

  const ticks = [];
  for (let tooth = 0; tooth < INDEX_TEETH; tooth += 1) {
    const major = tooth % 24 === 0;
    const mid = !major && tooth % 8 === 0;
    ticks.push(
      <i
        key={tooth}
        className={major ? "is-major" : mid ? "is-mid" : ""}
        style={{ left: `${(tooth / INDEX_TEETH) * 100}%` }}
      />,
    );
  }

  return (
    <div
      className={disabled ? "index-tape is-disabled" : "index-tape"}
      role="slider"
      aria-label="96 齿索引"
      aria-valuemin={1}
      aria-valuemax={96}
      aria-valuenow={shown}
      aria-valuetext={`索引 ${shown}，方位角 ${azimuth.toFixed(2)}°`}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(event) => {
        if (editing || disabled) return;
        if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
          onIndexChange(normalizeIndex(index - 1));
          event.preventDefault();
        }
        if (event.key === "ArrowRight" || event.key === "ArrowUp") {
          onIndexChange(normalizeIndex(index + 1));
          event.preventDefault();
        }
      }}
    >
      <button
        type="button"
        className="index-tape-step"
        onClick={() => onIndexChange(normalizeIndex(index - 1))}
        disabled={disabled}
        aria-label="索引减一"
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
        <div className="index-tape-ticks" aria-hidden="true">{ticks}</div>
        {["96", "24", "48", "72"].map((label, labelIndex) => (
          <span key={label} className="index-tape-label" style={{ left: `${(labelIndex * 24 / INDEX_TEETH) * 100}%` }} aria-hidden="true">
            {label}
          </span>
        ))}
        <span className="index-tape-handle" style={{ left: `${(index / INDEX_TEETH) * 100}%` }} aria-hidden="true" />
      </div>

      <button
        type="button"
        className="index-tape-step"
        onClick={() => onIndexChange(normalizeIndex(index + 1))}
        disabled={disabled}
        aria-label="索引加一"
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
          min="1"
          max="96"
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
          aria-label="输入索引 1 到 96"
        />
      ) : (
        <button
          type="button"
          className="index-tape-readout"
          onClick={() => {
            if (disabled) return;
            setEditValue(String(shown));
            setEditing(true);
          }}
          disabled={disabled}
          title="点击输入精确索引"
        >
          <strong>{String(shown).padStart(2, "0")}</strong>
          <small>{azimuth.toFixed(1)}°</small>
        </button>
      )}
    </div>
  );
}
