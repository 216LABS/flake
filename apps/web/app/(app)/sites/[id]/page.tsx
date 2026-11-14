import { quotingSeason } from '@flake/core/time';
import { contract, customer, desc, eq, site, site_pin } from '@flake/db';
import { Badge, buttonVariants, PageHeader } from '@flake/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { asUser, requirePage } from '@/lib/auth';
import { isUuid } from '@/lib/http';
import { getProviders } from '@/lib/providers';
import { contractPdfUrl, quoteUrl } from '@/lib/quotes';
import { ContractList, NewQuote, RetireSite } from './site-actions';
import { SiteEditor } from './site-editor';

/** Snow seasons cross the new year: November 2026 and February 2027 are both 2026-27. */
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
  const signed = contracts.find((k) => k.status === 'accepted' && k.pdf_path);
  const pdf = signed?.pdf_path ? await contractPdfUrl(ctx.tenantId, signed.pdf_path) : null;
  const canEdit = ctx.role !== 'viewer';
  return (
    <>
      <PageHeader title={<>{s.label}{s.active ? null : <Badge className="ml-2 align-middle" data-testid="retired-badge">retired</Badge>}</>} subtitle={<>{s.address}. Customer: <Link className="underline" href={`/customers/${c.id}`}>{c.name}</Link></>} actions={<Link className={buttonVariants({ variant: 'outline' })} href={`/proof?site=${s.id}`}>Proof packet</Link>} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2"><SiteEditor site={JSON.parse(JSON.stringify(s))} pins={JSON.parse(JSON.stringify(pins))} layers={tiles.layers()} /><RetireSite siteId={s.id} customerId={c.id} active={Boolean(s.active)} canEdit={canEdit} /></div>
        <div className="space-y-4">
        <ContractList contracts={JSON.parse(JSON.stringify(contracts.map((k) => ({ id: k.id, status: k.status, season: k.season, services: k.services, salt_pricing: k.salt_pricing, accepted_name: k.accepted_name, accepted_at: k.accepted_at, created_at: k.created_at, installments_billed: k.installments_billed, quote_url: quoteUrl(k), decline_reason: k.decline_reason }))))} canEdit={canEdit} pdf={pdf} />
        {/* A retired lot can't be quoted; restore it first. */}
        {s.active && canEdit ? <NewQuote siteId={s.id} defaultSeason={quotingSeason(new Date(), ctx.tenant.timezone)} saltCents={((ctx.tenant.rate_card as { salt_bag_cents?: number }).salt_bag_cents) ?? 1800} signedSeasons={contracts.filter((k) => k.status === 'accepted').map((k) => k.season)} /> : null}
        </div>
      </div>
    </>
  );
}
