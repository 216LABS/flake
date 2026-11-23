'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * While a storm is running, Start a storm folds to one line, so the storm being worked isn't followed by a long form.
 * The header's and the dashboard's Start a storm links (#start) still open it.
 */
export function StartFold({ folded, children }: { folded: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  // The form is drawn only once opened: a closed fold's fields still have a size to the browser, under the report button.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const openIfHash = () => {
      if (location.hash === '#start' && ref.current) ref.current.open = true;
    };
    openIfHash();
    window.addEventListener('hashchange', openIfHash);
    // A second tap on the same #start link doesn't fire hashchange.
    const onClick = (e: MouseEvent) => {
      if ((e.target as HTMLElement | null)?.closest('a[href$="#start"]') && ref.current) ref.current.open = true;
    };
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('hashchange', openIfHash);
      document.removeEventListener('click', onClick, true);
    };
  }, []);
  if (!folded) return <>{children}</>;
  return (
    <details ref={ref} className="group" data-testid="start-fold" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-md border border-line-faint bg-surface px-3 py-2 font-semibold [&::-webkit-details-marker]:hidden" data-testid="start-fold-toggle">
        <span>Start another storm</span>
        <span aria-hidden="true" className="text-muted transition-transform group-open:rotate-180">▾</span>
      </summary>
      {open ? <div className="mt-3">{children}</div> : null}
    </details>
  );
}
