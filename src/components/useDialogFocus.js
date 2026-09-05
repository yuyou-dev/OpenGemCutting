import { useEffect, useRef } from "react";

export function useDialogFocus(panelRef, onClose) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previousFocus = document.activeElement;
    const restoreFocus = previousFocus?.closest("details")?.querySelector("summary") ?? previousFocus;
    const controls = () => [...panelRef.current.querySelectorAll(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
    )].filter((element) => element.getClientRects().length);
    panelRef.current.focus({ preventScroll: true });
    const handleKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeRef.current?.();
      }
      if (event.key !== "Tab") return;
      const elements = controls();
      const first = elements[0];
      const last = elements.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === panelRef.current || document.activeElement === first || !panelRef.current.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !panelRef.current.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKey, true);
    return () => {
      window.removeEventListener("keydown", handleKey, true);
      if (restoreFocus?.isConnected) restoreFocus.focus({ preventScroll: true });
    };
  }, [panelRef]);
}
