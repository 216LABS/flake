import { routeCreate } from '@flake/contracts';
import { route, route_stop } from '@flake/db';
import { collectionRoutes } from '@/lib/crud';
import { requireFreeRouteName } from '@/lib/routes';

export const { GET, POST } = collectionRoutes(route as any, routeCreate, {
  transform: ({ site_ids: _ignored, ...rest }) => rest,
  beforeCreate: (tx, _tenantId, body) => requireFreeRouteName(tx, body.name),
  afterCreate: async (tx, row, body, tenantId) => {
    if (body.site_ids.length) await tx.insert(route_stop).values(body.site_ids.map((site_id: string, i: number) => ({ route_id: row.id, site_id, seq: i + 1, tenant_id: tenantId })));
  },
});
