import { asc, customer, desc, eq, proof_packet, site } from '@flake/db';
import { buttonVariants, EmptyState, PageHeader } from '@flake/ui';
import Link from 'next/link';
import { asUser, requirePage } from '@/lib/auth';
import { ProofForm } from './proof-form';

export const metadata = { title: 'Proof packets' };

export default async function Proof({ searchParams }: { searchParams: Promise<{ site?: string; incident?: string }> }) {
  const { site: preselect, incident } = await searchParams;
  const ctx = await requirePage();
  const data = await asUser(ctx, async (tx) => ({
    sites: await tx.select({ id: site.id, label: site.label, customer: customer.name }).from(site).innerJoin(customer, eq(customer.id, site.customer_id)).orderBy(asc(site.label)),
    packets: await tx.select({ id: proof_packet.id, site_id: proof_packet.site_id, from_ts: proof_packet.from_ts, to_ts: proof_packet.to_ts, manifest_sha256: proof_packet.manifest_sha256, created_at: proof_packet.created_at }).from(proof_packet).orderBy(desc(proof_packet.created_at)).limit(20),
  }));
  return (
    <>
      <PageHeader title="Proof packets" subtitle="Everything an insurer or lawyer asks for, for any site and dates." actions={<Link className={buttonVariants({ variant: 'outline' })} href="/compliance" data-testid="open-compliance">Insurance and claims</Link>} />
      {/* No lots yet: nothing to pick, so say where packets come from (issue 129). */}
      {data.sites.length ? null : <EmptyState title="No lots yet" body="Proof packets list every visit, photo and time for a lot. Add a customer and their lot, and packets are ready once it has visits." action={<Link href="/customers/new" className={buttonVariants({ variant: 'accent' })}>Add a customer</Link>} />}
      {data.sites.length ? <ProofForm sites={data.sites} packets={JSON.parse(JSON.stringify(data.packets))} preselect={preselect} incident={incident && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(incident) ? incident : undefined} tz={ctx.tenant.timezone} /> : null}
    </>
  );
}
