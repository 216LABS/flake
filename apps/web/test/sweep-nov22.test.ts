import { afterAll, describe, expect, it } from 'vitest';
import { and, closeDb, contract, eq, run_stop, serviceDb, site, storm, storm_run, weather_snapshot } from '@flake/db';
import { createStorm, declinedLots } from '@/lib/storms';
import { mapNewLots } from '@/lib/weather';
import { withUser } from '@flake/db';
import { ctxOf, makeWorld } from './helpers';

afterAll(async () => {
  await closeDb();
});

describe('issue 218: a lot whose quote was declined', () => {
  it('stays off a new storm while nothing is signed, and goes back on once a contract is', async () => {
    const w = await makeWorld();
    const db = serviceDb();
    // Site B on route 2: quoted and declined, nothing signed.
    const declined = w.siteIds.at(-1)!;
    await db.insert(contract).values({ tenant_id: w.tenantId, site_id: declined, season: '2026-27', status: 'declined', services: [{ service: 'plow', trigger_in: 2, pricing: { type: 'per_push', amount_cents: 9000 } }] });
    expect([...(await withUser(w.userId, (tx) => declinedLots(tx, w.siteIds)))]).toEqual([declined]);
    const out = await createStorm(ctxOf(w) as never, { name: `Declined ${Date.now()}`, routeIds: [w.routeId, w.route2Id], crewAssignments: {} });
    expect(out.left_declined).toBe(1);
    const stops = await db.select({ site_id: run_stop.site_id }).from(run_stop).innerJoin(storm_run, eq(storm_run.id, run_stop.storm_run_id)).where(eq(storm_run.storm_id, out.storm.id));
    expect(stops.map((s) => s.site_id)).not.toContain(declined);
    expect(stops).toHaveLength(w.siteIds.length - 1);
    await db.update(storm).set({ status: 'closed', closed_at: new Date().toISOString() }).where(eq(storm.id, out.storm.id));

    // A route of only declined lots says why there's nothing to plow.
    await expect(createStorm(ctxOf(w) as never, { name: `Only declined ${Date.now()}`, routeIds: [w.route2Id], crewAssignments: {} })).rejects.toThrow(/declined quote/);

    // Signed later: back on storms.
    await db.insert(contract).values({ tenant_id: w.tenantId, site_id: declined, season: '2026-27', status: 'accepted', services: [{ service: 'plow', trigger_in: 2, pricing: { type: 'per_push', amount_cents: 9000 } }] });
    expect((await withUser(w.userId, (tx) => declinedLots(tx, [declined]))).size).toBe(0);
    const again = await createStorm(ctxOf(w) as never, { name: `Signed ${Date.now()}`, routeIds: [w.route2Id], crewAssignments: {} });
    expect(again.left_declined).toBe(0);
    await db.update(storm).set({ status: 'closed', closed_at: new Date().toISOString() }).where(eq(storm.id, again.storm.id));
  });
});

describe('issue 224: new lots get their forecast area right away', () => {
  it('maps a company\'s unmapped lots, fetches their forecast cell, and leaves mapped lots alone', async () => {
    const w = await makeWorld();
    const db = serviceDb();
    await db.update(site).set({ nws_office: null, nws_grid_x: null, nws_grid_y: null, nws_mapped_at: null }).where(eq(site.tenant_id, w.tenantId));
    await mapNewLots(w.tenantId);
    const rows = await db.select({ office: site.nws_office, x: site.nws_grid_x, y: site.nws_grid_y, at: site.nws_mapped_at }).from(site).where(eq(site.tenant_id, w.tenantId));
    expect(rows.every((r) => r.office && r.at)).toBe(true);
    const r = rows[0]!;
    const snaps = await db.select({ id: weather_snapshot.id }).from(weather_snapshot).where(and(eq(weather_snapshot.source, 'nws_grid'), eq(weather_snapshot.office, r.office!), eq(weather_snapshot.grid_x, r.x!), eq(weather_snapshot.grid_y, r.y!)));
    expect(snaps.length).toBeGreaterThan(0);
  });
});
