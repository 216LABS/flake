import { cityOf } from '@flake/core/address';
import { and, asc, contract, customer, eq, isNull, route, route_stop, site, type Tx } from '@flake/db';

/** One lot as the lot picker shows it (issue 193). */
export interface LotOption {
  id: string;
  label: string;
  address: string;
  customer: string;
  city: string;
  lat: number;
  lon: number;
  priority: number;
  routes: string[];
  contracted: boolean;
}


/** Every active lot with what a picker filters by: its customer, city, routes and whether a contract is signed. */
export async function lotOptions(tx: Tx, opts: { retired?: boolean } = {}): Promise<LotOption[]> {
  const rows = await tx.select({ id: site.id, label: site.label, address: site.address, lat: site.lat, lon: site.lon, priority: site.priority, customer: customer.name })
    .from(site).innerJoin(customer, eq(customer.id, site.customer_id)).where(opts.retired ? undefined : eq(site.active, true)).orderBy(asc(site.label));
  const onRoutes = await tx.select({ site_id: route_stop.site_id, name: route.name }).from(route_stop).innerJoin(route, eq(route.id, route_stop.route_id)).where(isNull(route.archived_at));
  const signed = new Set((await tx.selectDistinct({ site_id: contract.site_id }).from(contract).where(and(eq(contract.status, 'accepted')))).map((r) => r.site_id));
  return rows.map((r) => ({
    ...r,
    priority: r.priority ?? 3,
    city: cityOf(r.address),
    routes: onRoutes.filter((x) => x.site_id === r.id).map((x) => x.name),
    contracted: signed.has(r.id),
  }));
}
