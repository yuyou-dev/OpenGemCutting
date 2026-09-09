import { useEffect } from "react";

/** Only floating menus opt in; inline disclosure sections stay open. */
export function useDismissFloatingMenus() {
  useEffect(() => {
    const menus = () => document.querySelectorAll('details[data-floating-menu][open]');
    const outside = (event) => {
      for (const menu of menus()) if (!event.composedPath().includes(menu)) menu.open = false;
    };
    const escape = (event) => {
      if (event.key !== 'Escape') return;
      const openMenus = menus();
      if (!openMenus.length) return;
      event.preventDefault();
      event.stopPropagation();
      for (const menu of openMenus) {
        menu.open = false;
        menu.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('keydown', escape, true);
    };
  }, []);
}
