'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A section that's there when wanted and out of the way otherwise: one line until opened. Content is drawn only once
 * open, so a closed fold's fields can't catch taps or sit under fixed buttons. A link to #hash opens it.
 */
export function Fold({ folded, label, hash, testId, children }: { folded: boolean; label: string; hash?: string; testId: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!hash) return;
    const openIfHash = () => {
      if (location.hash === `#${hash}` && ref.current) ref.current.open = true;
    };
    openIfHash();
    window.addEventListener('hashchange', openIfHash);
    // A second tap on the same link doesn't fire hashchange.
    const onClick = (e: MouseEvent) => {
      if ((e.target as HTMLElement | null)?.closest(`a[href$="#${hash}"]`) && ref.current) ref.current.open = true;
    };
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('hashchange', openIfHash);
      document.removeEventListener('click', onClick, true);
    };
  }, [hash]);
  if (!folded) return <>{children}</>;
  return (
    <details ref={ref} className="group" data-testid={testId} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-md border border-line-faint bg-surface px-3 py-2 font-semibold [&::-webkit-details-marker]:hidden" data-testid={`${testId}-toggle`}>
        <span>{label}</span>
        <span aria-hidden="true" className="text-muted transition-transform group-open:rotate-180">▾</span>
      </summary>
      {open ? <div className="mt-3">{children}</div> : null}
    </details>
  );
}
