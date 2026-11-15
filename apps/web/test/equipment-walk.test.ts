import sharp from 'sharp';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { closeDb, eq, equipment_log, route, serviceDb, site_walk_item, sql, storm, storm_run, truck, withUser } from '@flake/db';
import { createStorm, ctxOf, drain, makeWorld, req } from './helpers';

afterAll(async () => {
  await drain();
  await serviceDb().execute(sql`update job set done_at = now() where done_at is null and dead_at is null`);
  await closeDb();
});

describe('trucks on routes and storms', () => {
  it('a route\'s default truck rides into the storm and the next pass, a retired truck is refused, and another company\'s is blocked', async () => {
    const { addPass, assignRunTruck } = await import('@/lib/storms');
    const w = await makeWorld();
    const ctx = ctxOf(w);
    const [t3] = await withUser(w.userId, (tx) => tx.insert(truck).values({ tenant_id: w.tenantId, name: 'Truck 3' }).returning());
    const [old] = await withUser(w.userId, (tx) => tx.insert(truck).values({ tenant_id: w.tenantId, name: 'Old 1', active: false }).returning());
    await withUser(w.userId, (tx) => tx.update(route).set({ default_truck_id: t3!.id }).where(eq(route.id, w.routeId)));
    const out = await createStorm(ctx, { name: 'Trucks', routeIds: [w.routeId], crewAssignments: {} });
    expect(out.runs[0]!.truck_id).toBe(t3!.id);
    const pass = await addPass(ctx, out.storm.id);
    expect(pass.runs[0]!.truck_id).toBe(t3!.id);
    await expect(assignRunTruck(ctx, out.runs[0]!.id, old!.id)).rejects.toMatchObject({ code: 'inactive_truck' });
    expect((await assignRunTruck(ctx, out.runs[0]!.id, null)).truck_id).toBeNull();
    // Another company's truck can't be put on this run, even straight at the database.
    const other = await makeWorld();
    const [theirs] = await serviceDb().insert(truck).values({ tenant_id: other.tenantId, name: 'Theirs' }).returning();
    await expect(withUser(w.userId, (tx) => tx.update(storm_run).set({ truck_id: theirs!.id }).where(eq(storm_run.id, out.runs[0]!.id)))).rejects.toThrow();
    // And a viewer can't add a truck.
    await expect(withUser(w.viewerId, (tx) => tx.insert(truck).values({ tenant_id: w.tenantId, name: 'Viewer truck' }))).rejects.toThrow();
  });

  it('fuel, hours and maintenance roll up per truck for the period', async () => {
    const { equipmentReport, period } = await import('@/lib/reports');
    const w = await makeWorld();
    const [t] = await serviceDb().insert(truck).values({ tenant_id: w.tenantId, name: 'Plow 7' }).returning();
    const out = await createStorm(ctxOf(w), { name: 'Fuel storm', routeIds: [w.routeId], crewAssignments: {} });
    await serviceDb().update(storm_run).set({ truck_id: t!.id }).where(eq(storm_run.storm_id, out.storm.id));
    await serviceDb().insert(equipment_log).values([
      { tenant_id: w.tenantId, truck_id: t!.id, storm_id: out.storm.id, kind: 'fuel', gallons: 21.5, cost_cents: 7300 },
      { tenant_id: w.tenantId, truck_id: t!.id, kind: 'fuel', gallons: 10, cost_cents: 3400 },
      { tenant_id: w.tenantId, truck_id: t!.id, kind: 'maintenance', cost_cents: 12000, note: 'Cutting edge' },
      { tenant_id: w.tenantId, truck_id: t!.id, kind: 'hours', hours: 1022.5, at: new Date(Date.now() - 60_000).toISOString() },
    ]);
    const tz = 'America/New_York';
    const today = new Date().toLocaleDateString('en-CA', { timeZone: tz });
    const rows = await withUser(w.userId, (tx) => equipmentReport(tx, period(today, today, tz)));
    expect(rows).toEqual([{ id: t!.id, name: 'Plow 7', storms: 1, gallons: 31.5, fuel_cents: 10700, maintenance_cents: 12000, last_hours: 1022.5 }]);
    // A fuel line needs gallons, a maintenance line says what was done.
    const { equipmentLogCreate } = await import('@flake/contracts');
    expect(equipmentLogCreate.safeParse({ truck_id: t!.id, kind: 'fuel' }).success).toBe(false);
    expect(equipmentLogCreate.safeParse({ truck_id: t!.id, kind: 'maintenance' }).success).toBe(false);
  });
});

