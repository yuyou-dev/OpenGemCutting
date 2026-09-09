import { useEffect, useState } from "react";

export function useCuttingPlayback({ active, position, total, onPositionChange }) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  useEffect(() => {
    if (!active || position >= total) setPlaying(false);
  }, [active, position, total]);
  useEffect(() => {
    const pause = () => { if (document.hidden) setPlaying(false); };
    document.addEventListener("visibilitychange", pause);
    return () => document.removeEventListener("visibilitychange", pause);
  }, []);
  useEffect(() => {
    if (!active || !playing || position >= total || document.hidden) return;
    const timer = window.setTimeout(() => onPositionChange(position + 1), 3000 / speed);
    return () => window.clearTimeout(timer);
  }, [active, playing, position, total, speed, onPositionChange]);
  return { playing, setPlaying, speed, setSpeed };
}
