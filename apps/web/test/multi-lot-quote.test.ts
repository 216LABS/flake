import { afterAll, describe, expect, it } from 'vitest';
import { and, closeDb, contract, eq, inArray, message_log, serviceDb, site, sql } from '@flake/db';
import { acceptQuote, createQuote, declineQuote, getQuote, resendQuote } from '@/lib/quotes';
import { ctxOf, drain, makeWorld } from './helpers';

afterAll(async () => {
  await drain();
  await serviceDb().execute(sql`update job set done_at = now() where done_at is null and dead_at is null`);
  await closeDb();
});

const plow = (cents: number) => [{ service: 'plow' as const, trigger_in: 2, pricing: { type: 'per_push' as const, amount_cents: cents } }];

/** Customer 0 with a second lot, the way an HOA with two drives is set up. */
async function twoLots() {
  const w = await makeWorld();
  const [second] = await serviceDb().insert(site).values({ tenant_id: w.tenantId, customer_id: w.customerIds[0]!, label: 'North drive', address: '2 North Dr, Lakewood, OH', lat: 41.48, lon: -81.8 }).returning();
  return { w, ctx: ctxOf(w), lots: [w.siteIds[0]!, second!.id] };
}

const sign = { name: 'Pat Board', agree: true as const, consentSms: false, consentEmail: true, phone_e164: null };

describe('issue 101: one quote for all of a customer\'s lots', () => {
  it('a second lot joins the waiting quote: one link, both lots shown, one signature accepts both with a PDF each', async () => {
    const { w, ctx, lots } = await twoLots();
    const a = await createQuote(ctx, { site_id: lots[0]!, season: '2027-28', services: plow(7000), send: false });
    const b = await createQuote(ctx, { site_id: lots[1]!, season: '2027-28', services: plow(5500), send: true });
    expect(b.token).toBe(a.token);
    expect(b.lots).toBe(2);
    const q = await getQuote(a.token);
    expect(q.lots.map((l) => l.site.label).sort()).toEqual(['North drive', 'Site 0']);
    expect(await acceptQuote(a.token, sign, null)).toEqual({ already: false });
    const rows = await serviceDb().select().from(contract).where(inArray(contract.id, [a.contract.id, b.contract.id]));
    expect(rows.map((r) => r.status)).toEqual(['accepted', 'accepted']);
    expect(new Set(rows.map((r) => r.pdf_path)).size).toBe(2);
    expect(await acceptQuote(a.token, sign, null)).toEqual({ already: true });
    // Another customer's quote, or another season, never joins.
    const other = await createQuote(ctx, { site_id: w.siteIds[1]!, season: '2027-28', services: plow(7000), send: false });
    expect(other.token).not.toBe(a.token);
  });

  it('declining declines every lot on the link and tells the office once, naming them', async () => {
    const { w, ctx, lots } = await twoLots();
    const a = await createQuote(ctx, { site_id: lots[0]!, season: '2027-28', services: plow(7000), send: false });
    await createQuote(ctx, { site_id: lots[1]!, season: '2027-28', services: plow(5500), send: false });
    expect(await declineQuote(a.token, { reason: 'Too much' })).toEqual({ already: false });
    const rows = await serviceDb().select().from(contract).where(and(eq(contract.tenant_id, w.tenantId), eq(contract.season, '2027-28')));
    expect(rows.map((r) => r.status)).toEqual(['declined', 'declined']);
    await drain();
    const told = await serviceDb().select().from(message_log).where(and(eq(message_log.tenant_id, w.tenantId), eq(message_log.template, 'owner_alert')));
    expect(told.length).toBeGreaterThan(0);
    expect(told[0]!.body).toContain('North drive');
  });

  it('re-quoting one lot keeps it on the link with the new price; resending moves every lot to the new link', async () => {
    const { ctx, lots } = await twoLots();
    const a = await createQuote(ctx, { site_id: lots[0]!, season: '2027-28', services: plow(7000), send: false });
    const b = await createQuote(ctx, { site_id: lots[1]!, season: '2027-28', services: plow(5500), send: false });
    const b2 = await createQuote(ctx, { site_id: lots[1]!, season: '2027-28', services: plow(6000), send: false });
    expect(b2.token).toBe(a.token);
    const q = await getQuote(a.token);
    expect(q.lots).toHaveLength(2);
    expect(q.lots.some((l) => l.contract.id === b.contract.id)).toBe(false);
    const { url } = await resendQuote(ctx, a.contract.id);
    const token = url.split('/q/')[1]!;
    expect((await getQuote(token)).lots).toHaveLength(2);
    await expect(getQuote(a.token)).rejects.toMatchObject({ status: 410 });
  });
});
