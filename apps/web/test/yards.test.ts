import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { app_setting, closeDb, eq, run_stop, salt_ledger, serviceDb, sql, storm_run, visit, visit_correction, yard } from '@flake/db';
import { createStorm, ctxOf, drain, makeWorld } from './helpers';

afterAll(async () => {
  await drain();
  await serviceDb().execute(sql`update job set done_at = now() where done_at is null and dead_at is null`);
  await closeDb();
});

describe('issue 169: salt yards', () => {
  it('moves old stock into the first yard once, counts use from visits, puts voided salt back, and flags a reorder', async () => {
    const { yardStock, yardsFor, saltCostPerTon } = await import('@/lib/yards');
    const w = await makeWorld();
    const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
    // Stock logged before yards existed.
    await serviceDb().insert(app_setting).values({ key: `salt_stock:${w.tenantId}`, value: { entries: [{ id: 'x', kind: 'count', at: ago(48), tons: 10 }] } });
    const [main] = await yardsFor(w.tenantId);
    expect((await yardsFor(w.tenantId)).map((y) => y.id)).toEqual([main!.id]);
    expect((await serviceDb().select().from(salt_ledger).where(eq(salt_ledger.yard_id, main!.id))).map((l) => Number(l.qty_tons))).toEqual([10]);

    // A 20-ton delivery at $1,600: $80 a ton.
    await serviceDb().insert(salt_ledger).values({ tenant_id: w.tenantId, yard_id: main!.id, qty_tons: 20, cost_cents: 160000, source: 'delivery', at: ago(40) });
    expect(await saltCostPerTon(w.tenantId)).toBe(8000);

    // A visit spreads 2 tons plus 4 bags (200 lb = 0.1 t), and one "application" that weighs nothing.
    const out = await createStorm(ctxOf(w), { name: 'Salt', routeIds: [w.routeId], crewAssignments: {} });
    const [stop] = await serviceDb().select().from(run_stop).where(eq(run_stop.storm_run_id, out.runs[0]!.id));
    const [v] = await serviceDb().insert(visit).values({ tenant_id: w.tenantId, client_uuid: randomUUID(), storm_id: out.storm.id, run_stop_id: stop!.id, site_id: stop!.site_id, crew_id: w.crewId, services: ['salt'], arrived_device_at: ago(10), salt: [{ unit: 'ton', qty: 2 }, { unit: 'bag50lb', qty: 4 }, { unit: 'application', qty: 1 }] }).returning();
    const tons = async () => (await yardStock(w.tenantId)).find((y) => y.yard.id === main!.id)!.tons;
    expect(await tons()).toBe(27.9);

    // Voided in review: the salt goes back.
    await serviceDb().insert(visit_correction).values({ tenant_id: w.tenantId, visit_id: v!.id, field: 'voided', old_value: false, new_value: true, reason: 'test', by_user: w.userId });
    expect(await tons()).toBe(30);

    // A second yard: a run loading there takes salt from it, not from the main yard.
    const [west] = await serviceDb().insert(yard).values({ tenant_id: w.tenantId, name: 'West', reorder_tons: 5 }).returning();
    await serviceDb().insert(salt_ledger).values({ tenant_id: w.tenantId, yard_id: west!.id, qty_tons: 6, source: 'count', at: ago(9) });
    await serviceDb().update(storm_run).set({ yard_id: west!.id }).where(eq(storm_run.id, out.runs[0]!.id));
    await serviceDb().insert(visit).values({ tenant_id: w.tenantId, client_uuid: randomUUID(), storm_id: out.storm.id, run_stop_id: stop!.id, site_id: stop!.site_id, crew_id: w.crewId, services: ['salt'], arrived_device_at: ago(5), salt: [{ unit: 'ton', qty: 1.5 }] });
    const all = await yardStock(w.tenantId);
    expect(all.find((y) => y.yard.id === west!.id)).toMatchObject({ tons: 4.5, low: true });
    expect(all.find((y) => y.yard.id === main!.id)).toMatchObject({ tons: 30, low: false });

    // An empty pile is a real count.
    await serviceDb().insert(salt_ledger).values({ tenant_id: w.tenantId, yard_id: west!.id, qty_tons: 0, source: 'count', at: ago(1) });
    expect((await yardStock(w.tenantId)).find((y) => y.yard.id === west!.id)!.tons).toBe(0);

    // Another company sees none of it.
    const other = await makeWorld();
    const theirs = await yardStock(other.tenantId);
    expect(theirs).toHaveLength(1);
    expect(theirs[0]!.tons).toBe(0);
  });
});
