'use client';

import { Badge, Button, Card, Select } from '@flake/ui';
import { proseLink } from '@/components/links';
import { useCallback, useEffect, useState } from 'react';
import { useConfirm } from '@/components/confirm';
import { api } from '@/lib/client';

const KEYS = [['plow', 'Plowing'], ['salt', 'Salt'], ['walks', 'Walks'], ['haul', 'Hauling'], ['seasonal', 'Seasonal installments'], ['other', 'Anything else']] as const;

interface Overview {
  configured: boolean;
  mock: boolean;
  connection: { status: 'connected' | 'disconnected' | 'error'; status_detail: string | null } | null;
  customers: { id: string; name: string; email: string | null; qbo_customer_id: string | null; suggested: { qboId: string; by: 'name' | 'email' } | null }[];
  qboCustomers: { id: string; name: string }[];
  items: { id: string; name: string }[];
  map: Record<string, string>;
  problems: { kind: 'draft' | 'installment'; id: string; storm_id: string | null; customer: string; error: string | null }[];
}

const NOTE: Record<string, string> = {
  connected: 'QuickBooks is connected.',
  expired: 'That took too long or came from another browser. Press Connect again.',
  cancelled: 'Connecting was cancelled.',
  failed: 'QuickBooks didn\'t accept the connection. Try again in a minute.',
};

/**
 * QuickBooks Online (issue 162). Approved bills and seasonal installments go to QuickBooks as invoices; payments
 * recorded there come back. Owners connect, match customers and pick items; everyone else sees the status.
 */
