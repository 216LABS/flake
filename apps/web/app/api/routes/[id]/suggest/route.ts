import { compareRoute, type RouteSite } from '@flake/core/routing';
import { eq, inArray, route as routeTable, site } from '@flake/db';
import { z } from 'zod';
import { asUser, requireApi } from '@/lib/auth';
import { HttpError, isUuid, parseJson, route } from '@/lib/http';

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
  const rows = await asUser(ctx, async (tx) => {
    const [r] = await tx.select({ id: routeTable.id }).from(routeTable).where(eq(routeTable.id, id));
    if (!r) throw new HttpError(404, 'Not found');
    if (!site_ids.length) return [];
    return tx.select({ id: site.id, lat: site.lat, lon: site.lon, priority: site.priority, service_window: site.service_window, estimate: site.area_estimate_sqft, confirmed: site.area_confirmed_sqft }).from(site).where(inArray(site.id, site_ids));
  });
  const byId = new Map(rows.map((s) => [s.id, s]));
  const sites: RouteSite[] = site_ids.flatMap((sid) => {
    const s = byId.get(sid);
    return s ? [{ id: s.id, lat: s.lat, lon: s.lon, priority: s.priority, open_by: s.service_window?.open_by ?? null, not_before: s.service_window?.not_before ?? null, sqft: s.confirmed ?? s.estimate }] : [];
  });
  return { ...compareRoute(sites, { start, keepFirst: keep_first }), skipped: site_ids.length - sites.length };
});
