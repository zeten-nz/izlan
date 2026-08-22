import { useEffect, type RefObject } from 'react';

const FOCUSABLE = ['a[href]', 'button:not([disabled])', 'textarea:not([disabled])', 'input:not([disabled])', 'select:not([disabled])', '[tabindex]:not([tabindex="-1"])'].join(',');

/**
 * Accessible modal focus management for a container (`active` = open). While active:
 *  - remembers the previously-focused element (the trigger),
 *  - moves initial focus inside (initialFocusRef if given, else first focusable, else the container),
 *  - traps Tab / Shift+Tab so focus wraps at the boundaries and cannot leave into the background,
 *  - on deactivate/unmount, restores focus to the trigger when it is still connected.
 * Escape handling and scroll-lock stay with the caller. Small, dependency-free.
 */
export function useFocusTrap(containerRef: RefObject<HTMLElement | null>, active: boolean, initialFocusRef?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!active) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const container = containerRef.current;

    const focusables = () => (container ? Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)) : []);

    const timer = window.setTimeout(() => {
      const target = initialFocusRef?.current ?? focusables()[0] ?? container;
      target?.focus();
    }, 20);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !container) return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        container.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const activeEl = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (activeEl === first || !container.contains(activeEl)) {
          e.preventDefault();
          last.focus();
        }
      } else if (activeEl === last || !container.contains(activeEl)) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKeyDown, true);
      if (previouslyFocused && previouslyFocused.isConnected && typeof previouslyFocused.focus === 'function') previouslyFocused.focus();
    };
  }, [active, containerRef, initialFocusRef]);
}
