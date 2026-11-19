import { quotingSeason } from '@flake/core/time';
import { asc, customer, eq, isNull, site } from '@flake/db';
import { PageHeader } from '@flake/ui';
import { asUser, requirePage } from '@/lib/auth';
import { bidList, renewalQueue } from '@/lib/bids';
import { BidsPanel } from './bids-panel';

export const metadata = { title: 'Bids and renewals' };

/** Bids from lead to won or lost, and last season's contracts waiting to be renewed (issue 166). */
export default async function Bids() {
  const ctx = await requirePage();
  const tz = ctx.tenant.timezone;
  const data = await asUser(ctx, async (tx) => ({
    bids: await bidList(tx, tz),
    renewals: await renewalQueue(tx, tz),
    customers: await tx.select({ id: customer.id, name: customer.name }).from(customer).where(isNull(customer.archived_at)).orderBy(asc(customer.name)),
    sites: await tx.select({ id: site.id, label: site.label, customer_id: site.customer_id }).from(site).where(eq(site.active, true)).orderBy(asc(site.label)),
  }));
  return (
    <>
      <PageHeader title="Bids and renewals" subtitle="Track a bid from first call to signed, and renew this winter's contracts for next winter." />
      <BidsPanel data={JSON.parse(JSON.stringify(data))} season={quotingSeason(new Date(), tz)} readOnly={ctx.role === 'viewer'} />
    </>
  );
}
