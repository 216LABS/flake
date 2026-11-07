import { customer, desc, eq, invoice_draft, storm } from '@flake/db';
import { estimateStripeFeeCents } from '@flake/core/fees';
import { fmtLocal } from '@flake/core/time';
import { EmptyState, PageHeader } from '@flake/ui';
import { asUser, requirePage } from '@/lib/auth';
import { tenantFeeRate, tenantHasPro, visitsMissedByDrafts } from '@/lib/billing';
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
    const storms = await tx.select({ id: storm.id, name: storm.name }).from(storm).orderBy(desc(storm.started_at));
    const [selected] = stormParam ? await tx.select().from(storm).where(eq(storm.id, stormParam)) : await tx.select().from(storm).orderBy(desc(storm.started_at)).limit(1);
    const drafts = selected ? await tx.select({ draft: invoice_draft, customer }).from(invoice_draft).innerJoin(customer, eq(customer.id, invoice_draft.customer_id)).where(eq(invoice_draft.storm_id, selected.id)) : [];
    return { storms, selected, drafts };
  });
  if (!data.selected) return <><PageHeader title="Billing" /><EmptyState title="No storms yet" body="After a storm closes, its invoices are drafted here." /></>;
  const missed = await visitsMissedByDrafts(ctx, data.selected.id);
  const rows: DraftRow[] = data.drafts.map(({ draft: d, customer: c }) => ({
    id: d.id, customer: c.name, billing_mode: c.billing_mode, status: d.status!, status_detail: d.status_detail, subtotal_cents: d.subtotal_cents, lines: d.lines as any[], flags: d.flags as any[], fee_cents: d.application_fee_cents ?? 0, stripe_fee_cents: estimateStripeFeeCents(d.subtotal_cents, stripeMethod(c.billing_mode)), pay_link: d.pay_link, disputed: d.disputed,
  }));
  return (
    <>
      <PageHeader title="Billing review" subtitle={`${data.selected.name}, ${fmtLocal(data.selected.started_at, tz)}. Your fee rate: ${(tenantFeeRate(ctx.tenant) * 100).toFixed(1)}%.`} />
      <StormPicker storms={data.storms} selected={data.selected.id} />
      {missed.length ? (
        <p className="mb-4 rounded-md bg-amber-50 p-3 text-sm text-amber-950" data-testid="missed-visits">
          {missed.length} visit{missed.length === 1 ? '' : 's'} synced after these drafts were made and {missed.length === 1 ? 'is' : 'are'} on no invoice: {[...new Set(missed.map((m) => m.site))].join(', ')}.{' '}
          {missed.some((m) => m.in_review) ? 'Regenerate drafts to pick up the ones still in review. ' : ''}
          {missed.some((m) => !m.in_review) ? 'Any invoice already approved stays as it was, so bill those separately.' : ''}
        </p>
      ) : null}
      <BillingReview stormId={data.selected.id} initial={rows} canExport={tenantHasPro(ctx.tenant)} />
    </>
  );
}
