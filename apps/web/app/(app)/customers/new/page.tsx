import { asc, customer, eq, isNull, route, route_stop, site } from '@flake/db';
import { DEFAULT_RATE_CARD, type RateCard } from '@flake/core/quote';
import { redirect } from 'next/navigation';
import { asUser, requirePage } from '@/lib/auth';
import { isUuid } from '@/lib/http';
import { getProviders } from '@/lib/providers';
import { Wizard } from './wizard';

export const metadata = { title: 'New customer' };

export default async function NewCustomer({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  const { customer: customerId } = await searchParams;
  const ctx = await requirePage();
  if (ctx.role === 'viewer') redirect('/customers');
  const { routes, stops, others, lots, existing } = await asUser(ctx, async (tx) => ({
    routes: await tx.select().from(route).where(isNull(route.archived_at)),
    stops: await tx.select().from(route_stop).orderBy(asc(route_stop.seq)),
    // Current customers' names, so a second customer with the same name is pointed at the first.
    others: await tx.select({ id: customer.id, name: customer.name }).from(customer).where(isNull(customer.archived_at)),
    // Live lots' addresses, so a second customer for the same address is pointed at the first (issue 146).
    lots: await tx.select({ customer_id: site.customer_id, label: site.label, address: site.address }).from(site).where(eq(site.active, true)),
    existing: customerId && isUuid(customerId) ? (await tx.select().from(customer).where(eq(customer.id, customerId)))[0] : undefined,
  }));
  const { tiles } = await getProviders();
  const card = (Object.keys(ctx.tenant.rate_card as object).length ? ctx.tenant.rate_card : DEFAULT_RATE_CARD) as RateCard;
  return <Wizard others={others} knownLots={lots.map((l) => ({ ...l, customer: others.find((o) => o.id === l.customer_id)?.name ?? '' })).filter((l) => l.customer)} existing={existing ? { id: existing.id, name: existing.name, kind: existing.kind, email: existing.email ?? '' } : undefined} layers={tiles.layers()} rateCard={card} routes={routes.map((r) => ({ id: r.id, name: r.name, site_ids: stops.filter((s) => s.route_id === r.id).map((s) => s.site_id) }))} />;
}
