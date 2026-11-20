import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, crew_member, eq, equipment_log, invoice_draft, run_stop, salt_ledger, serviceDb, sql, storm, truck, visit, withUser } from '@flake/db';
import { createStorm, ctxOf, drain, makeWorld } from './helpers';

afterAll(async () => {
  await drain();
  await serviceDb().execute(sql`update job set done_at = now() where done_at is null and dead_at is null`);
  await closeDb();
});

describe('issue 167: profit per lot', () => {
  it('revenue less labor, subs, salt and equipment per lot, and the pieces add up', async () => {
    const { profitReport } = await import('@/lib/profit');
    const { yardsFor } = await import('@/lib/yards');
    const w = await makeWorld();
    await serviceDb().update(crew_member).set({ pay_regular_cents: 3000 }).where(eq(crew_member.id, w.crewId));
    const out = await createStorm(ctxOf(w), { name: 'Profit storm', routeIds: [w.routeId], crewAssignments: {} });
    await serviceDb().update(storm).set({ started_at: '2026-12-02T08:00:00Z', status: 'closed' }).where(eq(storm.id, out.storm.id));
    const stops = (await serviceDb().select().from(run_stop).where(eq(run_stop.storm_run_id, out.runs[0]!.id))).sort((a, b) => a.seq - b.seq);
    const [a, b] = [stops[0]!.site_id, stops[1]!.site_id];
    // Lot A: $100 billed, an employee 60 min on site with 1 ton of salt. Lot B: $50 billed, a sub at $40 a visit, 30 min.
    const visitAt = (site: string, crew: string, mins: number, salt: { unit: string; qty: number }[] | null) => serviceDb().insert(visit).values({ tenant_id: w.tenantId, client_uuid: randomUUID(), storm_id: out.storm.id, site_id: site, crew_id: crew, services: ['plow'], arrived_device_at: '2026-12-02T10:00:00Z', departed_device_at: new Date(Date.parse('2026-12-02T10:00:00Z') + mins * 60_000).toISOString(), salt });
    await visitAt(a, w.crewId, 60, [{ unit: 'ton', qty: 1 }]);
    await serviceDb().update(crew_member).set({ sub_rate_card: { per_visit_cents: 4000 } }).where(eq(crew_member.id, w.crew2Id));
    await visitAt(b, w.crew2Id, 30, null);
    await serviceDb().insert(invoice_draft).values([
      { tenant_id: w.tenantId, storm_id: out.storm.id, customer_id: w.customerIds[0]!, lines: [{ site_id: a, service: 'plow', amount_cents: 10000 }], subtotal_cents: 10000, status: 'approved' },
      { tenant_id: w.tenantId, storm_id: out.storm.id, customer_id: w.customerIds[1]!, lines: [{ site_id: b, service: 'plow', amount_cents: 5000 }], subtotal_cents: 5000, status: 'paid' },
    ]);
    // Salt at $80 a ton; $30 of fuel on the storm, split 2:1 by minutes on site.
    const [y] = await yardsFor(w.tenantId);
    await serviceDb().insert(salt_ledger).values({ tenant_id: w.tenantId, yard_id: y!.id, qty_tons: 10, cost_cents: 80000, source: 'delivery', at: '2026-11-20T12:00:00Z' });
    const [t] = await serviceDb().insert(truck).values({ tenant_id: w.tenantId, name: 'T1' }).returning();
    await serviceDb().insert(equipment_log).values({ tenant_id: w.tenantId, truck_id: t!.id, storm_id: out.storm.id, kind: 'fuel', gallons: 10, cost_cents: 3000 });

    const r = await withUser(w.userId, (tx) => profitReport(tx, w.tenantId, { startAt: '2026-07-01T04:00:00Z', endAt: '2027-07-01T04:00:00Z' }));
    const lotA = r.rows.find((x) => x.siteId === a)!;
    const lotB = r.rows.find((x) => x.siteId === b)!;
    expect(lotA).toMatchObject({ revenue_cents: 10000, labor_cents: 3000, salt_cents: 8000, equipment_cents: 2000, sub_cents: 0, profit_cents: -3000, losing: true });
    expect(lotB).toMatchObject({ revenue_cents: 5000, labor_cents: 0, sub_cents: 4000, equipment_cents: 1000, profit_cents: 0 });
    // Worst first, and the totals are the sum of the rows.
    expect(r.rows[0]!.siteId).toBe(a);
    expect(r.totals.profit_cents).toBe(r.rows.reduce((s, x) => s + x.profit_cents, 0));
    expect(r.missing).toEqual([]);

    // Collected only: lot A's unpaid bill drops out.
    const paid = await withUser(w.userId, (tx) => profitReport(tx, w.tenantId, { startAt: '2026-07-01T04:00:00Z', endAt: '2027-07-01T04:00:00Z', collectedOnly: true }));
    expect(paid.rows.find((x) => x.siteId === a)!.revenue_cents).toBe(0);
    // No pay rate: labor is $0 and the page says why.
    await serviceDb().update(crew_member).set({ pay_regular_cents: null }).where(eq(crew_member.id, w.crewId));
    const noRate = await withUser(w.userId, (tx) => profitReport(tx, w.tenantId, { startAt: '2026-07-01T04:00:00Z', endAt: '2027-07-01T04:00:00Z' }));
    expect(noRate.missing).toEqual(['pay rate for Crew One']);

    // Issue 211: with lot A's bill still a draft, it says the bill isn't approved, not that the lot loses money.
    await serviceDb().update(invoice_draft).set({ status: 'draft' }).where(eq(invoice_draft.customer_id, w.customerIds[0]!));
    const drafted = await withUser(w.userId, (tx) => profitReport(tx, w.tenantId, { startAt: '2026-07-01T04:00:00Z', endAt: '2027-07-01T04:00:00Z' }));
    expect(drafted.rows.find((x) => x.siteId === a)).toMatchObject({ revenue_cents: 0, unapproved_cents: 10000, losing: false });
    expect(drafted.rows.find((x) => x.siteId === b)).toMatchObject({ unapproved_cents: 0 });
  });
});
