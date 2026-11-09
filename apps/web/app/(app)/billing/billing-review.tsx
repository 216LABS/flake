'use client';

import { flagKey, isDraftClean, type BillingFlag } from '@flake/core/billing';
import { Badge, Button, Card, EmptyState, Input, Table, Td, Th, buttonVariants } from '@flake/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, money } from '@/lib/client';

export interface DraftRow {
  id: string;
  customer: string;
  billing_mode: string;
  status: string;
  status_detail: string | null;
  subtotal_cents: number;
  lines: { description: string; quantity: number; amount_cents: number }[];
  flags: BillingFlag[];
  fee_cents: number;
  stripe_fee_cents: number;
  pay_link: string | null;
  disputed: boolean;
}

const TONE: Record<string, 'gray' | 'blue' | 'green' | 'amber' | 'red'> = { draft: 'gray', approved: 'blue', charged: 'green', sent: 'blue', paid: 'green', failed: 'red', void: 'gray' };

export function BillingReview({ stormId, initial, canExport, showFees }: { stormId: string; initial: DraftRow[]; canExport: boolean; showFees: boolean }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [flaggedOnly, setFlaggedOnly] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setRows(initial), [initial]);

  // Charges run in the background; keep the table current while anything is in flight.
  const inFlight = rows.some((r) => r.status === 'approved' && !r.status_detail);
  useEffect(() => {
    if (!inFlight) return;
    const t = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(t);
  }, [inFlight]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const fix = (body: Record<string, unknown>) => run(() => api('/api/billing/fix', { body: { storm_id: stormId, ...body } }));
  const clean = rows.filter((r) => r.status === 'draft' && isDraftClean(r.flags));
  const flagged = rows.filter((r) => r.status === 'draft' && !isDraftClean(r.flags));
  const shown = flaggedOnly ? rows.filter((r) => r.status !== 'draft' || !isDraftClean(r.flags)) : rows;
  const total = rows.reduce((s, r) => s + r.subtotal_cents, 0);
  const fees = rows.reduce((s, r) => s + r.fee_cents, 0);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant={rows.length ? 'outline' : 'accent'} disabled={busy} data-testid="generate" onClick={() => run(() => api(`/api/storms/${stormId}/billing/draft`, { method: 'POST' }))}>{rows.length ? 'Regenerate drafts' : 'Generate drafts'}</Button>
        <Button variant="accent" disabled={busy || !clean.length} data-testid="approve-clean" onClick={() => run(async () => {
          // The server takes 500 at a time, and a big company can have more lots than that in one storm.
          for (let i = 0; i < clean.length; i += 500) await api('/api/billing/approve', { body: { draftIds: clean.slice(i, i + 500).map((r) => r.id) } });
        })}>Approve all clean ({clean.length})</Button>
        <label className="ml-2 flex items-center gap-2 text-sm"><input type="checkbox" data-testid="flagged-only" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} /> Show flagged only</label>
        {canExport ? <a className={buttonVariants({ variant: 'outline' })} data-testid="qbo" href={`/api/billing/export.csv?storm=${stormId}`}>QuickBooks CSV</a> : null}
      </div>
      {error ? <p className="mb-3 rounded-md bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p> : null}
      {!rows.length ? <EmptyState title="No drafts yet" body="Generate drafts to price this storm's visits." /> : null}
      {rows.length ? <p className="mb-3 text-sm text-slate-600">{flagged.length} flagged, {clean.length} clean and ready. Total {money(total)}.{showFees ? ` Flake fees ${money(fees)}.` : ''}</p> : null}
      {flaggedOnly && rows.length && !shown.length ? <EmptyState title="Nothing is flagged" body="Everything here is clean. Approve it, or turn off the filter to see it." /> : null}
      <div className="space-y-3">
        {shown.map((r) => (
          <Card key={r.id} data-testid="draft" data-status={r.status}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold">{r.customer}</div>
              <div className="flex items-center gap-2">
                {r.disputed ? <Badge tone="red">Disputed: generate a proof packet</Badge> : null}
                <Badge tone={TONE[r.status]} data-testid="draft-status">{r.status}</Badge>
                <span className="font-semibold" data-testid="draft-total">{money(r.subtotal_cents)}</span>
              </div>
            </div>
            {r.status_detail ? <p className="mt-1 text-sm text-amber-800" data-testid="status-detail">{r.status_detail}</p> : null}
            {r.status === 'failed' || (r.status === 'approved' && r.status_detail && r.billing_mode !== 'manual') ? <Button size="sm" variant="outline" className="mt-1" disabled={busy} data-testid="retry" onClick={() => run(() => api('/api/billing/retry', { body: { draftId: r.id } }))}>Try again</Button> : null}
            {r.pay_link ? <p className="mt-1 text-sm">Pay link sent: <a className="text-sky-800 underline" href={r.pay_link}>open</a></p> : null}
            {r.lines.length ? (
              <div className="mt-2"><Table>
                <thead><tr><Th>Line</Th><Th>Qty</Th><Th>Amount</Th></tr></thead>
                <tbody>{r.lines.map((l, i) => <tr key={i}><Td>{l.description}</Td><Td>{l.quantity}</Td><Td>{money(l.amount_cents)}</Td></tr>)}</tbody>
              </Table></div>
            ) : null}
            {r.flags.length ? (
              <ul className="mt-2 space-y-2">
                {r.flags.map((f) => <FlagRow key={flagKey(f)} flag={f} editable={r.status === 'draft'} busy={busy} onFix={fix} />)}
              </ul>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
              <span>{showFees ? `Only owners see this: Flake fee ${money(r.fee_cents)}. Estimated Stripe fee ${money(r.stripe_fee_cents)}. ` : ''}{r.billing_mode.replace(/_/g, ' ')}.</span>
              {r.status === 'draft' ? <Button size="sm" variant="outline" disabled={busy} data-testid="approve-one" onClick={() => run(() => api('/api/billing/approve', { body: { draftIds: [r.id] } }))}>Approve</Button> : null}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function FlagRow({ flag, editable, busy, onFix }: { flag: BillingFlag; editable: boolean; busy: boolean; onFix: (b: Record<string, unknown>) => void }) {
  const [qty, setQty] = useState('');
  return (
    <li className={`rounded-md p-2 text-sm ${flag.severity === 'info' || flag.waived ? 'bg-slate-50 text-slate-600' : 'bg-amber-50 text-amber-950'}`} data-testid="flag" data-code={flag.code}>
      <div>{flag.message}{flag.waived ? ' (waived)' : ''}</div>
      {editable && flag.severity === 'review' && !flag.waived ? (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {flag.code === 'missing_visit' ? <Button size="sm" variant="outline" disabled={busy} data-testid="fix-skip" onClick={() => onFix({ action: 'skip', site_id: flag.site_id })}>Mark skipped</Button> : null}
          {flag.code === 'duplicate' && flag.visit_id ? <Button size="sm" variant="outline" disabled={busy} data-testid="fix-replow" onClick={() => onFix({ action: 'replow', visit_id: flag.visit_id })}>Mark re-plow</Button> : null}
          {flag.code === 'missing_salt_qty' && flag.visit_id ? (
            <>
              <Input aria-label="Bags of salt" className="h-8 w-20" type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} data-testid="salt-qty" />
              <Button size="sm" variant="outline" disabled={busy || !qty} data-testid="fix-salt" onClick={() => onFix({ action: 'salt', visit_id: flag.visit_id, unit: 'bag50lb', qty: Number(qty) })}>Add salt qty</Button>
            </>
          ) : null}
          {flag.code === 'missing_depth' ? (
            <>
              <Input aria-label="Snow depth in inches" className="h-8 w-20" type="number" min={0} step={0.5} value={qty} onChange={(e) => setQty(e.target.value)} data-testid="depth-in" />
              <Button size="sm" variant="outline" disabled={busy || qty === ''} data-testid="fix-depth" onClick={() => onFix({ action: 'depth', site_id: flag.site_id, depth_in: Number(qty) })}>Set depth</Button>
            </>
          ) : null}
          {/* Waiving a missing depth would bill a per-inch lot $0, so that one needs a depth instead. */}
          {flag.code !== 'missing_depth' ? <Button size="sm" variant="ghost" disabled={busy} data-testid="fix-waive" onClick={() => onFix({ action: 'waive', flag_key: flagKey(flag) })}>Waive</Button> : null}
        </div>
      ) : null}
    </li>
  );
}
