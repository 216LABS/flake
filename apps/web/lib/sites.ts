import { and, customer, eq, inArray, route_stop, run_stop, storm, storm_run, type Tx } from '@flake/db';
import { HttpError } from './http';

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
