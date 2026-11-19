import { asc, customer, eq, site } from '@flake/db';
import { PageHeader } from '@flake/ui';
import { asUser, requirePage } from '@/lib/auth';
import { complianceOverview } from '@/lib/compliance';
import { CompliancePanel } from './compliance-panel';

export const metadata = { title: 'Insurance and claims' };

/** Certificates of insurance, each sub's cover, and claims (issue 165). Nothing here is sent anywhere by itself. */
export default async function Compliance() {
  const ctx = await requirePage();
  const data = await asUser(ctx, async (tx) => ({
    o: await complianceOverview(tx, ctx.tenant.timezone),
    sites: await tx.select({ id: site.id, label: site.label, customer: customer.name }).from(site).innerJoin(customer, eq(customer.id, site.customer_id)).orderBy(asc(site.label)),
  }));
  return (
    <>
      <PageHeader title="Insurance and claims" subtitle="Your certificates to hand customers, each sub's cover, and claims on your lots." />
      <CompliancePanel data={JSON.parse(JSON.stringify(data.o))} sites={data.sites} tz={ctx.tenant.timezone} readOnly={ctx.role === 'viewer'} />
    </>
  );
}
