'use client';

import { Button, buttonVariants, cn, Textarea } from '@flake/ui';
import { Bug, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/client';

/**
 * A round "Report a problem" button pinned to the bottom-right of every office screen, for the pilot (issue 186). It
 * opens a small card (a sheet above the tab bar on a phone) that goes to the Flake team with the page it was sent from.
 */
export function FeedbackButton() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLElement>(null);

  const close = () => {
    setOpen(false);
    if (state === 'sent') setMessage('');
    // Focus goes back where it came from.
    requestAnimationFrame(() => trigger.current?.focus());
  };

  useEffect(() => {
    if (!open) return;
    // After the tap settles: a touch moves focus to the button once the click has run.
    const frame = requestAnimationFrame(() => (card.current?.querySelector<HTMLElement>('textarea') ?? card.current?.querySelector<HTMLElement>('button'))?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, state]);

  return (
    <>
      <div className="print:hidden">
        <button
          ref={trigger}
          type="button"
          aria-label="Report a problem"
          title="Report a problem"
          aria-expanded={open}
          aria-controls="feedback"
          data-read
          data-testid="feedback-open"
          onClick={() => {
            if (open) return close();
            setOpen(true);
            if (state === 'sent') setState('idle');
            setError(null);
          }}
          className="fixed right-4 z-40 flex size-12 items-center justify-center rounded-full bg-slate-950 text-white shadow-popup ring-2 ring-white/70 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 md:bottom-6 md:right-6 bottom-[calc(4.25rem+env(safe-area-inset-bottom))]"
        >
          {open ? <X size={22} aria-hidden="true" /> : <Bug size={22} aria-hidden="true" />}
        </button>
        {open ? (
          <section
            ref={card}
            id="feedback"
            role="dialog"
            aria-labelledby="feedback-title"
            data-testid="feedback"
            className="fixed inset-x-0 z-40 rounded-t-popup border border-line-faint bg-surface p-4 shadow-popup bottom-[calc(3.5rem+env(safe-area-inset-bottom))] md:inset-x-auto md:bottom-20 md:right-6 md:w-96 md:rounded-surface"
          >
            <h2 id="feedback-title" className="pr-8 font-semibold">Report a problem</h2>
            <button type="button" aria-label="Close" className="absolute right-2 top-2 flex size-10 items-center justify-center rounded-full text-muted hover:text-ink" onClick={close}><X size={18} aria-hidden="true" /></button>
            {state === 'sent' ? (
              <>
                <p className="mt-2 text-sm" role="status" data-testid="feedback-sent">Thanks. It went to the Flake team with this page attached. We read every one.</p>
                <Button size="sm" variant="ghost" className="-ml-3 mt-2" data-read onClick={close}>Close</Button>
              </>
            ) : (
              <>
                <p className="mt-1 text-sm text-muted">What were you trying to do, and what happened? We get this page&apos;s address with it.</p>
                <label className="sr-only" htmlFor="feedback-message">Your feedback</label>
                <Textarea id="feedback-message" className="mt-2" rows={4} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} data-testid="feedback-message" />
                {error ? <p className="mt-2 text-sm text-danger" role="alert">{error}</p> : null}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="accent" data-read disabled={state === 'sending' || message.trim().length < 3} data-testid="feedback-send" onClick={async () => {
                    setState('sending');
                    setError(null);
                    try {
                      await api('/api/feedback', { body: { message: message.trim(), path } });
                      setState('sent');
                    } catch (e) {
                      setError((e as Error).message);
                      setState('idle');
                    }
                  }}>{state === 'sending' ? 'Sending' : 'Send'}</Button>
                  <Button size="sm" variant="ghost" data-read onClick={close}>Cancel</Button>
                  <Link className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'ml-auto')} href="/help" data-testid="help-link" onClick={() => setOpen(false)}>Storm-night guide</Link>
                </div>
              </>
            )}
          </section>
        ) : null}
      </div>
    </>
  );
}
