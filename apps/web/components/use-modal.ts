'use client';

import { useEffect, type RefObject } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
}

/**
 * What every dialog, sheet and menu here does while open: focus moves in, Tab stays inside, the page behind doesn't
 * scroll, and on close focus goes back to whatever opened it, so a keyboard or screen reader user isn't dropped at
 * the top of the page. Escape stays with each caller, since a nested photo closes before its sheet.
 */
export function useModal(ref: RefObject<HTMLElement | null>, { initial, active = true, lockScroll = true }: { initial?: RefObject<HTMLElement | null>; active?: boolean; lockScroll?: boolean } = {}) {
  useEffect(() => {
    const root = ref.current;
    if (!active || !root) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (initial?.current ?? focusables(root)[0] ?? root).focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const list = focusables(root);
      if (!list.length) return e.preventDefault();
      const first = list[0]!;
      const last = list[list.length - 1]!;
      const at = document.activeElement;
      if (e.shiftKey && (at === first || !root.contains(at))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (at === last || !root.contains(at))) {
        e.preventDefault();
        first.focus();
      }
    };
    root.addEventListener('keydown', onKey);

    const body = document.body;
    const overflow = body.style.overflow;
    if (lockScroll) body.style.overflow = 'hidden';
    return () => {
      root.removeEventListener('keydown', onKey);
      if (lockScroll) body.style.overflow = overflow;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
    // Runs once per opening; a changing initial ref must not pull focus back mid-dialog.
  }, [active]);
}
