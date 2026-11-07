import { siteCreate } from '@flake/contracts';
import { FREE_SITE_LIMIT, proFeaturesEnabled } from '@flake/core/fees';
import { eq, site, sql, tenant } from '@flake/db';
import { collectionRoutes } from '@/lib/crud';
import { HttpError } from '@/lib/http';

export const { GET, POST } = collectionRoutes(site as any, siteCreate, {
  beforeCreate: async (tx, tenantId) => {
    const [t] = await tx.select().from(tenant).where(eq(tenant.id, tenantId));
    if (proFeaturesEnabled(t!.plan, t!.free_season_until, new Date().toISOString().slice(0, 10))) return;
    const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(site).where(eq(site.active, true));
    if (n >= FREE_SITE_LIMIT) throw new HttpError(402, `The free plan covers ${FREE_SITE_LIMIT} sites. Upgrade to Pro for more.`, 'site_limit');
  },
});
