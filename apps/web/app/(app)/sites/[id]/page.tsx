import { contract, customer, desc, eq, site, site_pin } from '@flake/db';
import { Badge, buttonVariants, Card, PageHeader } from '@flake/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { asUser, requirePage } from '@/lib/auth';
import { isUuid } from '@/lib/http';
import { getProviders } from '@/lib/providers';
import { contractPdfUrl } from '@/lib/quotes';
import { SiteEditor } from './site-editor';

export const metadata = { title: 'Site' };

export default async function SitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requirePage();
  const data = await asUser(ctx, async (tx) => {
    const [s] = await tx.select().from(site).where(eq(site.id, id));
    if (!s) return null;
    const [c] = await tx.select().from(customer).where(eq(customer.id, s.customer_id));
    return { s, c: c!, pins: await tx.select().from(site_pin).where(eq(site_pin.site_id, id)), contracts: await tx.select().from(contract).where(eq(contract.site_id, id)).orderBy(desc(contract.created_at)) };
  });
  if (!data) notFound();
  const { s, c, pins, contracts } = data;
  const { tiles } = await getProviders();
  const pdf = contracts[0]?.pdf_path ? await contractPdfUrl(ctx.tenantId, contracts[0].pdf_path) : null;
  return (
    <>
      <PageHeader title={s.label} subtitle={<>{s.address}. Customer: <Link className="underline" href={`/customers/${c.id}`}>{c.name}</Link></>} actions={<Link className={buttonVariants({ variant: 'outline' })} href={`/proof?site=${s.id}`}>Proof packet</Link>} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2"><SiteEditor site={JSON.parse(JSON.stringify(s))} pins={JSON.parse(JSON.stringify(pins))} layers={tiles.layers()} /></div>
        <Card>
          <h2 className="font-semibold">Contracts</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {contracts.map((k) => (
              <li key={k.id}>
                <Badge tone={k.status === 'accepted' ? 'green' : 'amber'}>{k.status}</Badge> {k.season}
                {k.accepted_name ? <div className="text-slate-600">Signed by {k.accepted_name}</div> : null}
              </li>
            ))}
            {!contracts.length ? <li className="text-slate-600">None.</li> : null}
          </ul>
          {pdf ? <a className="mt-2 block text-sm text-sky-800 underline" href={pdf}>Signed contract PDF</a> : null}
        </Card>
      </div>
    </>
  );
}
