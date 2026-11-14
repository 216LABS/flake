'use client';

import { FLAG_TIER, TIER_ORDER, flagKey, isDraftClean, noBillKey, tierReasons, type BillingFlag, type FlagTier } from '@flake/core/billing';
import { Badge, Button, Card, EmptyState, Input, Table, Td, Th, buttonVariants } from '@flake/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useConfirm } from '@/components/confirm';
import { api, money } from '@/lib/client';
import { billingLabel, invoiceStatus } from '@/lib/labels';

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

const SALT_UNIT: Record<string, string> = { bag50lb: 'bags', lb: 'lb', ton: 'tons', application: 'applications' };

export function BillingReview({ stormId, initial, canExport, showFees, stormActive = false, stripeReady = true, nothingToBill = false }: { stormId: string; initial: DraftRow[]; canExport: boolean; showFees: boolean; stormActive?: boolean; stripeReady?: boolean; nothingToBill?: boolean }) {
  const router = useRouter();
  const [ask, dialog] = useConfirm();
  const [rows, setRows] = useState(initial);
  // Everything shows by default, flagged first, so the clean invoices and the total aren't hidden (issue 50).
  const [flaggedOnly, setFlaggedOnly] = useState(false);
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
  const needsWork = (r: DraftRow) => r.status === 'draft' && !isDraftClean(r.flags);
  // Lots nobody reached make $0 drafts with only "missing visit" on them. They're one list with one action at the top,
  // not a card each (issue 85).
  const open = (r: DraftRow) => r.flags.filter((f) => f.severity === 'review' && !f.waived);
  // A lot where the driver arrived and never tapped Done was plowed: it stays in the list, where it can be finished.
  const unplowed = rows.filter((r) => r.status === 'draft' && r.subtotal_cents === 0 && open(r).length > 0 && open(r).every((f) => f.code === 'missing_visit' && !f.open_visit_id));
  const unplowedSites = [...new Set(unplowed.flatMap((r) => open(r).map((f) => f.site_id)))];
  // Money at risk first, then missing proof (issue 78).
  const worst = (r: DraftRow) => Math.min(...open(r).map((f) => TIER_ORDER.indexOf(FLAG_TIER[f.code])), TIER_ORDER.length);
  const shown = (flaggedOnly ? rows.filter((r) => r.status !== 'draft' || !isDraftClean(r.flags)) : rows).filter((r) => !unplowed.includes(r)).slice()
    .sort((a, b) => Number(needsWork(b)) - Number(needsWork(a)) || worst(a) - worst(b));
  const tierCount = (t: FlagTier) => rows.filter((r) => r.status === 'draft' && !unplowed.includes(r) && open(r).some((f) => FLAG_TIER[f.code] === t)).length;
  // Only the reasons actually on these bills (issue 75 retest).
  const tierWhy = (t: FlagTier) => tierReasons(t, rows.filter((r) => r.status === 'draft' && !unplowed.includes(r)).flatMap((r) => open(r).map((f) => f.code)));
  const total = rows.reduce((s, r) => s + r.subtotal_cents, 0);
  const fees = rows.reduce((s, r) => s + r.fee_cents, 0);

  if (stormActive) return <EmptyState title="This storm is still going" body="Close it on the storm board when the work is done. Its invoices are drafted here after that, so nothing still coming in is missed." />;

  const revise = async (r: DraftRow, to: 'draft' | 'void' | 'paid') => {
    const ok = await ask(to === 'void'
      ? { title: `Void ${r.customer}'s invoice?`, body: <>Nothing more is charged for it. {r.pay_link ? 'A pay link already went to the customer: deactivate it in your Stripe dashboard too.' : ''}</>, confirm: 'Void invoice', danger: true }
      : to === 'paid'
        ? { title: `Mark ${r.customer}'s invoice paid?`, body: <>For a check, cash or other payment you already have. Nothing is charged for it. {r.pay_link ? 'A pay link already went to the customer: deactivate it in your Stripe dashboard so they don\'t pay twice.' : ''}</>, confirm: 'Mark paid' }
        : { title: `Take ${r.customer}'s invoice back to review?`, body: 'Nothing is charged until you approve it again.', confirm: 'Back to review' });
    if (ok) await run(() => api('/api/billing/revise', { body: { draftId: r.id, to } }));
  };
  // A bill nobody charges through Stripe goes to the customer from here, with a link to their records page.
  const sendBill = async (r: DraftRow) => {
    if (await ask({ title: `Send ${r.customer} this bill?`, body: 'They get an email (and a text, if they agreed to texts) with the total and a link to their records page, which lists every line and how to pay you.', confirm: 'Send bill' })) {
      await run(() => api('/api/billing/send', { body: { draftId: r.id } }));
    }
  };
  return (
    <div>
      {dialog}
      {!stripeReady && rows.length ? (
        <p className="mb-4 rounded-md bg-info-tint p-3 text-sm text-link" data-testid="stripe-not-connected">
          Stripe isn&apos;t connected, so approving doesn&apos;t charge anyone yet. Approved invoices wait here. Connect Stripe in <a className="underline" href="/settings?tab=payments">Settings, Payments</a>, then press Charge now on each. Or press Send bill to email each customer their bill, and Mark paid when the money comes in.
        </p>
      ) : null}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant={rows.length ? 'outline' : 'accent'} disabled={busy} data-testid="generate" onClick={() => run(() => api(`/api/storms/${stormId}/billing/draft`, { method: 'POST' }))}>{rows.length ? 'Regenerate drafts' : 'Generate drafts'}</Button>
        <Button variant="accent" disabled={busy || !clean.length} data-testid="approve-clean" onClick={() => run(async () => {
          // The server takes 500 at a time, and a big company can have more lots than that in one storm.
          for (let i = 0; i < clean.length; i += 500) await api('/api/billing/approve', { body: { draftIds: clean.slice(i, i + 500).map((r) => r.id) } });
        })}>Approve all clean ({clean.length})</Button>
        <label className="ml-2 flex items-center gap-2 text-sm"><input type="checkbox" data-testid="flagged-only" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} /> Show flagged only</label>
        {canExport ? <a className={buttonVariants({ variant: 'outline' })} data-testid="qbo" href={`/api/billing/export.csv?storm=${stormId}`}>QuickBooks CSV (approved)</a> : null}
      </div>
      {error ? <p className="mb-3 rounded-md bg-danger-tint p-3 text-sm text-danger" role="alert">{error}</p> : null}
      {!rows.length ? (nothingToBill
        ? <EmptyState title="Nothing to bill for this storm" body="Its lots are on seasonal contracts, or were skipped, so no invoice was needed. Seasonal installments bill on their own each month." />
        : <EmptyState title="No drafts yet" body="Generate drafts to price this storm's visits." />) : null}
      {rows.length ? <p className="mb-3 text-sm text-muted">{flagged.length} flagged, {clean.length} clean and ready. Total {money(total)}.{showFees ? ` Flake fees ${money(fees)}.` : ''}</p> : null}
      {rows.length && (tierCount('money') || tierCount('proof')) ? (
        <p className="mb-3 text-sm" data-testid="flag-tiers">
          {tierCount('money') ? <><b className="text-danger">{tierCount('money')} with money at risk</b> ({tierWhy('money')}). </> : null}
          {tierCount('proof') ? <><b>{tierCount('proof')} missing proof</b> ({tierWhy('proof')}). Waive if you know the work was done.</> : null}
        </p>
      ) : null}
      {unplowed.length ? (
        <Card className="mb-3 border-line" data-testid="unplowed">
          <p className="font-medium">{unplowedSites.length === 1 ? '1 lot was' : `${unplowedSites.length} lots were`} not plowed this storm.</p>
          <p className="mt-1 text-sm text-ink-2">{unplowed.map((r) => r.customer).join(', ')}. Nothing is billed for {unplowedSites.length === 1 ? 'it' : 'them'}.</p>
          <Button size="sm" variant="outline" className="mt-2" disabled={busy} data-testid="unplowed-skip" onClick={() => fix({ action: 'skip_all', site_ids: unplowedSites })}>Mark {unplowedSites.length === 1 ? 'it' : 'all'} skipped</Button>
        </Card>
      ) : null}
      {flaggedOnly && rows.length && !shown.length ? <EmptyState title="Nothing is flagged" body="Everything here is clean. Approve it, or turn off the filter to see it." /> : null}
      <div className="space-y-3">
        {shown.map((r) => (
          <Card key={r.id} data-testid="draft" data-status={r.status} data-draft-id={r.id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold">{r.customer}</div>
              <div className="flex items-center gap-2">
                {r.disputed ? <Badge tone="red">Disputed: generate a proof packet</Badge> : null}
                <Badge tone={TONE[r.status]} data-testid="draft-status">{invoiceStatus(r.status)}</Badge>
                <span className="font-semibold" data-testid="draft-total">{money(r.subtotal_cents)}</span>
              </div>
            </div>
            {r.status_detail ? <p className="mt-1 text-sm text-warn-ink" data-testid="status-detail">{r.status_detail}</p> : null}
            <div className="mt-1 flex flex-wrap gap-2">
              {r.status === 'failed' || (r.status === 'approved' && r.status_detail && r.billing_mode !== 'manual') ? <Button size="sm" variant="outline" disabled={busy || (r.status === 'approved' && !stripeReady)} data-testid="retry" onClick={() => run(() => api('/api/billing/retry', { body: { draftId: r.id } }))}>{r.status === 'failed' ? 'Try again' : 'Charge now'}</Button> : null}
              {r.status === 'approved' && (r.billing_mode === 'manual' || !stripeReady) ? <Button size="sm" variant="outline" disabled={busy} data-testid="send-bill" onClick={() => void sendBill(r)}>Send bill</Button> : null}
              {r.status === 'approved' || r.status === 'failed' ? <Button size="sm" variant="outline" disabled={busy} data-testid="mark-paid" onClick={() => void revise(r, 'paid')}>Mark paid</Button> : null}
              {r.status === 'approved' || r.status === 'failed' ? <Button size="sm" variant="ghost" disabled={busy} data-testid="unapprove" onClick={() => void revise(r, 'draft')}>Back to review</Button> : null}
              {['draft', 'approved', 'failed'].includes(r.status) ? <Button size="sm" variant="ghost" disabled={busy} data-testid="void" onClick={() => void revise(r, 'void')}>Void</Button> : null}
            </div>
            {r.pay_link ? <p className="mt-1 text-sm">Pay link sent: <a className="text-link underline" href={r.pay_link}>open</a></p> : null}
            {r.lines.length ? (
              <div className="mt-2"><Table>
                <thead><tr><Th>Line</Th><Th>Qty</Th><Th>Amount</Th></tr></thead>
                <tbody>{r.lines.map((l, i) => <tr key={i}><Td>{l.description}</Td><Td>{l.quantity}</Td><Td>{money(l.amount_cents)}</Td></tr>)}</tbody>
              </Table></div>
            ) : null}
            {r.flags.length ? (
              <ul className="mt-2 space-y-2">
                {[...r.flags].sort((a, b) => TIER_ORDER.indexOf(FLAG_TIER[a.code]) - TIER_ORDER.indexOf(FLAG_TIER[b.code])).map((f) => <FlagRow key={flagKey(f)} flag={f} editable={r.status === 'draft'} busy={busy} onFix={fix} />)}
              </ul>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-faint">
              <span>{showFees ? (r.billing_mode === 'manual' ? 'Billed outside Stripe, so no Flake or Stripe fee. ' : `Only owners see this: Flake fee ${money(r.fee_cents)}. Estimated Stripe fee ${money(r.stripe_fee_cents)}. `) : ''}{billingLabel(r.billing_mode)}.</span>
              {r.status === 'draft' && isDraftClean(r.flags) ? <Button size="sm" variant="outline" disabled={busy} data-testid="approve-one" onClick={() => run(() => api('/api/billing/approve', { body: { draftIds: [r.id] } }))}>Approve</Button> : null}
              {r.status === 'draft' && !isDraftClean(r.flags) ? <span className="font-medium text-warn-ink" data-testid="approve-blocked">Fix or waive the flags to approve.</span> : null}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

const TIER_LABEL: Record<FlagTier, string> = { money: 'Money at risk', proof: 'Proof missing', not_done: 'Not plowed', info: '' };

function FlagRow({ flag, editable, busy, onFix }: { flag: BillingFlag; editable: boolean; busy: boolean; onFix: (b: Record<string, unknown>) => void }) {
  const [qty, setQty] = useState('');
  return (
    <li className={`rounded-md p-2 text-sm ${flag.severity === 'info' || flag.waived ? 'bg-tint text-muted' : FLAG_TIER[flag.code] === 'money' ? 'bg-danger-tint text-danger-ink' : 'bg-warn-tint text-warn-ink'}`} data-testid="flag" data-code={flag.code} data-tier={FLAG_TIER[flag.code]}>
      {flag.severity === 'review' && !flag.waived ? <div className="text-xs font-semibold uppercase tracking-wide opacity-80">{TIER_LABEL[FLAG_TIER[flag.code]]}</div> : null}
      <div>{flag.message}{flag.waived ? ' (waived)' : ''}</div>
      {editable && flag.severity === 'review' && !flag.waived ? (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {flag.code === 'missing_visit' && flag.open_visit_id ? (
            <>
              <Input aria-label="Minutes on site" className="h-8 w-20" type="number" min={1} max={720} step={1} value={qty} onChange={(e) => setQty(e.target.value)} data-testid="finish-minutes" />
              <span className="text-xs">min on site</span>
              <Button size="sm" variant="outline" disabled={busy || !(Number.isInteger(Number(qty)) && Number(qty) >= 1 && Number(qty) <= 720)} data-testid="fix-finish" onClick={() => onFix({ action: 'finish', visit_id: flag.open_visit_id, minutes: Number(qty), services: flag.services ?? ['plow'] })}>Finish visit</Button>
            </>
          ) : null}
          {flag.code === 'missing_visit' ? <Button size="sm" variant="outline" disabled={busy} data-testid="fix-skip" onClick={() => onFix({ action: 'skip', site_id: flag.site_id })}>Mark skipped</Button> : null}
          {flag.code === 'duplicate' && flag.visit_id ? <Button size="sm" variant="outline" disabled={busy} data-testid="fix-replow" onClick={() => onFix({ action: 'replow', visit_id: flag.visit_id })}>Mark re-plow</Button> : null}
          {(flag.code === 'missing_salt_qty' || flag.code === 'salt_unit') && flag.visit_id ? (
            <>
              <Input aria-label={`Salt, in ${SALT_UNIT[flag.unit ?? 'bag50lb'] ?? flag.unit}`} className="h-8 w-20" type="number" min={0.1} step="any" value={qty} onChange={(e) => setQty(e.target.value)} data-testid="salt-qty" />
              <span className="text-xs">{SALT_UNIT[flag.unit ?? 'bag50lb'] ?? flag.unit}</span>
              <Button size="sm" variant="outline" disabled={busy || !(Number(qty) > 0)} data-testid="fix-salt" onClick={() => onFix({ action: 'salt', visit_id: flag.visit_id, unit: flag.unit ?? 'bag50lb', qty: Number(qty) })}>Set salt</Button>
            </>
          ) : null}
          {flag.code === 'no_service' && flag.visit_id && flag.services?.length ? (
            <Button size="sm" variant="outline" disabled={busy} data-testid="fix-services" onClick={() => onFix({ action: 'services', visit_id: flag.visit_id, services: flag.services })}>Bill {flag.services.join(' and ')} for it</Button>
          ) : null}
          {flag.code === 'missing_depth' ? (
            <>
              <Input aria-label="Snow depth in inches" className="h-8 w-20" type="number" min={0} step={0.5} value={qty} onChange={(e) => setQty(e.target.value)} data-testid="depth-in" />
              <Button size="sm" variant="outline" disabled={busy || qty === ''} data-testid="fix-depth" onClick={() => onFix({ action: 'depth', site_id: flag.site_id, depth_in: Number(qty) })}>Set depth</Button>
            </>
          ) : null}
          {flag.code === 'below_trigger' ? (
            <>
              <Button size="sm" variant="outline" disabled={busy} data-testid="fix-bill-anyway" onClick={() => onFix({ action: 'waive', flag_key: flagKey(flag) })}>Bill it anyway</Button>
              <Button size="sm" variant="outline" disabled={busy} data-testid="fix-no-bill" onClick={() => onFix({ action: 'waive', flag_key: noBillKey(flag.site_id) })}>Don&apos;t bill</Button>
            </>
          ) : null}
          {/* Waiving a missing depth would bill a per-inch lot $0, so that one needs a depth instead. */}
          {flag.code !== 'missing_depth' && flag.code !== 'below_trigger' ? <Button size="sm" variant="ghost" disabled={busy} data-testid="fix-waive" onClick={() => onFix({ action: 'waive', flag_key: flagKey(flag) })}>Waive</Button> : null}
        </div>
      ) : null}
    </li>
  );
}
