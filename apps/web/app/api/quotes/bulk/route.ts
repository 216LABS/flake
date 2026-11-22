import { quoteCreate } from '@flake/contracts';
import { DEFAULT_RATE_CARD, suggestPrice, type RateCard } from '@flake/core/quote';
import { quotingSeason } from '@flake/core/time';
import { and, customer, eq, inArray, site, sql } from '@flake/db';
import { z } from 'zod';
import { asUser, requireApi } from '@/lib/auth';
import { parseJson, route } from '@/lib/http';
import { createQuote } from '@/lib/quotes';
import { defaultTrigger } from '@/lib/triggers';

export const maxDuration = 60;

const body = z.object({ site_ids: z.array(z.uuid()).min(1).max(300) });

/**
 * Link-only quotes for many lots at once, at the rate card price for each lot's area (issue 217). For a list just
 * imported: nothing is sent, and a customer's lots share one link. Lots that already have a quote waiting or a signed
 * contract this season are left alone.
 */
export const POST = route(async (req) => {
  const ctx = await requireApi('dispatcher');
  const { site_ids } = await parseJson(req, body);
  const season = quotingSeason(new Date(), ctx.tenant.timezone);
  const card = (Object.keys(ctx.tenant.rate_card as object).length ? ctx.tenant.rate_card : DEFAULT_RATE_CARD) as RateCard;
  const trigger = await defaultTrigger(ctx.tenantId);
  const lots = await asUser(ctx, (tx) => tx.select({ id: site.id, customer_id: site.customer_id, customer: customer.name, sqft: sql<number | null>`coalesce(${site.area_confirmed_sqft}, ${site.area_estimate_sqft})` })
    .from(site).innerJoin(customer, eq(customer.id, site.customer_id))
    .where(and(inArray(site.id, site_ids), eq(site.active, true), sql`not exists (select 1 from contract k where k.site_id = ${site.id} and k.season = ${season} and k.status in ('draft', 'sent', 'accepted'))`)));
  const byCustomer = new Map<string, { customer_id: string; name: string; url: string; share: unknown; lots: number }>();
  for (const l of lots) {
    const price = suggestPrice({ sqft: Number(l.sqft ?? 0) }, card).per_push_cents;
    const q = await createQuote(ctx, quoteCreate.parse({ site_id: l.id, season, services: [{ service: 'plow', trigger_in: trigger, pricing: { type: 'per_push', amount_cents: price } }], salt_pricing: null, send: false }));
    byCustomer.set(l.customer_id, { customer_id: l.customer_id, name: l.customer, url: q.url, share: q.share, lots: q.lots });
  }
  return { season, quoted: lots.length, skipped: site_ids.length - lots.length, customers: [...byCustomer.values()].sort((a, b) => a.name.localeCompare(b.name)) };
});