describe('the pre-season site walk', () => {
  it('saves a photo with its hash, refuses a non-photo, and shows up in the proof packet with the truck at each visit', async () => {
    const auth = await import('@/lib/auth');
    const { POST } = await import('@/app/api/sites/[id]/walk/route');
    const w = await makeWorld();
    const spy = vi.spyOn(auth, 'requireApi').mockResolvedValue({ userId: w.userId, tenantId: w.tenantId, role: 'owner' } as never);
    const { quotingSeason } = await import('@flake/core/time');
    const season = quotingSeason(new Date(), 'America/New_York');
    const post = async (fields: Record<string, string>, file?: Blob) => {
      const form = new FormData();
      for (const [k, v] of Object.entries(fields)) form.set(k, v);
      if (file) form.set('file', file, 'walk.jpg');
      return POST(req(`/api/sites/${w.siteIds[0]}/walk`, { method: 'POST', body: form }), { params: Promise.resolve({ id: w.siteIds[0]! }) });
    };
    const jpeg = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#887766' } }).jpeg().toBuffer();
    const ok = await post({ season, kind: 'damage', note: 'Cracked curb by the dumpster' }, new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }));
    expect(ok.status).toBe(201);
    const item = await ok.json();
    expect(item.photo_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await post({ season, kind: 'pile' }, new Blob(['not a photo'], { type: 'image/jpeg' }))).status).toBe(422);
    expect((await post({ season, kind: 'note' })).status).toBe(422);
    expect((await post({ season, kind: 'pile', note: 'Piles go on the north island' })).status).toBe(201);
    spy.mockRestore();
    expect((await serviceDb().select().from(site_walk_item).where(eq(site_walk_item.site_id, w.siteIds[0]!))).length).toBe(2);

    // A visit on a run with a truck, then a packet over this season.
    const { processActions, resolveToken } = await import('@/lib/driver');
    const { decryptToken } = await import('@/lib/tokens');
    const { run_stop } = await import('@flake/db');
    const { stopActions } = await import('./helpers');
    const [t] = await serviceDb().insert(truck).values({ tenant_id: w.tenantId, name: 'Truck 9' }).returning();
    const out = await createStorm(ctxOf(w), { name: 'Walk storm', routeIds: [w.routeId], crewAssignments: {} });
    await serviceDb().update(storm_run).set({ truck_id: t!.id }).where(eq(storm_run.id, out.runs[0]!.id));
    const [stop] = await serviceDb().select().from(run_stop).where(eq(run_stop.storm_run_id, out.runs[0]!.id)).orderBy(run_stop.seq).limit(1);
    await processActions(await resolveToken(decryptToken(out.runs[0]!.link_token_enc!)), stopActions(stop!.id, new Date(Date.now() - 30 * 60_000)).actions);
    const { assembleProof, renderProof } = await import('@/lib/proof');
    const input = await assembleProof(w.tenantId, w.siteIds[0]!, new Date(Date.now() - 86_400_000).toISOString(), new Date().toISOString());
    expect(input.visits[0]!.truck_name).toBe('Truck 9');
    expect(input.site_walk?.map((x) => x.kind).sort()).toEqual(['damage', 'pile']);
    const packet = await renderProof({ tenantId: w.tenantId, siteId: w.siteIds[0]!, from: new Date(Date.now() - 86_400_000).toISOString(), to: new Date().toISOString() });
    expect(packet?.pdf_path).toBeTruthy();
    await serviceDb().update(storm).set({ status: 'closed', closed_at: new Date().toISOString() }).where(eq(storm.id, out.storm.id));
  });
});
