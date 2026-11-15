import { customer, desc, eq, invoice_draft, storm } from '@flake/db';
import { estimateStripeFeeCents } from '@flake/core/fees';
import { stormWhen } from '@flake/core/time';
import { EmptyState, PageHeader } from '@flake/ui';
import { asUser, requirePage } from '@/lib/auth';
import { tenantFeeRate, tenantHasPro, visitsMissedByDrafts, visitsUndoneOnBills } from '@/lib/billing';
import { isUuid } from '@/lib/http';
import { notFound } from 'next/navigation';
import { BillingReview, type DraftRow } from './billing-review';
import { StormPicker } from './storm-picker';

export const metadata = { title: 'Billing' };

const stripeMethod = (mode: string) => (mode === 'ach_on_file' ? 'ach' : mode === 'invoice_net30' ? 'invoice_ach' : 'card') as 'ach' | 'invoice_ach' | 'card';

export default async function Billing({ searchParams }: { searchParams: Promise<{ storm?: string }> }) {
  const { storm: stormParam } = await searchParams;
  if (stormParam && !isUuid(stormParam)) notFound();
  const ctx = await requirePage();
  const tz = ctx.tenant.timezone;
  const data = await asUser(ctx, async (tx) => {
    const storms = await tx.select({ id: storm.id, name: storm.name, status: storm.status, started_at: storm.started_at }).from(storm).orderBy(desc(storm.started_at));
    // An unknown or deleted storm in the link (issue 145): say so, and show the newest storm instead of "No storms yet".
    const [asked] = stormParam && isUuid(stormParam) ? await tx.select().from(storm).where(eq(storm.id, stormParam)) : [];
    const [selected] = asked ? [asked] : await tx.select().from(storm).orderBy(desc(storm.started_at)).limit(1);
    const missing = Boolean(stormParam) && !asked;
    const drafts = selected ? await tx.select({ draft: invoice_draft, customer }).from(invoice_draft).innerJoin(customer, eq(customer.id, invoice_draft.customer_id)).where(eq(invoice_draft.storm_id, selected.id)) : [];
    return { storms, selected, drafts, missing };
  });
  if (!data.selected) return <><PageHeader title="Billing" /><EmptyState title="No storms yet" body="After a storm closes, its invoices are drafted here." /></>;
  const missed = await visitsMissedByDrafts(ctx, data.selected.id);
  const undone = await visitsUndoneOnBills(ctx, data.selected.id);
  const owner = ctx.role === 'owner';
  const rows: DraftRow[] = data.drafts.map(({ draft: d, customer: c }) => ({
    id: d.id, customer: c.name, billing_mode: c.billing_mode, status: d.status!, status_detail: d.status_detail, subtotal_cents: d.subtotal_cents, lines: d.lines as any[], flags: d.flags as any[], // A manual bill never goes through Stripe, so neither fee applies to it.
    fee_cents: owner && c.billing_mode !== 'manual' ? d.application_fee_cents ?? 0 : 0, stripe_fee_cents: owner && c.billing_mode !== 'manual' ? estimateStripeFeeCents(d.subtotal_cents, stripeMethod(c.billing_mode)) : 0, pay_link: d.pay_link, disputed: d.disputed,
  }));
  return (
    <>
      <PageHeader title="Billing review" subtitle={`${data.selected.name}, ${stormWhen(data.selected.started_at, tz)}.${owner ? ` Your fee rate: ${(tenantFeeRate(ctx.tenant) * 100).toFixed(1)}%.` : ''}`} />
      {data.missing ? <p className="mb-4 rounded-md bg-warn-tint p-3 text-sm text-warn-ink" data-testid="storm-not-found">That storm wasn't found. It may have been deleted. Showing the newest storm instead.</p> : null}
      <StormPicker storms={data.storms.map((s) => ({ id: s.id, name: `${s.name}, ${stormWhen(s.started_at, tz, false)}`, status: s.status ?? 'billed' }))} selected={data.selected.id} />
      {missed.length ? (
        <p className="mb-4 rounded-md bg-warn-tint p-3 text-sm text-warn-ink" data-testid="missed-visits">
          {missed.length} visit{missed.length === 1 ? '' : 's'} synced after these drafts were made and {missed.length === 1 ? 'is' : 'are'} on no invoice: {[...new Set(missed.map((m) => m.site))].join(', ')}.{' '}
          {missed.some((m) => m.in_review) ? 'Regenerate drafts to pick up the ones still in review. ' : ''}
          {missed.some((m) => !m.in_review) ? 'Any invoice already approved stays as it was, so bill those separately.' : ''}
        </p>
      ) : null}
      {undone.length ? (
        <p className="mb-4 rounded-md bg-warn-tint p-3 text-sm text-warn-ink" data-testid="undone-visits">
          Work changed after {undone.length === 1 ? 'this bill was' : 'these bills were'} approved: the visit at {[...new Set(undone.map((u) => u.site))].join(', ')} was undone or voided, but the approved bill still charges for it. Credit or refund the customer for it.
        </p>
      ) : null}
      <BillingReview readOnly={ctx.role === 'viewer'} stormId={data.selected.id} initial={rows} canExport={tenantHasPro(ctx.tenant)} showFees={owner} stormActive={data.selected.status === 'active' && !rows.length} nothingToBill={data.selected.status === 'billed' && !rows.length} stripeReady={Boolean(ctx.tenant.stripe_account_id && ctx.tenant.stripe_charges_enabled)} />
    </>
  );
}
