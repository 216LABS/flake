import { FREE_SEASON_END } from '@flake/core/fees';
import { DEFAULT_RATE_CARD } from '@flake/core/quote';
import { eq, membership, serviceDb, sql, tenant } from '@flake/db';
import { randomBytes } from 'node:crypto';

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'company';

/** Signup is the one write with no tenant to scope to yet, so it uses the service connection. */
export async function createTenantForUser(userId: string, email: string | null, name: string, timezone: string) {
  const db = serviceDb();
  const [existing] = await db.select().from(membership).where(eq(membership.user_id, userId));
  if (existing) return existing.tenant_id;
  const base = slugify(name);
  const [taken] = await db.select({ id: tenant.id }).from(tenant).where(sql`${tenant.slug} = ${base}`);
  const slug = taken ? `${base}-${randomBytes(3).toString('hex')}` : base;
  const [t] = await db.insert(tenant).values({ name, slug, timezone, contact_email: email, free_season_until: FREE_SEASON_END, rate_card: DEFAULT_RATE_CARD }).returning();
  await db.insert(membership).values({ tenant_id: t!.id, user_id: userId, role: 'owner' });
  return t!.id;
}
