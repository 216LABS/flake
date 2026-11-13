'use client';

import { Button } from '@flake/ui';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useModal } from './use-modal';

export interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  /** The button that goes ahead. Say what it does: "Close storm", not "OK". */
  confirm: string;
  cancel?: string;
  danger?: boolean;
}

/**
 * The app's own yes/no dialog, in place of the browser's confirm(). A second tap while it's open is ignored, so a
 * double click can't stack two questions, and the answer comes back as a promise.
 */
export function useConfirm() {
  const [ask, setAsk] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const open = useCallback((opts: ConfirmOptions) => {
    if (resolver.current) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setAsk(opts);
    });
  }, []);
  const answer = useCallback((ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setAsk(null);
  }, []);
  const dialog = ask ? <ConfirmDialog {...ask} onAnswer={answer} /> : null;
  return [open, dialog] as const;
}

function ConfirmDialog({ title, body, confirm, cancel = 'Cancel', danger, onAnswer }: ConfirmOptions & { onAnswer: (ok: boolean) => void }) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  const yes = useRef<HTMLButtonElement>(null);
  const no = useRef<HTMLButtonElement>(null);
  // A dangerous question starts on Cancel, so a stray Enter can't close a storm or void a bill.
  useModal(box, { initial: danger ? no : yes });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onAnswer(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onAnswer]);
  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/50 p-4 sm:items-center" onClick={(e) => e.target === e.currentTarget && onAnswer(false)}>
      <div ref={box} role="alertdialog" aria-modal="true" aria-labelledby={titleId} className="w-full max-w-md rounded-popup bg-surface p-5 shadow-popup" data-testid="confirm-dialog">
        <h2 id={titleId} className="font-display text-lg font-semibold">{title}</h2>
        {body ? <div className="mt-2 text-sm text-ink-2">{body}</div> : null}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button ref={no} variant="outline" data-testid="confirm-no" onClick={() => onAnswer(false)}>{cancel}</Button>
          <Button ref={yes} variant={danger ? 'danger' : 'accent'} data-testid="confirm-yes" onClick={() => onAnswer(true)}>{confirm}</Button>
        </div>
      </div>
    </div>
  );
}
