import { FREE_SITE_LIMIT, proFeaturesEnabled } from '@flake/core/fees';
import { todayIn } from '@flake/core/time';
import { and, customer, eq, inArray, route_stop, run_stop, site, sql, storm, storm_run, tenant, type Tx } from '@flake/db';
import { HttpError } from './http';

/** The free plan's site cap, for every way a site is added. Two saved at once can't both take the last place. */
export async function requireSiteRoom(tx: Tx, tenantId: string) {
  const [t] = await tx.select().from(tenant).where(eq(tenant.id, tenantId));
  if (proFeaturesEnabled(t!.plan, t!.free_season_until, todayIn(t!.timezone))) return;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`sites:${tenantId}`}))`);
  const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(site).where(eq(site.active, true));
  if (n >= FREE_SITE_LIMIT) throw new HttpError(402, `The free plan covers ${FREE_SITE_LIMIT} sites. Upgrade to Pro for more.`, 'site_limit');
}

/** An archived customer's lots are retired with them, so none is added or brought back until the customer is restored. */
export async function requireLiveCustomer(tx: Tx, customerId: string) {
  const [c] = await tx.select({ archived_at: customer.archived_at }).from(customer).where(eq(customer.id, customerId));
  if (c?.archived_at) throw new HttpError(409, 'This customer is archived. Restore them first.', 'customer_archived');
}

/**
 * A retired lot leaves its routes, and its unfinished stops on a running storm are skipped, so no truck is sent
 * there. Visits already done stay on file.
 */
export async function takeSitesOffWork(tx: Tx, siteIds: string[]) {
  if (!siteIds.length) return;
  await tx.delete(route_stop).where(inArray(route_stop.site_id, siteIds));
  const live = await tx.select({ id: storm_run.id }).from(storm_run).innerJoin(storm, eq(storm.id, storm_run.storm_id)).where(eq(storm.status, 'active'));
  if (!live.length) return;
  await tx.update(run_stop).set({ status: 'skipped', updated_at: new Date().toISOString() })
    .where(and(inArray(run_stop.site_id, siteIds), inArray(run_stop.storm_run_id, live.map((r) => r.id)), inArray(run_stop.status, ['open', 'enroute', 'problem'])));
}
