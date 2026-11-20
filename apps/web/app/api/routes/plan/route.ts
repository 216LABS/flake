import { planFleet } from '@flake/core/fleet';
import type { RouteSite } from '@flake/core/routing';
import { and, asc, eq, inArray, isNull, route as routeTable, route_stop, site } from '@flake/db';
import { z } from 'zod';
import { asUser, requireApi } from '@/lib/auth';
import { HttpError, parseJson, route } from '@/lib/http';
import { roadTimes } from '@/lib/road-times';

export const maxDuration = 30;

const body = z.object({
  route_ids: z.array(z.uuid()).min(1).max(20),
  include_unrouted: z.boolean().default(false),
  start: z.string().regex(/^\d{2}:\d{2}$/).default('04:00'),
  // Issue 194: keep my routes (default), add lots on no route only, or start fresh.
  mode: z.enum(['keep', 'add_only', 'fresh']).default('keep'),
});

/**
 * Plan all routes (issue 68): splits the lots on these routes (and, if asked, lots on no route) across them, one truck
 * each. Nothing is saved: the dispatcher reads the plan and accepts it with POST /api/routes/plan/accept.
 */
export const POST = route(async (req) => {
  const ctx = await requireApi('dispatcher');
  const { route_ids, include_unrouted, start, mode } = await parseJson(req, body);
  const ids = [...new Set(route_ids)];
  const data = await asUser(ctx, async (tx) => {
    const routes = await tx.select({ id: routeTable.id, name: routeTable.name, yard_trip: routeTable.yard_trip }).from(routeTable).where(and(inArray(routeTable.id, ids), isNull(routeTable.archived_at)));
    if (routes.length !== ids.length) throw new HttpError(404, 'One of those routes is gone or archived. Reload and try again.');
    const stops = await tx.select({ route_id: route_stop.route_id, site_id: route_stop.site_id }).from(route_stop).where(inArray(route_stop.route_id, ids)).orderBy(asc(route_stop.seq));
    let loose: string[] = [];
    if (include_unrouted) {
      const onAny = await tx.selectDistinct({ site_id: route_stop.site_id }).from(route_stop).innerJoin(routeTable, eq(routeTable.id, route_stop.route_id)).where(isNull(routeTable.archived_at));
      const taken = new Set(onAny.map((r) => r.site_id));
      loose = (await tx.select({ id: site.id }).from(site).where(eq(site.active, true))).map((s) => s.id).filter((id) => !taken.has(id));
    }
    const want = [...new Set([...stops.map((s) => s.site_id), ...loose])];
    const sites = want.length
      ? await tx.select({ id: site.id, label: site.label, lat: site.lat, lon: site.lon, priority: site.priority, service_window: site.service_window, estimate: site.area_estimate_sqft, confirmed: site.area_confirmed_sqft }).from(site).where(and(inArray(site.id, want), eq(site.active, true)))
      : [];
    return { routes, stops, sites, loose: loose.length };
  });
  if (data.sites.length > 300) throw new HttpError(422, `That's ${data.sites.length} lots. Plan up to 300 at a time: pick fewer routes.`, 'too_many');
  const lots: RouteSite[] = data.sites.map((s) => ({ id: s.id, lat: s.lat, lon: s.lon, priority: s.priority, open_by: s.service_window?.open_by ?? null, not_before: s.service_window?.not_before ?? null, sqft: s.confirmed ?? s.estimate }));
  const ordered = ids.map((id) => data.routes.find((r) => r.id === id)!);
  const yard = ctx.tenant.yard ? { lat: ctx.tenant.yard.lat, lon: ctx.tenant.yard.lon } : null;
  const road = await roadTimes([...lots, ...(yard ? [yard] : [])]);
  const plan = lots.length
    ? planFleet(lots, ordered.map((r) => ({ id: r.id, yard_trip: r.yard_trip, current: data.stops.filter((s) => s.route_id === r.id).map((s) => s.site_id) })), { start, yard, legMinutes: road.legMinutes, budgetMs: 6000, mode })
    : null;
  return {
    plan,
    routes: ordered.map((r) => ({ id: r.id, name: r.name, yard_trip: r.yard_trip, before: data.stops.filter((s) => s.route_id === r.id).map((s) => s.site_id) })),
    labels: Object.fromEntries(data.sites.map((s) => [s.id, s.label])),
    // For the map of the plan (issue 191).
    points: Object.fromEntries(data.sites.map((s) => [s.id, { lat: s.lat, lon: s.lon }])),
    times_estimated: road.source === 'estimate',
    unrouted: data.loose,
    yard: Boolean(yard),
    times_label: road.label,
  };
});
