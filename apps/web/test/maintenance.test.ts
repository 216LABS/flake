import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { closeDb, eq, equipment_log, maintenance_item, run_stop, serviceDb, sql, storm_run, truck, visit, withUser } from '@flake/db';
import { createStorm, ctxOf, drain, makeWorld, req } from './helpers';

afterAll(async () => {
  await drain();
  await serviceDb().execute(sql`update job set done_at = now() where done_at is null and dead_at is null`);
  await closeDb();
});

describe('issue 161: maintenance reminders', () => {
  it('counts meter hours plus storm runs, shows due soon and overdue, and Mark done resets it and logs the service', async () => {
    const auth = await import('@/lib/auth');
    const { listMaintenance } = await import('@/lib/maintenance');
    const w = await makeWorld();
    const [t] = await serviceDb().insert(truck).values({ tenant_id: w.tenantId, name: 'Truck 3' }).returning();
    const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
    await serviceDb().insert(equipment_log).values({ tenant_id: w.tenantId, truck_id: t!.id, kind: 'hours', hours: 1220, at: hoursAgo(48) });

    const spy = vi.spyOn(auth, 'requireApi').mockResolvedValue({ userId: w.userId, tenantId: w.tenantId, role: 'owner' } as never);
    const { POST } = await import('@/app/api/maintenance/route');
    const { PATCH } = await import('@/app/api/maintenance/[id]/route');
    const made = await POST(req('/api/maintenance', { method: 'POST', body: JSON.stringify({ truck_id: t!.id, name: 'Oil change', every_hours: 250, last_done_hours: 1000 }) }), {} as never);
    expect(made.status).toBe(200);
    const item = await made.json();
    expect((await POST(req('/api/maintenance', { method: 'POST', body: JSON.stringify({ truck_id: t!.id, name: 'Nothing set' }) }), {} as never)).status).toBe(422);

    const list = () => withUser(w.userId, (tx) => listMaintenance(tx));
    // 220 h used: fine.
    expect((await list())[0]!.status).toMatchObject({ state: 'ok', detail: '220 of 250 h', meter: 1220 });

    // A 6-hour storm run on this truck after the reading: 226 h, due soon.
    const out = await createStorm(ctxOf(w), { name: 'Hours', routeIds: [w.routeId], crewAssignments: {} });
    await serviceDb().update(storm_run).set({ truck_id: t!.id }).where(eq(storm_run.storm_id, out.storm.id));
    const [stop] = await serviceDb().select().from(run_stop).where(eq(run_stop.storm_run_id, out.runs[0]!.id));
    await serviceDb().insert(visit).values([
      { tenant_id: w.tenantId, client_uuid: randomUUID(), storm_id: out.storm.id, run_stop_id: stop!.id, site_id: stop!.site_id, crew_id: w.crewId, services: ['plow'], arrived_device_at: hoursAgo(10), departed_device_at: hoursAgo(9.5) },
      { tenant_id: w.tenantId, client_uuid: randomUUID(), storm_id: out.storm.id, run_stop_id: stop!.id, site_id: stop!.site_id, crew_id: w.crewId, services: ['plow'], arrived_device_at: hoursAgo(5), departed_device_at: hoursAgo(4) },
    ]);
    expect((await list())[0]!.status).toMatchObject({ state: 'soon', meter: 1226 });

    // Another reading past 1,250: overdue, on the dashboard list too.
    await serviceDb().insert(equipment_log).values({ tenant_id: w.tenantId, truck_id: t!.id, kind: 'hours', hours: 1253, at: hoursAgo(1) });
    expect((await list())[0]!.status).toMatchObject({ state: 'overdue', detail: '3 h overdue' });

    // Mark done: starts again from the meter now, and the service is in the log.
    const done = await PATCH(req(`/api/maintenance/${item.id}`, { method: 'PATCH', body: JSON.stringify({ done: true }) }), { params: Promise.resolve({ id: item.id }) });
    expect(done.status).toBe(200);
    expect((await list())[0]!.status).toMatchObject({ state: 'ok', detail: '0 of 250 h' });
    const logged = await serviceDb().select().from(equipment_log).where(eq(equipment_log.truck_id, t!.id));
    expect(logged.some((l) => l.kind === 'maintenance' && l.note === 'Oil change')).toBe(true);
    spy.mockRestore();

    // Another company never sees it, and a viewer can't add one.
    const other = await makeWorld();
    expect(await withUser(other.userId, (tx) => listMaintenance(tx))).toEqual([]);
    await expect(withUser(other.userId, (tx) => tx.insert(maintenance_item).values({ tenant_id: other.tenantId, truck_id: t!.id, name: 'Sneaky', every_days: 30 }))).rejects.toThrow();
    await expect(withUser(w.viewerId, (tx) => tx.insert(maintenance_item).values({ tenant_id: w.tenantId, truck_id: t!.id, name: 'Viewer', every_days: 30 }))).rejects.toThrow();
  });
});
