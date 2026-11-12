import { compareRoute, type RouteSite } from '@flake/core/routing';
import { eq, inArray, route as routeTable, site } from '@flake/db';
import { z } from 'zod';
import { asUser, requireApi } from '@/lib/auth';
import { HttpError, isUuid, parseJson, route } from '@/lib/http';
import { roadTimes } from '@/lib/road-times';

type Ctx = { params: Promise<{ id: string }> };

const body = z.object({
  site_ids: z.array(z.string().uuid()).max(200),
  start: z.string().regex(/^\d{2}:\d{2}$/).default('04:00'),
  keep_first: z.boolean().default(false),
});

/** Plans the stops as they are on screen. Nothing is saved: the dispatcher accepts with the normal save. */
export const POST = route<Ctx>(async (req, { params }) => {
  const id = (await params).id;
  if (!isUuid(id)) throw new HttpError(404, 'Not found');
  const ctx = await requireApi('dispatcher');
  const { site_ids, start, keep_first } = await parseJson(req, body);
  let yardTrip = true;
  const rows = await asUser(ctx, async (tx) => {
    const [r] = await tx.select({ id: routeTable.id, yard_trip: routeTable.yard_trip }).from(routeTable).where(eq(routeTable.id, id));
    if (!r) throw new HttpError(404, 'Not found');
    yardTrip = r.yard_trip;
    if (!site_ids.length) return [];
    return tx.select({ id: site.id, lat: site.lat, lon: site.lon, priority: site.priority, service_window: site.service_window, estimate: site.area_estimate_sqft, confirmed: site.area_confirmed_sqft }).from(site).where(inArray(site.id, site_ids));
  });
  const byId = new Map(rows.map((s) => [s.id, s]));
  const sites: RouteSite[] = site_ids.flatMap((sid) => {
    const s = byId.get(sid);
    return s ? [{ id: s.id, lat: s.lat, lon: s.lon, priority: s.priority, open_by: s.service_window?.open_by ?? null, not_before: s.service_window?.not_before ?? null, sqft: s.confirmed ?? s.estimate }] : [];
  });
  // Out from the yard and back, unless this route is set not to (issue 64).
  const yard = yardTrip && ctx.tenant.yard ? { lat: ctx.tenant.yard.lat, lon: ctx.tenant.yard.lon } : null;
  // Road times when the router has them (issue 65); the same plan on estimates when it doesn't.
  const road = await roadTimes([...sites, ...(yard ? [yard] : [])]);
  return { ...compareRoute(sites, { start, keepFirst: keep_first, yard, legMinutes: road.legMinutes }), skipped: site_ids.length - sites.length, yard: Boolean(yard), times: road.source, times_label: road.label };
});
