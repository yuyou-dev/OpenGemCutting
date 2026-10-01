import { useCallback, useEffect, useRef } from 'react';

/** One DOM adapter for every laboratory 3D canvas. */
export function useViewportNavigation(controller) {
  const canvas = useRef(null), pointer = useRef(null);
  const wheel = useCallback(event => { event.preventDefault(); controller.zoomComparison(event.deltaY); }, [controller]);
  const ref = useCallback(element => {
    canvas.current?.removeEventListener('wheel', wheel);
    canvas.current = element;
    element?.addEventListener('wheel', wheel, { passive: false });
  }, [wheel]);
  const end = () => {
    const id = pointer.current;
    pointer.current = null;
    if (id === null) return;
    if (canvas.current?.hasPointerCapture(id)) canvas.current.releasePointerCapture(id);
    controller.endCameraDrag();
  };
  useEffect(() => {
    const unsubscribe = controller.subscribe(() => { if (controller.getSnapshot().suspended) end(); });
    return () => { unsubscribe(); end(); controller.cancelCameraDrag(); };
  }, [controller]);
  return { ref, tabIndex: 0,
    onPointerDown(event) {
      if (event.button !== 0 || pointer.current !== null) return;
      event.preventDefault(); event.currentTarget.focus({ preventScroll: true });
      pointer.current = event.pointerId;
      controller.beginCameraDrag(event.clientX, event.clientY);
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove(event) { if (pointer.current === event.pointerId) controller.dragCameraTo(event.clientX, event.clientY, event.shiftKey); },
    onPointerUp: end, onPointerCancel: end, onLostPointerCapture: end,
    onDoubleClick: () => controller.resetCamera(),
    onKeyDown(event) {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (controller.cameraKey(event.key, event.shiftKey)) { event.preventDefault(); event.stopPropagation(); }
    },
  };
}
