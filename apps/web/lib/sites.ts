import { FREE_SITE_LIMIT, proFeaturesEnabled } from '@flake/core/fees';
import { todayIn } from '@flake/core/time';
import { and, app_setting, asService, contract, customer, eq, inArray, isNull, route, route_stop, run_stop, site, sql, storm, storm_run, tenant, type Tx } from '@flake/db';
import { HttpError } from './http';

/** The free plan's site cap, for every way a site is added. Two saved at once can't both take the last place. */
export async function requireSiteRoom(tx: Tx, tenantId: string, adding = 1) {
  const [t] = await tx.select().from(tenant).where(eq(tenant.id, tenantId));
  if (proFeaturesEnabled(t!.plan, t!.free_season_until, todayIn(t!.timezone))) return;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`sites:${tenantId}`}))`);
  const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(site).where(eq(site.active, true));
  if (n + adding > FREE_SITE_LIMIT) throw new HttpError(402, `The free plan covers ${FREE_SITE_LIMIT} sites. Upgrade to Pro for more.`, 'site_limit');
}

/** An archived customer's lots are retired with them, so none is added or brought back until the customer is restored. */
export async function requireLiveCustomer(tx: Tx, customerId: string) {
  const [c] = await tx.select({ archived_at: customer.archived_at }).from(customer).where(eq(customer.id, customerId));
  if (c?.archived_at) throw new HttpError(409, 'This customer is archived. Restore them first.', 'customer_archived');
}

const retiredKey = (customerId: string) => `retired_with:${customerId}`;
const routesKey = (siteId: string) => `retired_routes:${siteId}`;

/** A restored lot goes back on the end of each route it was on when it was retired, if that route is still in use. */
export async function restoreRoutes(tx: Tx, tenantId: string, siteIds: string[]) {
  for (const id of siteIds) {
    const [saved] = await asService(tx, tenantId, () => tx.select().from(app_setting).where(eq(app_setting.key, routesKey(id))));
    if (!saved) continue;
    const routeIds = ((saved.value as { routes?: string[] }).routes ?? []);
    const live = routeIds.length ? await tx.select({ id: route.id }).from(route).where(and(inArray(route.id, routeIds), isNull(route.archived_at))) : [];
    for (const r of live) {
      const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`coalesce(max(${route_stop.seq}), 0)::int` }).from(route_stop).where(eq(route_stop.route_id, r.id));
      await tx.insert(route_stop).values({ route_id: r.id, site_id: id, seq: n + 1, tenant_id: tenantId }).onConflictDoNothing();
    }
    await asService(tx, tenantId, () => tx.delete(app_setting).where(eq(app_setting.key, routesKey(id))));
  }
}

/** Archiving a customer retires their live lots, and remembers which, so restoring brings back only those (issue 150). */
export async function retireWithCustomer(tx: Tx, tenantId: string, customerId: string) {
  const lots = await tx.update(site).set({ active: false }).where(and(eq(site.customer_id, customerId), eq(site.active, true))).returning({ id: site.id });
  const ids = lots.map((l) => l.id);
  // Saving an already-archived customer again retires nothing, and must not forget the lots the first archive took.
  await asService(tx, tenantId, () => tx.insert(app_setting).values({ key: retiredKey(customerId), value: { ids } })
    .onConflictDoUpdate({ target: app_setting.key, set: { value: { ids } }, where: ids.length ? undefined : sql`false` }));
  await takeSitesOffWork(tx, ids);
}

/**
 * Restoring a customer brings back the lots archiving retired. A lot the office had retired on its own before stays
 * retired. Customers archived before this was recorded get every lot back, since archiving retired them all. The free
 * plan's cap still applies.
 */
export async function restoreWithCustomer(tx: Tx, tenantId: string, customerId: string) {
  const [saved] = await asService(tx, tenantId, () => tx.select().from(app_setting).where(eq(app_setting.key, retiredKey(customerId))));
  const ids = (saved?.value as { ids?: string[] } | undefined)?.ids;
  const lots = await tx.select({ id: site.id }).from(site).where(and(eq(site.customer_id, customerId), eq(site.active, false), ids ? inArray(site.id, ids.length ? ids : ['00000000-0000-0000-0000-000000000000']) : undefined));
  if (lots.length) {
    await requireSiteRoom(tx, tenantId, lots.length);
    await tx.update(site).set({ active: true }).where(inArray(site.id, lots.map((l) => l.id)));
    await restoreRoutes(tx, tenantId, lots.map((l) => l.id));
  }
  if (saved) await asService(tx, tenantId, () => tx.delete(app_setting).where(eq(app_setting.key, retiredKey(customerId))));
  return lots.length;
}

/**
 * A retired lot leaves its routes, and its unfinished stops on a running storm are skipped, so no truck is sent
 * there. Visits already done stay on file.
 */
export async function takeSitesOffWork(tx: Tx, siteIds: string[]) {
  if (!siteIds.length) return;
  // Which routes each lot was on, so restoring it puts it back (issue 152) instead of leaving it on none.
  const stops = await tx.select().from(route_stop).where(inArray(route_stop.site_id, siteIds));
  for (const id of new Set(stops.map((x) => x.site_id))) {
    const mine = stops.filter((x) => x.site_id === id);
    const value = { routes: mine.map((x) => x.route_id) };
    await asService(tx, mine[0]!.tenant_id, () => tx.insert(app_setting).values({ key: routesKey(id), value }).onConflictDoUpdate({ target: app_setting.key, set: { value } }));
  }
  await tx.delete(route_stop).where(inArray(route_stop.site_id, siteIds));
  // A quote nobody has signed is withdrawn with the lot, so a retired lot can't pick up a signed contract later.
  await tx.update(contract).set({ status: 'void' }).where(and(inArray(contract.site_id, siteIds), inArray(contract.status, ['draft', 'sent'])));
  const live = await tx.select({ id: storm_run.id }).from(storm_run).innerJoin(storm, eq(storm.id, storm_run.storm_id)).where(eq(storm.status, 'active'));
  if (!live.length) return;
  await tx.update(run_stop).set({ status: 'skipped', updated_at: new Date().toISOString() })
    .where(and(inArray(run_stop.site_id, siteIds), inArray(run_stop.storm_run_id, live.map((r) => r.id)), inArray(run_stop.status, ['open', 'enroute', 'problem'])));
}
