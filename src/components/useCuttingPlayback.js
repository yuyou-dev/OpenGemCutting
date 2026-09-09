import { useCallback, useEffect, useMemo, useState } from "react";

export function useCuttingPlayback({ active, position, total, follow, duration, onPositionChange }) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  // A new position first exposes the freshly cut solid at the previous pose.
  const turn = useMemo(() => ({}), [active, position, follow, duration]);
  const [stage, setStage] = useState(null);
  const phase = stage?.turn === turn ? stage.phase : "hold";
  useEffect(() => {
    if (!active || position >= total) return;
    const timer = window.setTimeout(() => {
      setStage({ turn, phase: follow ? "rotate" : "ready" });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [active, position, total, follow, turn]);
  const onSettled = useCallback(() => setStage({ turn, phase: "ready" }), [turn]);
  useEffect(() => {
    if (!active || position >= total) setPlaying(false);
  }, [active, position, total]);
  useEffect(() => {
    const pause = () => { if (document.hidden) setPlaying(false); };
    document.addEventListener("visibilitychange", pause);
    return () => document.removeEventListener("visibilitychange", pause);
  }, []);
  useEffect(() => {
    if (!active || !playing || position >= total || phase !== "ready" || document.hidden) return;
    const timer = window.setTimeout(() => onPositionChange(position + 1), 3000 / speed);
    return () => window.clearTimeout(timer);
  }, [active, playing, position, total, speed, phase, onPositionChange]);
  return { playing, setPlaying, speed, setSpeed, phase, onSettled };
}
