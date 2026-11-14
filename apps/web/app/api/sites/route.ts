import { siteCreate } from '@flake/contracts';
import { site } from '@flake/db';
import { collectionRoutes } from '@/lib/crud';
import { requireLiveCustomer, requireSiteRoom } from '@/lib/sites';

export const { GET, POST } = collectionRoutes(site as any, siteCreate, {
  beforeCreate: async (tx, tenantId, body) => {
    await requireLiveCustomer(tx, body.customer_id);
    await requireSiteRoom(tx, tenantId);
  },
});
