'use client';

import { Button, Card } from '@flake/ui';
import { useState } from 'react';
import { api } from '@/lib/client';

/** The customer's private records page: every visit with photos, and their invoices. */
export function PortalCard({ customerId, email }: { customerId: string; email: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setError('');
    setNote('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const copy = () => run(async () => {
    const link = url ?? (await api<{ url: string }>(`/api/customers/${customerId}/portal`)).url;
    setUrl(link);
    try {
      await navigator.clipboard.writeText(link);
      setNote('Copied.');
    } catch {
      setNote('Select the link below to copy it.');
    }
  });
  const send = () => run(async () => {
    const r = await api<{ url: string; sent_to: string }>(`/api/customers/${customerId}/portal`, { body: { action: 'email' } });
    setUrl(r.url);
    setNote(`Emailed to ${r.sent_to}.`);
  });
  const reset = () => run(async () => {
    const r = await api<{ url: string }>(`/api/customers/${customerId}/portal`, { body: { action: 'reset' } });
    setUrl(r.url);
    setConfirmReset(false);
    setNote('New link made. The old one no longer works.');
  });
  return (
    <Card data-testid="portal-card">
      <h2 className="font-semibold">Records page</h2>
      <p className="mt-1 text-sm text-slate-600">A private page where this customer sees every visit with times and photos, and their invoices. It needs no login.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={copy} data-testid="portal-copy">Copy link</Button>
        <Button variant="outline" size="sm" onClick={send} disabled={!email} title={email ? undefined : 'Add an email first'} data-testid="portal-email">Email it to them</Button>
        {confirmReset ? (
          <>
            <Button variant="danger" size="sm" onClick={reset} data-testid="portal-reset-confirm">Turn off the old link</Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmReset(false)}>Cancel</Button>
          </>
        ) : <Button variant="ghost" size="sm" onClick={() => setConfirmReset(true)} data-testid="portal-reset">Make a new link</Button>}
      </div>
      {url ? <input readOnly value={url} aria-label="Records page link" onFocus={(e) => e.currentTarget.select()} className="mt-3 w-full rounded-md border border-slate-300 bg-slate-50 px-2 py-1 text-xs" data-testid="portal-url" /> : null}
      {note ? <p className="mt-2 text-sm text-emerald-800" role="status">{note}</p> : null}
      {error ? <p className="mt-2 text-sm text-red-700" role="alert">{error}</p> : null}
    </Card>
  );
}
