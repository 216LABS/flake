import { afterAll, describe, expect, it } from 'vitest';
import { and, closeDb, contract, eq, installment_invoice, invoice_draft, run_stop, serviceDb, storm, withUser } from '@flake/db';
import { approveDrafts, generateDrafts } from '@/lib/billing';
import { processActions, resolveToken } from '@/lib/driver';
import { closeStorm, publishStorm } from '@/lib/storms';
import { decryptToken } from '@/lib/tokens';
import { setSurcharge } from '@/lib/salt-policy';
import { decideTrueUp, draftTrueUp, seasonTerms } from '@/lib/season-terms';
import { ctxOf, createStorm, makeWorld, stopActions, type World } from './helpers';

afterAll(async () => {
  await closeDb();
});

/** One storm on route A, every lot done once, inside the 2026-27 season. Lot 0 gets half a ton of salt. */
async function storm1(w: World, base: number) {
  const ctx = ctxOf(w);
  const out = await createStorm(ctx, { name: `S ${base}`, routeIds: [w.routeId], crewAssignments: {} });
  await publishStorm(ctx, out.storm.id);
  const run = out.runs[0]!;
  const rs = await resolveToken(decryptToken(run.link_token_enc!));
  const stops = (await serviceDb().select().from(run_stop).where(eq(run_stop.storm_run_id, run.id))).sort((a, b) => a.seq - b.seq);
  await serviceDb().update(storm).set({ started_at: new Date(base - 3600000).toISOString() }).where(eq(storm.id, out.storm.id));
  for (const [i, s] of stops.entries()) {
    const salt = s.site_id === w.siteIds[0] ? { services: ['plow', 'salt'], salt: [{ unit: 'ton', qty: 0.5 }] } : {};
    await processActions(rs, stopActions(s.id, new Date(base + i * 3600000), { depth: 3, gps: { lat: 41.48 + i * 0.001, lon: -81.8 }, minutes: 40, ...salt }).actions as never);
  }
  await closeStorm(ctx, out.storm.id, false);
  return out.storm.id;
}

describe('issue 232: a salt surcharge on new drafts', () => {
  it('adds a surcharge line priced from the recorded salt, and leaves an approved bill alone when the surcharge changes', async () => {
    const w = await makeWorld();
    const db = serviceDb();
    await db.update(contract).set({ services: [{ service: 'plow', trigger_in: 2, pricing: { type: 'per_push', amount_cents: 6500 } }, { service: 'salt', trigger_in: null }], salt_pricing: { unit: 'ton', amount_cents: 9000 } }).where(eq(contract.site_id, w.siteIds[0]!));
    await setSurcharge(w.tenantId, { per: 'ton', amount_cents: 12000, from: '2026-11-01' });
    const sid = await storm1(w, Date.parse('2026-11-10T10:00:00Z'));
    await generateDrafts(ctxOf(w), sid);
    const [d] = await db.select().from(invoice_draft).where(and(eq(invoice_draft.storm_id, sid), eq(invoice_draft.customer_id, w.customerIds[0]!)));
    const sur = (d!.lines as { service: string; amount_cents: number; description: string }[]).filter((l) => l.service === 'salt_surcharge');
    expect(sur).toHaveLength(1);
    expect(sur[0]!.amount_cents).toBe(6000);
    expect(sur[0]!.description).toContain("this season's salt prices");
    // Approved, then the surcharge changes and drafts regenerate: the approved bill keeps what it had.
    await db.update(invoice_draft).set({ status: 'approved' }).where(eq(invoice_draft.id, d!.id));
    await setSurcharge(w.tenantId, { per: 'ton', amount_cents: 50000, from: '2026-11-01' });
    await generateDrafts(ctxOf(w), sid);
    const [after] = await db.select().from(invoice_draft).where(eq(invoice_draft.id, d!.id));
    expect(after!.subtotal_cents).toBe(d!.subtotal_cents);
    void approveDrafts;
  });
});

describe('issue 233: seasonal caps and minimums', () => {
  it('bills pushes past a seasonal cap across storms, and drafts a per-push minimum true-up only for review', async () => {
    const w = await makeWorld();
    const db = serviceDb();
    // Lot 3 is seasonal: cap it at 1 push, $80 each after. Lot 0 is per push: a $500 season minimum.
    await db.update(contract).set({ services: [{ service: 'plow', trigger_in: 2, pricing: { type: 'seasonal', total_cents: 300000, installments: 5, included_pushes: 1, overage_cents: 8000 } }] }).where(eq(contract.site_id, w.siteIds[3]!));
    await db.update(contract).set({ services: [{ service: 'plow', trigger_in: 2, pricing: { type: 'per_push', amount_cents: 6500, season_min_cents: 50000 } }] }).where(eq(contract.site_id, w.siteIds[0]!));
    const first = await storm1(w, Date.parse('2026-11-10T10:00:00Z'));
    await generateDrafts(ctxOf(w), first);
    const lines = async (sid: string, c: string) => ((await db.select().from(invoice_draft).where(and(eq(invoice_draft.storm_id, sid), eq(invoice_draft.customer_id, c))))[0]?.lines ?? []) as { amount_cents: number; description: string }[];
    expect(await lines(first, w.customerIds[3]!)).toEqual([]);
    const second = await storm1(w, Date.parse('2026-11-20T10:00:00Z'));
    await generateDrafts(ctxOf(w), second);
    const over = await lines(second, w.customerIds[3]!);
    expect(over).toHaveLength(1);
    expect(over[0]).toMatchObject({ amount_cents: 8000, description: expect.stringContaining('push 2 of the season, past the 1 included') });

    // Approve lot 0's two storm bills ($65 each), then: $130 billed of a $500 minimum.
    await db.update(invoice_draft).set({ status: 'approved' }).where(eq(invoice_draft.customer_id, w.customerIds[0]!));
    const now = new Date('2027-03-01T12:00:00Z');
    const terms = await withUser(w.userId, (tx) => seasonTerms(tx, 'America/New_York', now));
    const r0 = terms.rows.find((r) => r.site_id === w.siteIds[0])!;
    expect(r0).toMatchObject({ pushes: 2, billed_cents: 13000, minimum_cents: 50000, trueup: null });
    expect(terms.rows.find((r) => r.site_id === w.siteIds[3])).toMatchObject({ pushes: 2, included: 1 });
    // seasonTerms reads the season from today, so the draft needs a clock inside 2026-27 too.
    const { vi } = await import('vitest');
    vi.useFakeTimers({ now, toFake: ['Date'] });
    try {
      const t = await withUser(w.userId, (tx) => draftTrueUp(tx, w.tenantId, 'America/New_York', r0.contract_id));
      expect(t).toMatchObject({ amount_cents: 37000, status: 'draft' });
      await expect(withUser(w.userId, (tx) => draftTrueUp(tx, w.tenantId, 'America/New_York', r0.contract_id))).rejects.toThrow(/already drafted/);
      await withUser(w.userId, (tx) => decideTrueUp(tx, w.tenantId, t.id, true));
      expect((await db.select().from(installment_invoice).where(eq(installment_invoice.id, t.id)))[0]!.status).toBe('manual');
    } finally {
      vi.useRealTimers();
    }
  });
});
