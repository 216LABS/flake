'use client';

import { Button, Textarea } from '@flake/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client';

/**
 * "Something confusing or broken? Tell us." on every office screen, for the pilot. It goes to the Flake team with the
 * page it was sent from, so feedback doesn't get lost in texts.
 */
export function FeedbackButton() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  if (!open) {
    return (
      <p className="mt-10 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted print:hidden">
        <button type="button" className="underline underline-offset-2 hover:text-ink" data-read data-testid="feedback-open" onClick={() => { setOpen(true); setState('idle'); setError(null); }}>
          Something confusing or broken? Tell us
        </button>
        <Link className="underline underline-offset-2 hover:text-ink" href="/help" data-testid="help-link">Storm-night guide</Link>
      </p>
    );
  }
  return (
    <section className="mt-10 max-w-xl rounded-surface border border-line-faint bg-surface p-4 print:hidden" aria-labelledby="feedback-title" data-testid="feedback">
      <h2 id="feedback-title" className="font-semibold">Send feedback to Flake</h2>
      {state === 'sent' ? (
        <>
          <p className="mt-2 text-sm" role="status" data-testid="feedback-sent">Thanks. It went to the Flake team with this page attached. We read every one.</p>
          <Button size="sm" variant="ghost" className="-ml-3 mt-2" data-read onClick={() => { setOpen(false); setMessage(''); }}>Close</Button>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted">What were you trying to do, and what happened? We get this page&apos;s address with it.</p>
          <label className="sr-only" htmlFor="feedback-message">Your feedback</label>
          <Textarea id="feedback-message" className="mt-2" rows={4} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} data-testid="feedback-message" />
          {error ? <p className="mt-2 text-sm text-danger" role="alert">{error}</p> : null}
          <div className="mt-2 flex gap-2">
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
            <Button size="sm" variant="ghost" data-read onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </>
      )}
    </section>
  );
}
