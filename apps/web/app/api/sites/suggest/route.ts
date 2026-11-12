import { addressSuggest } from '@flake/contracts';
import { asc, eq, site } from '@flake/db';
import { asUser, requireApi } from '@/lib/auth';
import { parseJson, rateLimit, route } from '@/lib/http';
import { getProviders } from '@/lib/providers';

/**
 * Signed-in office users only, and limited, because this calls free community services on their behalf. Results are
 * kept near the company: its yard, or else its first site (issue 87).
 */
export const POST = route(async (req) => {
  const ctx = await requireApi('dispatcher');
  rateLimit(`suggest:${ctx.userId}`, 60, 60000);
  const { q, expand } = await parseJson(req, addressSuggest);
  const yard = ctx.tenant.yard;
  const near = yard ? { lat: yard.lat, lon: yard.lon }
    : (await asUser(ctx, (tx) => tx.select({ lat: site.lat, lon: site.lon }).from(site).where(eq(site.active, true)).orderBy(asc(site.created_at)).limit(1)))[0] ?? null;
  const { geocoder } = await getProviders();
  return { hits: await geocoder.suggest(q, { near, expand }) };
});
