import { asc, customer, desc, eq, proof_packet, site } from '@flake/db';
import { PageHeader } from '@flake/ui';
import { asUser, requirePage } from '@/lib/auth';
import { ProofForm } from './proof-form';

export const metadata = { title: 'Proof packets' };

export default async function Proof({ searchParams }: { searchParams: Promise<{ site?: string }> }) {
  const { site: preselect } = await searchParams;
  const ctx = await requirePage();
  const data = await asUser(ctx, async (tx) => ({
    sites: await tx.select({ id: site.id, label: site.label, customer: customer.name }).from(site).innerJoin(customer, eq(customer.id, site.customer_id)).orderBy(asc(site.label)),
    packets: await tx.select({ id: proof_packet.id, site_id: proof_packet.site_id, from_ts: proof_packet.from_ts, to_ts: proof_packet.to_ts, manifest_sha256: proof_packet.manifest_sha256, created_at: proof_packet.created_at }).from(proof_packet).orderBy(desc(proof_packet.created_at)).limit(20),
  }));
  return (
    <>
      <PageHeader title="Proof packets" subtitle="Everything an insurer or lawyer asks for, for any site and dates." />
      <ProofForm sites={data.sites} packets={JSON.parse(JSON.stringify(data.packets))} preselect={preselect} tz={ctx.tenant.timezone} />
    </>
  );
}
