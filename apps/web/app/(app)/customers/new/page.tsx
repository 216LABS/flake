import { asc, route, route_stop } from '@flake/db';
import { DEFAULT_RATE_CARD, type RateCard } from '@flake/core/quote';
import { asUser, requirePage } from '@/lib/auth';
import { getProviders } from '@/lib/providers';
import { Wizard } from './wizard';

export const metadata = { title: 'New customer' };

export default async function NewCustomer() {
  const ctx = await requirePage();
  const { routes, stops } = await asUser(ctx, async (tx) => ({ routes: await tx.select().from(route), stops: await tx.select().from(route_stop).orderBy(asc(route_stop.seq)) }));
  const { tiles } = await getProviders();
  const card = (Object.keys(ctx.tenant.rate_card as object).length ? ctx.tenant.rate_card : DEFAULT_RATE_CARD) as RateCard;
  return <Wizard layers={tiles.layers()} rateCard={card} routes={routes.map((r) => ({ id: r.id, name: r.name, site_ids: stops.filter((s) => s.route_id === r.id).map((s) => s.site_id) }))} />;
}
