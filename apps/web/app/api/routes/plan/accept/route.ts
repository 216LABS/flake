import { and, asc, eq, inArray, isNull, route as routeTable, route_stop, site } from '@flake/db';
import { z } from 'zod';
import { asUser, requireApi } from '@/lib/auth';
import { HttpError, parseJson, route } from '@/lib/http';

const body = z.object({
  routes: z.array(z.object({
    id: z.uuid(),
    site_ids: z.array(z.uuid()).max(300),
    /** The stops the plan was made from. A route edited since then isn't overwritten. */
    before: z.array(z.uuid()).max(300),
  })).min(1).max(20),
});

/** Saves a Plan all routes result (issue 68): every route's new stops at once, or none of them. */
export const POST = route(async (req) => {
  const ctx = await requireApi('dispatcher');
  const { routes } = await parseJson(req, body);
  const ids = routes.map((r) => r.id);
  if (new Set(ids).size !== ids.length) throw new HttpError(400, 'A route is listed twice.');
  const all = routes.flatMap((r) => r.site_ids);
  if (new Set(all).size !== all.length) throw new HttpError(400, 'A lot is on two routes in this plan.');
  return asUser(ctx, async (tx) => {
    const rows = await tx.select({ id: routeTable.id }).from(routeTable).where(and(inArray(routeTable.id, ids), isNull(routeTable.archived_at))).for('update');
    if (rows.length !== ids.length) throw new HttpError(404, 'One of those routes is gone or archived. Plan again.');
    const stops = await tx.select({ route_id: route_stop.route_id, site_id: route_stop.site_id }).from(route_stop).where(inArray(route_stop.route_id, ids)).orderBy(asc(route_stop.seq));
    for (const r of routes) {
      const now = stops.filter((s) => s.route_id === r.id).map((s) => s.site_id);
      if (now.join() !== r.before.join()) throw new HttpError(409, 'A route changed after this plan was made. Plan again so nothing is undone.', 'stale_plan');
    }
    if (all.length) {
      const live = await tx.select({ id: site.id }).from(site).where(and(inArray(site.id, all), eq(site.active, true)));
      if (live.length !== all.length) throw new HttpError(409, 'A lot in this plan was retired or removed. Plan again.', 'stale_plan');
    }
    await tx.delete(route_stop).where(inArray(route_stop.route_id, ids));
    const values = routes.flatMap((r) => r.site_ids.map((site_id, i) => ({ route_id: r.id, site_id, seq: i + 1, tenant_id: ctx.tenantId })));
    if (values.length) await tx.insert(route_stop).values(values);
    return { saved: routes.length, stops: values.length };
  });
});
