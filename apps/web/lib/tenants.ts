import { FREE_SEASON_END } from '@flake/core/fees';
import { DEFAULT_RATE_CARD } from '@flake/core/quote';
import { eq, membership, serviceDb, sql, tenant } from '@flake/db';
import { randomBytes } from 'node:crypto';

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'company';

/**
 * Signup is the one write with no tenant to scope to yet, so it uses the service connection. A double tap on Continue
 * makes one company, and two companies with the same name at once each get their own address.
 */
export async function createTenantForUser(userId: string, email: string | null, name: string, timezone: string) {
  return serviceDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`signup:${userId}`}))`);
    const [existing] = await tx.select().from(membership).where(eq(membership.user_id, userId));
    if (existing) return existing.tenant_id;
    const base = slugify(name);
    const [taken] = await tx.select({ id: tenant.id }).from(tenant).where(eq(tenant.slug, base));
    const values = { name, timezone, contact_email: email, free_season_until: FREE_SEASON_END, rate_card: DEFAULT_RATE_CARD };
    let [t] = await tx.insert(tenant).values({ ...values, slug: taken ? `${base}-${randomBytes(3).toString('hex')}` : base }).onConflictDoNothing({ target: tenant.slug }).returning();
    if (!t) [t] = await tx.insert(tenant).values({ ...values, slug: `${base}-${randomBytes(3).toString('hex')}` }).returning();
    await tx.insert(membership).values({ tenant_id: t!.id, user_id: userId, role: 'owner' });
    return t!.id;
  });
}
