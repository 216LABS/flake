import { siteCreate } from '@flake/contracts';
import { FREE_SITE_LIMIT, proFeaturesEnabled } from '@flake/core/fees';
import { todayIn } from '@flake/core/time';
import { eq, site, sql, tenant } from '@flake/db';
import { collectionRoutes } from '@/lib/crud';
import { HttpError } from '@/lib/http';
import { requireLiveCustomer } from '@/lib/sites';

export const { GET, POST } = collectionRoutes(site as any, siteCreate, {
  beforeCreate: async (tx, tenantId, body) => {
    await requireLiveCustomer(tx, body.customer_id);
    const [t] = await tx.select().from(tenant).where(eq(tenant.id, tenantId));
    if (proFeaturesEnabled(t!.plan, t!.free_season_until, todayIn(t!.timezone))) return;
    // Two sites saved at once would both see room for one more.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`sites:${tenantId}`}))`);
    const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(site).where(eq(site.active, true));
    if (n >= FREE_SITE_LIMIT) throw new HttpError(402, `The free plan covers ${FREE_SITE_LIMIT} sites. Upgrade to Pro for more.`, 'site_limit');
  },
});
