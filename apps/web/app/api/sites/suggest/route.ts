import { addressSuggest } from '@flake/contracts';
import { requireApi } from '@/lib/auth';
import { parseJson, rateLimit, route } from '@/lib/http';
import { getProviders } from '@/lib/providers';

/** Signed-in office users only, and limited, because this calls a free community service on their behalf. */
export const POST = route(async (req) => {
  const ctx = await requireApi('dispatcher');
  rateLimit(`suggest:${ctx.userId}`, 60, 60000);
  const { q } = await parseJson(req, addressSuggest);
  const { geocoder } = await getProviders();
  return { hits: await geocoder.suggest(q) };
});
