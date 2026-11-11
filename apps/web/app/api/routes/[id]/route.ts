import { routeUpdate } from '@flake/contracts';
import { eq, route, route_stop } from '@flake/db';
import { itemRoutes } from '@/lib/crud';
import { archivedAt, checkRouteUpdate } from '@/lib/routes';

export const { GET, PATCH, DELETE } = itemRoutes(route as any, routeUpdate, {
  transform: ({ site_ids: _ignored, archived, ...rest }) => ({ ...rest, ...archivedAt(archived) }),
  beforeUpdate: (tx, id, body) => checkRouteUpdate(tx, id, body),
  afterUpdate: async (tx, id, body, tenantId) => {
    if (!body.site_ids) return;
    await tx.delete(route_stop).where(eq(route_stop.route_id, id));
    if (body.site_ids.length) await tx.insert(route_stop).values(body.site_ids.map((site_id: string, i: number) => ({ route_id: id, site_id, seq: i + 1, tenant_id: tenantId })));
  },
});
