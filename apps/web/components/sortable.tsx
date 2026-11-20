'use client';

import { cn } from '@flake/ui';
import { GripVertical } from 'lucide-react';
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

/**
 * Drag to reorder that works with a finger, a mouse and a keyboard (issue 190). HTML5 drag and drop does nothing on an
 * iPhone, so this uses pointer events on a grip handle. Keyboard: Space lifts a row, arrows move it, Space drops it.
 * Nothing new is installed for it.
 */
export function useSortable({ count, onMove, label }: { count: number; onMove: (from: number, to: number) => void; label: (i: number) => string }) {
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const [lifted, setLifted] = useState<number | null>(null);
  const [said, setSaid] = useState('');
  const rows = useRef<(HTMLElement | null)[]>([]);
  const scroller = useRef<number | null>(null);

  const overIndex = (y: number) => {
    let best = 0;
    rows.current.forEach((el, i) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (y > r.top + r.height / 2) best = i;
    });
    // Above the first row's middle means the top.
    const first = rows.current.find(Boolean)?.getBoundingClientRect();
    return first && y < first.top + first.height / 2 ? 0 : best;
  };
  const stopScroll = () => {
    if (scroller.current !== null) cancelAnimationFrame(scroller.current);
    scroller.current = null;
  };
  const edgeScroll = (y: number) => {
    stopScroll();
    const edge = 60;
    const speed = y < edge ? -12 : y > window.innerHeight - edge ? 12 : 0;
    if (!speed) return;
    const step = () => {
      window.scrollBy(0, speed);
      scroller.current = requestAnimationFrame(step);
    };
    scroller.current = requestAnimationFrame(step);
  };

  const handle = (i: number) => ({
    'aria-label': `Drag to reorder ${label(i)}. Or press Space, then the arrow keys.`,
    'aria-pressed': lifted === i,
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ from: i, over: i });
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      if (!drag) return;
      edgeScroll(e.clientY);
      const over = overIndex(e.clientY);
      if (over !== drag.over) setDrag({ ...drag, over });
    },
    onPointerUp: () => {
      stopScroll();
      if (drag && drag.from !== drag.over) {
        onMove(drag.from, drag.over);
        setSaid(`${label(drag.from)} moved to position ${drag.over + 1} of ${count}.`);
      }
      setDrag(null);
    },
    onPointerCancel: () => {
      stopScroll();
      setDrag(null);
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        setLifted(lifted === i ? null : i);
        setSaid(lifted === i ? `${label(i)} dropped at position ${i + 1}.` : `${label(i)} picked up, position ${i + 1} of ${count}. Arrow keys move it, Space drops it.`);
      } else if (lifted === i && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        const to = e.key === 'ArrowUp' ? i - 1 : i + 1;
        if (to < 0 || to >= count) return;
        onMove(i, to);
        setLifted(to);
        setSaid(`Position ${to + 1} of ${count}.`);
        // Focus stays with the row that moved.
        requestAnimationFrame(() => rows.current[to]?.querySelector<HTMLElement>('[data-grip]')?.focus());
      } else if (e.key === 'Escape') {
        setLifted(null);
      }
    },
  });

  /** Props for each row: a ref for hit-testing and the drop line where it would land. */
  const row = (i: number) => ({
    ref: (el: HTMLElement | null) => {
      rows.current[i] = el;
    },
    'data-dragging': drag?.from === i || lifted === i ? 'true' : undefined,
    className: cn(
      'relative transition-shadow',
      (drag?.from === i || lifted === i) && 'opacity-70 ring-2 ring-beacon',
      drag && drag.over === i && drag.from !== i && (drag.over < drag.from ? 'before:absolute before:inset-x-0 before:-top-1 before:h-0.5 before:rounded before:bg-beacon' : 'after:absolute after:inset-x-0 after:-bottom-1 after:h-0.5 after:rounded after:bg-beacon'),
    ),
  });

  const live = <span className="sr-only" aria-live="assertive">{said}</span>;
  return { handle, row, live, dragging: drag !== null };
}

/** The grip a row is dragged by: 44 px, and no scrolling while a finger is on it. */
export function Grip(props: ReturnType<ReturnType<typeof useSortable>['handle']> & { testId?: string; className?: string }) {
  const { testId, className, ...rest } = props;
  return (
    <button type="button" data-grip data-testid={testId} className={cn('flex h-11 w-9 shrink-0 cursor-grab touch-none items-center justify-center rounded-control text-muted hover:bg-tint-2 hover:text-ink active:cursor-grabbing aria-pressed:bg-beacon/20 aria-pressed:text-ink', className)} {...rest}>
      <GripVertical size={18} aria-hidden="true" />
    </button>
  );
}
