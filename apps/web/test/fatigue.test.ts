import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, driver_position, eq, job, serviceDb, sql, storm } from '@flake/db';
import { createStorm } from '@/lib/storms';
import { fatigueCheck, fatigueFor, setFatigueLimits } from '@/lib/fatigue';
import { ctxOf, makeWorld } from './helpers';

afterAll(async () => {
  await closeDb();
});

describe('issue 235: long shifts during a storm', () => {
  it('counts a driver\'s pings across storms into one shift, flags it once per shift, and uses the company\'s limits', async () => {
    const w = await makeWorld();
    const db = serviceDb();
    const out = await createStorm(ctxOf(w) as never, { name: `Long ${Date.now()}`, routeIds: [w.routeId], crewAssignments: {} });
    const run = out.runs[0]!;
    const now = Date.now();
    // A ping every 20 minutes for the last 15 hours.
    const pings = Array.from({ length: 46 }, (_, i) => ({ tenant_id: w.tenantId, storm_run_id: run.id, crew_id: w.crewId, lat: 41.48, lon: -81.8, device_at: new Date(now - i * 20 * 60_000).toISOString() }));
    await db.insert(driver_position).values(pings);
    const f = (await fatigueFor(w.tenantId, [w.crewId], now)).get(w.crewId)!;
    expect(f.on).toBe(true);
    expect(f.on_hours).toBeGreaterThanOrEqual(15);
    expect(f.long_shift).toBe(true);
    expect((await fatigueFor(w.tenantId, [w.crew2Id], now)).get(w.crew2Id)!.on).toBe(false);

    await fatigueCheck();
    await fatigueCheck();
    const jobs = await db.select().from(job).where(sql`${job.kind} = 'notify.push' and ${job.dedupe_key} like ${`%fatigue_long:${w.crewId}:%`}`);
    expect(jobs).toHaveLength(1);

    await setFatigueLimits(w.tenantId, { warn_hours: 20, min_rest_hours: 8 });
    expect((await fatigueFor(w.tenantId, [w.crewId], now)).get(w.crewId)!.long_shift).toBe(false);
    await db.update(storm).set({ status: 'closed', closed_at: new Date().toISOString() }).where(eq(storm.id, out.storm.id));
  });
});
