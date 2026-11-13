import { afterAll, describe, expect, it } from 'vitest';
import { and, closeDb, customer, eq, message_log, run_stop, serviceDb } from '@flake/db';
import { processActions, resolveToken } from '@/lib/driver';
import { publishStorm } from '@/lib/storms';
import { decryptToken } from '@/lib/tokens';
import { ctxOf, createStorm, drain, makeWorld, stopActions } from './helpers';

afterAll(() => closeDb());

describe('issue 105: the per-visit service record email follows the customer\'s email choice', () => {
  it('goes to a commercial customer who kept emails on, and not to one who turned them off on the quote', async () => {
    const w = await makeWorld();
    // Customers 1 and 2 are commercial with an email address.
    await serviceDb().update(customer).set({ notify_email: false }).where(eq(customer.id, w.customerIds[1]!));
    await serviceDb().update(customer).set({ notify_email: true }).where(eq(customer.id, w.customerIds[2]!));
    const ctx = ctxOf(w);
    const out = await createStorm(ctx, { name: 'Records', routeIds: [w.routeId], crewAssignments: {}, siteIds: [w.siteIds[1]!, w.siteIds[2]!] });
    await publishStorm(ctx, out.storm.id);
    const run = out.runs[0]!;
    const rs = await resolveToken(decryptToken(run.link_token_enc!));
    const stops = await serviceDb().select().from(run_stop).where(eq(run_stop.storm_run_id, run.id));
    for (const [i, s] of stops.entries()) {
      const a = stopActions(s.id, new Date(Date.now() - 3600_000 + i * 1200_000), { depth: 3, gps: { lat: 41.48, lon: -81.8 }, minutes: 15 });
      await processActions(rs, a.actions as never);
    }
    await drain();
    const reports = await serviceDb().select().from(message_log).where(and(eq(message_log.tenant_id, w.tenantId), eq(message_log.template, 'completion_report')));
    const to = reports.map((r) => r.to_addr);
    const [off] = await serviceDb().select().from(customer).where(eq(customer.id, w.customerIds[1]!));
    const [on] = await serviceDb().select().from(customer).where(eq(customer.id, w.customerIds[2]!));
    expect(to).toContain(on!.email);
    expect(to).not.toContain(off!.email);
  });
});

describe('issue 109: a storm is billed at the price in force when it happened', () => {
  it('a re-signature after the storm does not reprice it; a storm after the re-signature uses the new price', async () => {
    const { contract, invoice_draft, storm, run_stop: rs } = await import('@flake/db');
    const { generateDrafts } = await import('@/lib/billing');
    const { closeStorm } = await import('@/lib/storms');
    const w = await makeWorld();
    const ctx = ctxOf(w);
    const siteId = w.siteIds[0]!; // per push $65
    const db = serviceDb();
    const [old] = await db.select().from(contract).where(eq(contract.site_id, siteId));
    await db.update(contract).set({ accepted_at: new Date(Date.now() - 30 * 86400_000).toISOString() }).where(eq(contract.id, old!.id));

    const runStorm = async (name: string) => {
      const out = await createStorm(ctx, { name, routeIds: [w.routeId], crewAssignments: {}, siteIds: [siteId] });
      await publishStorm(ctx, out.storm.id);
      const r = await resolveToken(decryptToken(out.runs[0]!.link_token_enc!));
      const [stop] = await db.select().from(rs).where(eq(rs.storm_run_id, out.runs[0]!.id));
      await processActions(r, stopActions(stop!.id, new Date(Date.now() - 3600_000), { depth: 3, gps: { lat: 41.48, lon: -81.8 }, minutes: 20 }).actions as never);
      await closeStorm(ctx, out.storm.id, true);
      return out.storm.id;
    };
    const before = await runStorm('Before re-sign');

    // The customer re-signs at $90: the old agreement is replaced (voided) and the new one accepted, as acceptQuote does.
    await db.update(contract).set({ status: 'void' }).where(eq(contract.id, old!.id));
    await db.insert(contract).values({ tenant_id: w.tenantId, site_id: siteId, season: old!.season, status: 'accepted', accepted_at: new Date().toISOString(), services: [{ service: 'plow', trigger_in: 2, pricing: { type: 'per_push', amount_cents: 9000 } }] });
    await db.update(storm).set({ started_at: new Date(Date.now() - 2 * 86400_000).toISOString() }).where(eq(storm.id, before));

    const priced = async (stormId: string) => {
      await generateDrafts(ctx, stormId);
      const rows = await db.select().from(invoice_draft).where(eq(invoice_draft.storm_id, stormId));
      return rows.find((r) => r.customer_id === w.customerIds[0])?.subtotal_cents;
    };
    expect(await priced(before)).toBe(6500);
    const after = await runStorm('After re-sign');
    expect(await priced(after)).toBe(9000);
  });

  it('a contract the office voided with no replacement still bills nothing', async () => {
    const { contract, invoice_draft } = await import('@flake/db');
    const { generateDrafts } = await import('@/lib/billing');
    const { closeStorm } = await import('@/lib/storms');
    const w = await makeWorld();
    const ctx = ctxOf(w);
    const siteId = w.siteIds[0]!;
    const db = serviceDb();
    await db.update(contract).set({ status: 'void', accepted_at: new Date(Date.now() - 30 * 86400_000).toISOString() }).where(eq(contract.site_id, siteId));
    const out = await createStorm(ctx, { name: 'Voided', routeIds: [w.routeId], crewAssignments: {}, siteIds: [siteId] });
    await publishStorm(ctx, out.storm.id);
    const r = await resolveToken(decryptToken(out.runs[0]!.link_token_enc!));
    const [stop] = await db.select().from(run_stop).where(eq(run_stop.storm_run_id, out.runs[0]!.id));
    await processActions(r, stopActions(stop!.id, new Date(Date.now() - 3600_000), { depth: 3, gps: { lat: 41.48, lon: -81.8 }, minutes: 20 }).actions as never);
    await closeStorm(ctx, out.storm.id, true);
    await generateDrafts(ctx, out.storm.id);
    const [d] = await db.select().from(invoice_draft).where(eq(invoice_draft.storm_id, out.storm.id));
    expect(d!.subtotal_cents).toBe(0);
    expect((d!.flags as any[]).map((f) => f.code)).toContain('no_contract');
  });
});
