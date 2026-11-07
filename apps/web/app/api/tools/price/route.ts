import { toolPrice } from '@flake/contracts';
import { DEFAULT_RATE_CARD, suggestPrice } from '@flake/core/quote';
import { lead, serviceDb } from '@flake/db';
import { clientIp, HttpError, parseJson, rateLimit, route } from '@/lib/http';
import { measureSite } from '@/lib/measure';
import { getProviders } from '@/lib/providers';

/** Public estimate. The defaults are editable assumptions and are labeled that way, never as market data. */
export const POST = route(async (req) => {
  rateLimit(`tool:${clientIp(req)}`, 20, 60000);
  const b = await parseJson(req, toolPrice);
  let sqft = b.sqft ?? null;
  let measured: { method: string; label: string } | null = null;
  if (!sqft && b.address) {
    const { geocoder } = await getProviders();
    const [hit] = await geocoder.search(b.address);
    if (!hit) throw new HttpError(404, 'We could not find that address. Enter the square footage instead.', 'not_found');
    const m = await measureSite(hit.lat, hit.lon, 'commercial');
    sqft = m.estimateSqft;
    measured = { method: m.method, label: hit.label };
  }
  if (!sqft) throw new HttpError(422, 'Enter the lot size, or an address we can measure.', 'no_area');
  const card = {
    ...DEFAULT_RATE_CARD,
    ...(b.per_sqft_cents_per_push !== undefined ? { per_sqft_cents_per_push: b.per_sqft_cents_per_push } : {}),
    ...(b.min_push_cents !== undefined ? { min_push_cents: b.min_push_cents } : {}),
    ...(b.walks_per_lf_cents !== undefined ? { walks_per_lf_cents: b.walks_per_lf_cents } : {}),
    ...(b.season_pushes !== undefined ? { season_pushes: b.season_pushes } : {}),
  };
  if (b.email) await serviceDb().insert(lead).values({ source: 'tool_price', email: b.email, payload: { sqft } });
  return { sqft, measured, assumptions: card, estimate: suggestPrice({ sqft, walks_lf: b.walks_lf }, card) };
});
