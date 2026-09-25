/** Screen-space pointer gestures and keyboard directions, without DOM state. */
export const PLAN_DRAG_SLOP_PX = 4;

export function beginPointerSession(kind, x, y, data = {}) {
  return { ...data, kind, start: [x, y], last: [x, y], active: false };
}

/** The first active move includes the distance from pointerdown, so crossing
 * the click threshold does not discard the first few pixels of a drag. */
export function advancePointerSession(session, x, y) {
  const active = session.active || Math.hypot(x - session.start[0], y - session.start[1]) > PLAN_DRAG_SLOP_PX;
  const from = session.active ? session.last : session.start;
  return {
    session: { ...session, last: [x, y], active },
    started: active && !session.active,
    delta: active ? [x - from[0], y - from[1]] : [0, 0],
  };
}

/** Arrow keys move in the visible screen direction, including bottom-up x
 * mirroring. Shift is a deliberate larger step; OS shortcuts are untouched. */
export function planNudgeForKey(key, { side = 'crown', shiftKey = false, altKey = false, ctrlKey = false, metaKey = false } = {}) {
  if (altKey || ctrlKey || metaKey) return null;
  const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
  const direction = directions[key];
  if (!direction) return null;
  return { dx: direction[0] * (side === 'pavilion' ? -1 : 1), dy: direction[1], multiplier: shiftKey ? 10 : 1 };
}
