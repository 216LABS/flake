import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, crew_member, eq, run_stop, serviceDb, sql, storm, visit, visit_correction, withUser } from '@flake/db';
import { createStorm, ctxOf, drain, makeWorld, stopActions } from './helpers';

afterAll(async () => {
  await drain();
  await serviceDb().execute(sql`update job set done_at = now() where done_at is null and dead_at is null`);
  await closeDb();
});

/** A storm on Route A run by the sub, with `n` lots finished. */
async function subStorm(w: Awaited<ReturnType<typeof makeWorld>>, n: number) {
  const { processActions, resolveToken } = await import('@/lib/driver');
  const { decryptToken } = await import('@/lib/tokens');
  const out = await createStorm(ctxOf(w), { name: `Sub storm ${randomUUID().slice(0, 4)}`, routeIds: [w.routeId], crewAssignments: { [w.routeId]: w.crew2Id } });
  const rs = await resolveToken(decryptToken(out.runs[0]!.link_token_enc!));
  const stops = (await serviceDb().select().from(run_stop).where(eq(run_stop.storm_run_id, out.runs[0]!.id))).sort((a, b) => a.seq - b.seq);
  const visits: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = stopActions(stops[i]!.id, new Date(Date.now() - (90 - i * 10) * 60_000), { minutes: 5 });
    await processActions(rs, a.actions);
    visits.push(a.visit);
  }
  await serviceDb().update(storm).set({ status: 'closed', closed_at: new Date().toISOString() }).where(eq(storm.id, out.storm.id));
  return { stormId: out.storm.id, visits };
}

describe('sub pay across storms (issue 160)', () => {
  it('adds up storms the same way each storm\'s page does, skips an undone visit, and keeps subs out of payroll hours', async () => {
    const { subPayReport, crewHours, period } = await import('@/lib/reports');
    const w = await makeWorld({ plan: 'pro' });
    await serviceDb().update(crew_member).set({ sub_rate_card: { per_visit_cents: 5000 } }).where(eq(crew_member.id, w.crew2Id));
    await subStorm(w, 3);
    const b = await subStorm(w, 3);
    // One of storm B's visits is undone: not paid.
    const [undone] = await serviceDb().select().from(visit).where(eq(visit.client_uuid, b.visits[2]!));
    await serviceDb().insert(visit_correction).values({ tenant_id: w.tenantId, visit_id: undone!.id, field: 'voided', old_value: false, new_value: true, reason: 'Wrong lot', by_user: w.userId });
    const tz = 'America/New_York';
    const today = new Date().toLocaleDateString('en-CA', { timeZone: tz });
    const p = period(today, today, tz);
    const [row] = await withUser(w.userId, (tx) => subPayReport(tx, p));
    expect([row!.name, row!.visits, row!.total_cents, row!.storms.map((s) => s.total_cents).sort()]).toEqual(['Crew Two', 5, 25000, [10000, 15000]]);
    // Payroll hours list employees only by default; the sub is on Sub pay.
    const hours = await withUser(w.userId, (tx) => crewHours(tx, p, tz));
    expect(hours.some((h) => h.kind === 'sub')).toBe(true);
    const { GET } = await import('@/app/api/reports/hours.csv/route');
    const auth = await import('@/lib/auth');
    const { vi } = await import('vitest');
    const spy = vi.spyOn(auth, 'requireApi').mockResolvedValue({ userId: w.userId, tenantId: w.tenantId, role: 'owner', tenant: { timezone: tz, plan: 'pro', free_season_until: null } } as never);
    const { req } = await import('./helpers');
    const csv = await (await GET(req(`/api/reports/hours.csv?from=${today}&to=${today}`), {} as never)).text();
    expect(csv).not.toContain('Crew Two');
    expect(await (await GET(req(`/api/reports/hours.csv?from=${today}&to=${today}&subs=1`), {} as never)).text()).toContain('Crew Two');
    // The sub pay CSV total matches the screen.
    const { GET: subCsv } = await import('@/app/api/reports/subpay.csv/route');
    const out = await (await subCsv(req(`/api/reports/subpay.csv?from=${today}&to=${today}`), {} as never)).text();
    expect(out).toContain('Crew Two,Total,5,250.00');
    spy.mockRestore();
  });

  it('a flat rate per storm is one line per storm, and a season rate is paid in five months', async () => {
    const { subPayStatement, seasonFlatMonths } = await import('@flake/core/subpay');
    const v = (id: string) => ({ id, site_label: 'Lot', arrived_at: '2026-11-14T10:00:00Z', departed_at: '2026-11-14T10:20:00Z', salt: null });
    expect(subPayStatement({ flat_per_storm_cents: 30000 }, [v('a'), v('b'), v('c')]).total_cents).toBe(30000);
    expect(subPayStatement({ flat_per_storm_cents: 30000 }, []).total_cents).toBe(0);
    expect(seasonFlatMonths(250001)).toEqual([50001, 50000, 50000, 50000, 50000]);
    const { subPayReport, period } = await import('@/lib/reports');
    const w = await makeWorld({ plan: 'pro' });
    await serviceDb().update(crew_member).set({ sub_rate_card: { flat_per_season_cents: 500000 } }).where(eq(crew_member.id, w.crew2Id));
    const winter = await withUser(w.userId, (tx) => subPayReport(tx, period('2026-11-01', '2027-01-31', 'America/New_York')));
    expect(winter.find((r) => r.name === 'Crew Two')?.season_cents).toBe(300000);
    // Off the crew: no more season months.
    await serviceDb().update(crew_member).set({ active: false }).where(eq(crew_member.id, w.crew2Id));
    expect((await withUser(w.userId, (tx) => subPayReport(tx, period('2027-02-01', '2027-03-31', 'America/New_York')))).find((r) => r.name === 'Crew Two')).toBeUndefined();
  });
});
