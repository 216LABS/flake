import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { closeDb, crew_member, eq, serviceDb, sql, tenant, visit, withUser } from '@flake/db';
import { createStorm, ctxOf, drain, makeWorld, req } from './helpers';

afterAll(async () => {
  await drain();
  await serviceDb().execute(sql`update job set done_at = now() where done_at is null and dead_at is null`);
  await closeDb();
});

describe('issue 170: payroll export', () => {
  it('splits an employee week into regular and overtime from the phones, leaves subs out, and exports Gusto and ADP files', async () => {
    const { payrollFor } = await import('@/lib/payroll');
    const w = await makeWorld();
    const tz = 'America/New_York';
    await serviceDb().update(crew_member).set({ pay_regular_cents: 2000, payroll_id: 'E-1' }).where(eq(crew_member.id, w.crewId));
    const out = await createStorm(ctxOf(w), { name: 'Big week', routeIds: [w.routeId], crewAssignments: {} });
    // Three long shifts in one workweek (Sun Jan 3 - Sat Jan 9, 2027): 16 + 16 + 12 = 44 hours.
    const shift = async (crewId: string, startIso: string, hours: number) => {
      const start = Date.parse(startIso);
      // A tap about every hour, the way a working phone sends them; two hours quiet would end the shift.
      for (let i = 0; i <= hours; i++) {
        const t = start + i * 3_600_000;
        await serviceDb().insert(visit).values({ tenant_id: w.tenantId, client_uuid: randomUUID(), storm_id: out.storm.id, site_id: w.siteIds[0]!, crew_id: crewId, services: ['plow'], arrived_device_at: new Date(t).toISOString(), departed_device_at: new Date(Math.min(t + 60_000, start + hours * 3_600_000)).toISOString() });
      }
    };
    await shift(w.crewId, '2027-01-04T08:00:00Z', 16);
    await shift(w.crewId, '2027-01-06T08:00:00Z', 16);
    await shift(w.crewId, '2027-01-08T08:00:00Z', 12);
    await shift(w.crew2Id, '2027-01-05T08:00:00Z', 10); // a sub

    const rows = await withUser(w.userId, (tx) => payrollFor(tx, tz, {}, '2027-01-03', '2027-01-09'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'Crew One', payroll_id: 'E-1', ot: 4 });
    expect(rows[0]!.regular).toBe(40);
    expect(rows[0]!.amount_cents).toBe(Math.round(40 * 2000 + 4 * 3000));

    const auth = await import('@/lib/auth');
    const [t] = await serviceDb().select().from(tenant).where(eq(tenant.id, w.tenantId));
    const spy = vi.spyOn(auth, 'requireApi').mockResolvedValue({ userId: w.userId, tenantId: w.tenantId, role: 'owner', tenant: { ...t, payroll: { adp_co_code: 'AB1' } } } as never);
    const { GET } = await import('@/app/api/reports/payroll/route');
    const gusto = await (await GET(req('/api/reports/payroll?from=2027-01-03&to=2027-01-09&format=gusto'), {} as never)).text();
    expect(gusto.split('\r\n')[1]).toBe('E-1,Crew,One,40.00,4.00,0.00');
    const adp = await (await GET(req('/api/reports/payroll?from=2027-01-03&to=2027-01-09&format=adp'), {} as never)).text();
    expect(adp.split('\r\n')[1]).toBe('AB1,270109,E-1,Crew One,40.00,4.00,,,,');
    expect(gusto + adp).not.toContain('Crew Two');
    spy.mockRestore();
  });
});