export function AccountingPanel({ owner, note }: { owner: boolean; note: string | null }) {
  const [ask, dialog] = useConfirm();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [items, setItems] = useState<Record<string, string>>({});
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api<Overview>('/api/integrations/qbo');
      setData(d);
      setItems(d.map);
      // A choice made while this was loading stays; only customers not yet picked get the suggestion.
      setPicks((now) => Object.fromEntries(d.customers.filter((c) => !c.qbo_customer_id).map((c) => [c.id, now[c.id] || c.suggested?.qboId || ''])));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const msg = await fn();
      await load();
      if (msg) setDone(msg);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <Card className="max-w-3xl"><p className="text-sm text-muted">{error ?? 'Loading...'}</p></Card>;
  const on = data.connection?.status === 'connected';
  const unmatched = data.customers.filter((c) => !c.qbo_customer_id);
  const matched = data.customers.filter((c) => c.qbo_customer_id);
  const qboName = (id: string) => data.qboCustomers.find((c) => c.id === id)?.name ?? id;
  return (
    <div className="max-w-3xl space-y-4" data-testid="accounting">
      {dialog}
      {note && NOTE[note] ? <p className={`rounded-md p-3 text-sm ${note === 'connected' ? 'bg-ok-tint text-ok-ink' : 'bg-warn-tint text-warn-ink'}`} role="status" data-testid="qbo-note">{NOTE[note]}</p> : null}
      <Card>
        <h2 className="font-semibold">QuickBooks Online</h2>
        <p className="mt-1 text-sm text-ink-2">Approved bills and seasonal installments go to QuickBooks as invoices. Payments recorded in QuickBooks mark them paid here. Card payments taken through Flake are posted there. An invoice changed in QuickBooks is never overwritten; it shows below instead.</p>
        <p className="mt-2 text-sm">
          Status: <Badge tone={on ? 'green' : data.connection?.status === 'error' ? 'red' : 'gray'} data-testid="qbo-status">{on ? 'Connected' : data.connection?.status === 'error' ? 'Needs reconnecting' : 'Not connected'}</Badge>
          {data.mock ? <span className="ml-2 text-xs text-muted">(test company)</span> : null}
        </p>
        {data.connection?.status_detail ? <p className="mt-1 text-sm text-danger">{data.connection.status_detail}</p> : null}
        {!data.configured ? <p className="mt-2 text-sm text-muted" data-testid="qbo-not-configured">QuickBooks isn&apos;t set up on this server yet. Until then, Billing&apos;s QuickBooks CSV still works.</p> : null}
        {owner && data.configured ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {!on ? <a className="inline-flex h-10 items-center rounded-md bg-ink px-4 text-sm font-semibold text-surface" href="/api/integrations/qbo/connect" data-testid="qbo-connect">Connect QuickBooks</a> : null}
            {on ? <Button variant="outline" disabled={busy} data-testid="qbo-sync" onClick={() => run(async () => {
              const r = await api<{ retried: number; paid: number }>('/api/integrations/qbo/sync', { method: 'POST' });
              return `Checked. ${r.paid} ${r.paid === 1 ? 'bill' : 'bills'} marked paid from QuickBooks, ${r.retried} sent again.`;
            })}>Sync now</Button> : null}
            {on ? <Button variant="ghost" disabled={busy} data-testid="qbo-disconnect" onClick={async () => {
              if (await ask({ title: 'Disconnect QuickBooks?', body: 'Nothing syncs until you connect again. Invoices already in QuickBooks stay there. Customer matches and item choices are cleared.', confirm: 'Disconnect', danger: true })) await run(async () => { await api('/api/integrations/qbo', { method: 'DELETE' }); return 'Disconnected.'; });
            }}>Disconnect</Button> : null}
          </div>
        ) : null}
        {done ? <p className="mt-2 text-sm text-ok-ink" role="status" data-testid="qbo-done">{done}</p> : null}
        {error ? <p className="mt-2 text-sm text-danger" role="alert" data-testid="qbo-error">{error}</p> : null}
      </Card>

      {on ? (
        <>
          <Card data-testid="qbo-items">
            <h2 className="font-semibold">Items</h2>
            <p className="mt-1 text-sm text-muted">The QuickBooks product or service each kind of line posts to.</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {KEYS.map(([k, label]) => (
                <label key={k} className="text-sm">
                  <span className="block font-medium">{label}</span>
                  <Select value={items[k] ?? ''} disabled={!owner} onChange={(e) => setItems({ ...items, [k]: e.target.value })} data-testid={`qbo-item-${k}`}>
                    <option value="">Pick an item</option>
                    {data.items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </Select>
                </label>
              ))}
            </div>
            {owner ? <Button className="mt-2" size="sm" disabled={busy} data-testid="qbo-items-save" onClick={() => run(async () => {
              await api('/api/integrations/qbo/items', { body: { map: Object.fromEntries(KEYS.map(([k]) => [k, items[k] || null])) } });
              return 'Items saved.';
            })}>Save items</Button> : null}
          </Card>

          <Card data-testid="qbo-customers">
            <h2 className="font-semibold">Customers</h2>
            <p className="mt-1 text-sm text-muted">Match each customer once. A bill for a customer with no match waits here until you match them.</p>
            {unmatched.length ? (
              <>
                <ul className="mt-2 divide-y divide-line-faint text-sm">
                  {unmatched.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center gap-2 py-2" data-testid="qbo-unmatched">
                      <span className="min-w-0 flex-1 wrap-anywhere font-medium">{c.name}{c.suggested ? <span className="ml-2 text-xs font-normal text-muted">suggested by {c.suggested.by}</span> : null}</span>
                      <Select className="w-auto max-w-full" aria-label={`QuickBooks customer for ${c.name}`} disabled={!owner} value={picks[c.id] ?? ''} onChange={(e) => setPicks({ ...picks, [c.id]: e.target.value })} data-testid="qbo-pick">
                        <option value="">Not yet</option>
                        <option value="new">Create in QuickBooks</option>
                        {data.qboCustomers.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
                      </Select>
                    </li>
                  ))}
                </ul>
                {owner ? <Button className="mt-2" size="sm" disabled={busy || !unmatched.some((c) => picks[c.id])} data-testid="qbo-match-save" onClick={() => run(async () => {
                  const matches = unmatched.filter((c) => picks[c.id]).map((c) => ({ customer_id: c.id, qbo: picks[c.id]! }));
                  const r = await api<{ created: number }>('/api/integrations/qbo/match', { body: { matches } });
                  return `${matches.length} matched${r.created ? `, ${r.created} created in QuickBooks` : ''}.`;
                })}>Save matches</Button> : null}
              </>
            ) : <p className="mt-2 text-sm text-ok-ink">Every customer is matched.</p>}
            {matched.length ? (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-link">Matched ({matched.length})</summary>
                <ul className="mt-1 space-y-1">
                  {matched.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center gap-2" data-testid="qbo-matched">
                      <span className="wrap-anywhere">{c.name} → {qboName(c.qbo_customer_id!)}</span>
                      {owner ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(async () => { await api('/api/integrations/qbo/match', { body: { matches: [{ customer_id: c.id, qbo: null }] } }); })}>Unmatch</Button> : null}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </Card>

          <Card data-testid="qbo-problems">
            <h2 className="font-semibold">Needs a look</h2>
            {data.problems.length ? (
              <ul className="mt-2 space-y-2 text-sm">
                {data.problems.map((p) => (
                  <li key={p.id} data-testid="qbo-problem">
                    <span className="font-medium wrap-anywhere">{p.customer}</span>, {p.kind === 'draft' ? <a className={proseLink} href={`/billing?storm=${p.storm_id}`}>storm bill</a> : 'seasonal installment'}: {p.error}
                  </li>
                ))}
              </ul>
            ) : <p className="mt-1 text-sm text-muted">Nothing waiting. Everything approved is in QuickBooks.</p>}
          </Card>
        </>
      ) : null}
    </div>
  );
}
