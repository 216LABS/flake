import { customer, desc, eq, invoice_draft, sql, storm } from '@flake/db';
import { estimateStripeFeeCents, inFreeSeason } from '@flake/core/fees';
import { localDay } from '@flake/core/receivables';
import { stormWhen } from '@flake/core/time';
import { buttonVariants, EmptyState, PageHeader } from '@flake/ui';
import Link from 'next/link';
import { available } from '@/lib/providers';
import { asUser, requirePage } from '@/lib/auth';
import { tenantFeeRate, tenantHasPro, visitsMissedByDrafts, visitsUndoneOnBills } from '@/lib/billing';
import { isUuid } from '@/lib/http';
import { notFound } from 'next/navigation';
import { BillingReview, type DraftRow } from './billing-review';
import { StormList } from './storm-list';
import { BillingExplainer } from './billing-explainer';

export const metadata = { title: 'Billing' };

const stripeMethod = (mode: string) => (mode === 'ach_on_file' ? 'ach' : mode === 'invoice_net30' ? 'invoice_ach' : 'card') as 'ach' | 'invoice_ach' | 'card';

export default async function Billing({ searchParams }: { searchParams: Promise<{ storm?: string }> }) {
  const { storm: stormParam } = await searchParams;
  if (stormParam && !isUuid(stormParam)) notFound();
  const ctx = await requirePage();
  const payAvailable = (await available()).payments;
  const tz = ctx.tenant.timezone;
  const data = await asUser(ctx, async (tx) => {
    const storms = await tx.select({ id: storm.id, name: storm.name, status: storm.status, started_at: storm.started_at }).from(storm).orderBy(desc(storm.started_at));
    // What each storm has waiting, for the list (issue 195).
    const counts = await tx.select({ storm_id: invoice_draft.storm_id, review: sql<number>`(count(*) filter (where ${invoice_draft.status} = 'draft'))::int`, waiting: sql<number>`coalesce(sum(${invoice_draft.subtotal_cents}) filter (where ${invoice_draft.status} = 'draft'), 0)::int`, bills: sql<number>`(count(*) filter (where ${invoice_draft.status} <> 'void'))::int` })
      .from(invoice_draft).groupBy(invoice_draft.storm_id);
    // An unknown or deleted storm in the link (issue 145): say so, and show another storm instead of "No storms yet".
    const [asked] = stormParam && isUuid(stormParam) ? await tx.select().from(storm).where(eq(storm.id, stormParam)) : [];
    // With nothing asked for: the oldest storm with bills to review, then the newest closed one, never a live storm with
    // nothing in it if there's anything else (issue 195).
    const byId = new Map(counts.map((c) => [c.storm_id, c]));
    const oldestFirst = [...storms].reverse();
    const pick = oldestFirst.find((s) => (byId.get(s.id)?.review ?? 0) > 0) ?? storms.find((s) => s.status === 'closed') ?? storms.find((s) => s.status !== 'active') ?? storms[0];
    const [selected] = asked ? [asked] : pick ? await tx.select().from(storm).where(eq(storm.id, pick.id)) : [];
    const missing = Boolean(stormParam) && !asked;
    const drafts = selected ? await tx.select({ draft: invoice_draft, customer }).from(invoice_draft).innerJoin(customer, eq(customer.id, invoice_draft.customer_id)).where(eq(invoice_draft.storm_id, selected.id)) : [];
    return { storms, selected, drafts, missing, counts: byId };
  });
  if (!data.selected) return <><PageHeader title="Billing" /><EmptyState title="No storms yet" body="After a storm closes, its invoices are drafted here." /></>;
  const missed = await visitsMissedByDrafts(ctx, data.selected.id);
  const undone = await visitsUndoneOnBills(ctx, data.selected.id);
  const owner = ctx.role === 'owner';
  const rows: DraftRow[] = data.drafts.map(({ draft: d, customer: c }) => ({
    id: d.id, customer: c.name, customer_id: c.id, has_payment_method: Boolean(c.stripe_payment_method_id), has_email: Boolean(c.email), billing_mode: c.billing_mode, status: d.status!, status_detail: d.status_detail, subtotal_cents: d.subtotal_cents, lines: d.lines as any[], flags: d.flags as any[], // A manual bill never goes through Stripe, so neither fee applies to it.
    fee_cents: owner && c.billing_mode !== 'manual' ? d.application_fee_cents ?? 0 : 0, stripe_fee_cents: owner && c.billing_mode !== 'manual' ? estimateStripeFeeCents(d.subtotal_cents, stripeMethod(c.billing_mode)) : 0, pay_link: d.pay_link, disputed: d.disputed,
  }));
  return (
    <>
      {/* No rate in the header during the free season (issues 182, 195): the fee shows on each bill instead. */}
      <PageHeader title="Billing review" subtitle={`${data.selected.name}, ${stormWhen(data.selected.started_at, tz)}.${owner && !inFreeSeason(ctx.tenant.free_season_until, localDay(new Date(), tz)) ? ` Your fee rate: ${(tenantFeeRate(ctx.tenant) * 100).toFixed(1)}%.` : ''}`} actions={<Link className={buttonVariants({ variant: 'outline' })} href="/receivables" data-testid="billing-receivables">Receivables</Link>} />
      <BillingExplainer stripeReady={Boolean(ctx.tenant.stripe_account_id && ctx.tenant.stripe_charges_enabled)} sending={Boolean(ctx.tenant.outbound_enabled)} />
      {data.missing ? <p className="mb-4 rounded-md bg-warn-tint p-3 text-sm text-warn-ink" data-testid="storm-not-found">That storm wasn't found. It may have been deleted. Showing the newest storm instead.</p> : null}
      <div className="lg:grid lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-6">
      <StormList storms={data.storms.map((s) => ({ id: s.id, name: s.name, when: stormWhen(s.started_at, tz, false), status: s.status ?? 'billed', review: data.counts.get(s.id)?.review ?? 0, waiting_cents: data.counts.get(s.id)?.waiting ?? 0, bills: data.counts.get(s.id)?.bills ?? 0 }))} selected={data.selected.id} />
      <div className="min-w-0">
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
      <BillingReview readOnly={ctx.role === 'viewer'} stormId={data.selected.id} initial={rows} canExport={tenantHasPro(ctx.tenant)} showFees={owner} stormActive={data.selected.status === 'active' && !rows.length} nothingToBill={data.selected.status === 'billed' && !rows.length} stripeReady={Boolean(ctx.tenant.stripe_account_id && ctx.tenant.stripe_charges_enabled)} sending={Boolean(ctx.tenant.outbound_enabled)} paymentsAvailable={payAvailable} />
      </div>
      </div>
    </>
  );
}
