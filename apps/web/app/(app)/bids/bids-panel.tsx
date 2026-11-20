'use client';

import { Badge, Button, Card, Input, Label, Select, Table, Td, Th } from '@flake/ui';
import Link from 'next/link';
import { entityLink } from '@/components/links';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useConfirm } from '@/components/confirm';
import { api, dollarsToCents, money } from '@/lib/client';

interface Bid { id: string; who: string; customer_id: string | null; prospect_contact: string | null; site_ids: string[]; sites: string[]; stage: string; season: string; estimated_cents: number | null; notes: string | null; lost_reason: string | null; quote: string | null }
interface Data {
  bids: { rows: Bid[] };
  renewals: { season: string; next: string; rows: { contract_id: string; site_id: string; label: string; customer: string; customer_id: string }[] };
  customers: { id: string; name: string }[];
  sites: { id: string; label: string; customer_id: string }[];
}

const STAGES = [['lead', 'Lead'], ['site_walk', 'Site walk'], ['quote_sent', 'Quote sent'], ['won', 'Won'], ['lost', 'Lost']] as const;
const label = (s: string) => STAGES.find(([k]) => k === s)?.[1] ?? s;

export function BidsPanel({ data, season, readOnly }: { data: Data; season: string; readOnly: boolean }) {
  const router = useRouter();
  const [ask, dialog] = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [filter, setFilter] = useState('open');
  const [lost, setLost] = useState<{ id: string; why: string } | null>(null);
  const [f, setF] = useState({ customer_id: '', prospect: '', contact: '', sites: [] as string[], estimate: '', notes: '' });
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const shown = data.bids.rows.filter((b) => (filter === 'open' ? !['won', 'lost'].includes(b.stage) : filter === 'all' ? true : b.stage === filter));
  const pipeline = data.bids.rows.filter((b) => !['won', 'lost'].includes(b.stage)).reduce((a, b) => a + (b.estimated_cents ?? 0), 0);
  return (
    <div className="max-w-5xl space-y-4">
      {dialog}
      {error ? <p className="text-sm text-danger" role="alert" data-testid="bids-error">{error}</p> : null}
      {note ? <p className="rounded-md bg-ok-tint p-3 text-sm text-ok-ink" role="status" data-testid="bids-note">{note}</p> : null}

      <Card data-testid="renewals">
        <h2 className="font-semibold">Renewals for {data.renewals.next}</h2>
        <p className="mt-1 text-sm text-muted">This winter&apos;s signed lots with nothing yet for next winter. Renew makes a draft with the same services and prices; you can change it, then send it from the lot like any quote.</p>
        {data.renewals.rows.length ? (
          <ul className="mt-2 divide-y divide-line-faint text-sm">
            {data.renewals.rows.map((r) => (
              <li key={r.contract_id} className="flex flex-wrap items-center gap-2 py-1.5" data-testid="renewal-row">
                <Link className={`${entityLink} wrap-anywhere`} href={`/sites/${r.site_id}`}>{r.label}</Link><span className="text-muted wrap-anywhere">{r.customer}</span>
                {!readOnly ? <Button size="sm" variant="outline" className="ml-auto" disabled={busy} data-testid="renew" onClick={async () => {
                  if (await run(() => api(`/api/contracts/${r.contract_id}/renew`, { method: 'POST' }))) setNote(`Draft for ${data.renewals.next} made for ${r.label}. Open the lot to check it and send the quote.`);
                }}>Renew</Button> : null}
              </li>
            ))}
          </ul>
        ) : <p className="mt-2 text-sm text-ok-ink">Nothing waiting.</p>}
      </Card>

      <Card data-testid="bids">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="font-semibold">Bids</h2>
          <div className="flex items-center gap-2 text-sm"><span className="text-muted">Open bids: {money(pipeline)}</span>
            <Select aria-label="Show" className="w-auto" value={filter} onChange={(e) => setFilter(e.target.value)} data-testid="bids-filter"><option value="open">Open</option><option value="all">All</option>{STAGES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></div>
        </div>
        {shown.length ? (
          <Table stack className="mt-2">
            <thead><tr><Th>Who</Th><Th>Lots</Th><Th className="text-right">Estimate</Th><Th>Stage</Th></tr></thead>
            <tbody>
              {shown.map((b) => (
                <tr key={b.id} data-testid="bid-row">
                  <Td className="wrap-anywhere">{b.customer_id ? <Link className={entityLink} href={`/customers/${b.customer_id}`}>{b.who}</Link> : <span className="font-medium">{b.who}</span>}<span className="block text-xs text-muted">{b.season}{b.prospect_contact ? `, ${b.prospect_contact}` : ''}</span>{b.notes ? <span className="block text-xs wrap-anywhere">{b.notes}</span> : null}</Td>
                  <Td label="Lots" className="wrap-anywhere">{b.sites.join(', ') || '-'}</Td>
                  <Td label="Estimate" className="text-right tabular">{b.estimated_cents == null ? '-' : money(b.estimated_cents)}</Td>
                  <Td label="Stage">
                    {readOnly ? <Badge>{label(b.stage)}</Badge> : <Select aria-label={`Stage for ${b.who}`} className="w-auto" value={b.stage} disabled={busy} data-testid="bid-stage" onChange={async (e) => {
                      const stage = e.target.value;
                      // Lost asks why first, on the row.
                      if (stage === 'lost') return setLost({ id: b.id, why: '' });
                      await run(() => api(`/api/bids/${b.id}`, { method: 'PATCH', body: { stage } }));
                    }}>{STAGES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}
                    {lost?.id === b.id ? (
                      <span className="mt-1 flex flex-wrap items-end gap-1" data-testid="bid-lost-form">
                        <Input aria-label="Why it was lost" placeholder="Price, went with someone else" maxLength={500} className="w-56" value={lost.why} onChange={(e) => setLost({ ...lost, why: e.target.value })} data-testid="bid-lost-why" />
                        <Button size="sm" disabled={busy || !lost.why.trim()} data-testid="bid-lost-save" onClick={async () => { if (await run(() => api(`/api/bids/${b.id}`, { method: 'PATCH', body: { stage: 'lost', lost_reason: lost.why.trim() } }))) setLost(null); }}>Mark lost</Button>
                        <Button size="sm" variant="ghost" onClick={() => setLost(null)}>Cancel</Button>
                      </span>
                    ) : null}
                    {b.quote === 'accepted' && b.stage !== 'won' ? <span className="block text-xs text-ok-ink" data-testid="bid-signed">Quote signed: mark it won</span> : null}
                    {b.quote === 'declined' && b.stage !== 'lost' ? <span className="block text-xs text-danger" data-testid="bid-declined">Quote declined</span> : null}
                    {b.stage === 'lost' && b.lost_reason ? <span className="block text-xs text-muted wrap-anywhere">{b.lost_reason}</span> : null}
                    {!readOnly ? <Button size="sm" variant="ghost" disabled={busy} aria-label={`Remove the bid for ${b.who}`} onClick={async () => { if (await ask({ title: 'Remove this bid?', body: 'Its quote and lots stay.', confirm: 'Remove', danger: true })) await run(() => api(`/api/bids/${b.id}`, { method: 'DELETE' })); }}>Remove</Button> : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : <p className="mt-2 text-sm text-muted">No bids here.</p>}

        {!readOnly ? (
          <div className="mt-3 grid gap-2 border-t border-line-faint pt-3 sm:grid-cols-2" data-testid="bid-form">
            <div><Label htmlFor="b-cust">Customer</Label><Select id="b-cust" value={f.customer_id} onChange={(e) => setF({ ...f, customer_id: e.target.value, sites: [] })} data-testid="bid-customer"><option value="">A new prospect</option>{data.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
            {f.customer_id ? (
              <div><Label htmlFor="b-sites">Lots</Label><Select id="b-sites" multiple className="h-24" value={f.sites} onChange={(e) => setF({ ...f, sites: [...e.target.selectedOptions].map((o) => o.value) })}>{data.sites.filter((s) => s.customer_id === f.customer_id).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select></div>
            ) : (
              <>
                <div><Label htmlFor="b-name">Prospect name</Label><Input id="b-name" maxLength={200} value={f.prospect} onChange={(e) => setF({ ...f, prospect: e.target.value })} data-testid="bid-prospect" /></div>
                <div><Label htmlFor="b-contact">Contact (optional)</Label><Input id="b-contact" maxLength={300} placeholder="Name and phone" value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} /></div>
              </>
            )}
            <div><Label htmlFor="b-est">Estimate for the season ($, optional)</Label><Input id="b-est" type="number" inputMode="decimal" min={0} value={f.estimate} onChange={(e) => setF({ ...f, estimate: e.target.value })} data-testid="bid-estimate" /></div>
            <div className="sm:col-span-2"><Label htmlFor="b-notes">Notes (optional)</Label><Input id="b-notes" maxLength={4000} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
            <Button size="sm" className="sm:w-fit" disabled={busy || (!f.customer_id && !f.prospect.trim())} data-testid="bid-add" onClick={async () => {
              if (await run(() => api('/api/bids', { body: { ...(f.customer_id ? { customer_id: f.customer_id, site_ids: f.sites } : { prospect_name: f.prospect.trim(), ...(f.contact.trim() ? { prospect_contact: f.contact.trim() } : {}) }), season, ...(f.estimate ? { estimated_cents: dollarsToCents(f.estimate) } : {}), ...(f.notes.trim() ? { notes: f.notes.trim() } : {}) } }))) setF({ customer_id: '', prospect: '', contact: '', sites: [], estimate: '', notes: '' });
            }}>Add bid for {season}</Button>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
