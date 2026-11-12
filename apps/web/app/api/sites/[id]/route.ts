import { siteUpdate } from '@flake/contracts';
import { FREE_SITE_LIMIT, proFeaturesEnabled } from '@flake/core/fees';
import { todayIn } from '@flake/core/time';
import { eq, site, sql, tenant } from '@flake/db';
import { itemRoutes } from '@/lib/crud';
import { HttpError } from '@/lib/http';
import { takeSitesOffWork } from '@/lib/sites';

// Sites have visit history, so "delete" retires them instead of removing them.
export const { GET, PATCH, DELETE } = itemRoutes(site as any, siteUpdate, {
  softDelete: { active: false },
  beforeUpdate: async (tx, id, body) => {
    if (!body.active) return;
    // Restoring counts against the free plan the same as adding a site.
    const [s] = await tx.select({ tenant_id: site.tenant_id, active: site.active }).from(site).where(eq(site.id, id));
    if (!s || s.active) return;
    const [t] = await tx.select().from(tenant).where(eq(tenant.id, s.tenant_id));
    if (proFeaturesEnabled(t!.plan, t!.free_season_until, todayIn(t!.timezone))) return;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`sites:${s.tenant_id}`}))`);
    const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(site).where(eq(site.active, true));
    if (n >= FREE_SITE_LIMIT) throw new HttpError(402, `The free plan covers ${FREE_SITE_LIMIT} sites. Upgrade to Pro to restore this one.`, 'site_limit');
  },
  afterDelete: (tx, id) => takeSitesOffWork(tx, [id]),
});
