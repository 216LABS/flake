import { and, eq, gte, route as routeTable, route_stop, site, sql } from '@flake/db';
import { z } from 'zod';
import { asUser, requireApi } from '@/lib/auth';
import { HttpError, isUuid, parseJson, route } from '@/lib/http';

const body = z.object({ site_id: z.uuid(), position: z.number().int().min(1).max(10_000).optional() });

/**
 * Puts one lot on a route, at a place in the order or at the end. Only that stop changes, so a route someone else
 * edited a moment ago keeps their change. Saving the whole list from an old screen would quietly undo it.
 */
export const POST = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const id = (await params).id;
  if (!isUuid(id)) throw new HttpError(404, 'Not found');
  const ctx = await requireApi('dispatcher');
  const { site_id, position } = await parseJson(req, body);
  return asUser(ctx, async (tx) => {
    const [r] = await tx.select({ id: routeTable.id }).from(routeTable).where(eq(routeTable.id, id)).for('update');
    if (!r) throw new HttpError(404, 'Not found');
    const [st] = await tx.select({ id: site.id }).from(site).where(and(eq(site.id, site_id), eq(site.active, true)));
    if (!st) throw new HttpError(404, 'Site not found');
    const [already] = await tx.select({ seq: route_stop.seq }).from(route_stop).where(and(eq(route_stop.route_id, id), eq(route_stop.site_id, site_id)));
    if (already) return { seq: already.seq };
    const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(route_stop).where(eq(route_stop.route_id, id));
    const seq = Math.min(position ?? n + 1, n + 1);
    await tx.update(route_stop).set({ seq: sql`${route_stop.seq} + 1` }).where(and(eq(route_stop.route_id, id), gte(route_stop.seq, seq)));
    await tx.insert(route_stop).values({ route_id: id, site_id, seq, tenant_id: ctx.tenantId });
    return { seq };
  });
});
