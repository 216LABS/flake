import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, eq, serviceDb, site, sql, storm } from '@flake/db';
import { ctxOf, drain, makeWorld } from './helpers';

afterAll(async () => {
  await drain();
  await serviceDb().execute(sql`update job set done_at = now() where done_at is null and dead_at is null`);
  await closeDb();
});

describe('late lots on the storm board (issue 121)', () => {
  it('a lot past its deadline is one alert across passes, in 12-hour time, and none once the storm is closed', async () => {
    const { addPass, closeStorm, publishStorm, stormLive } = await import('@/lib/storms');
    const { createStorm } = await import('./helpers');
    const w = await makeWorld();
    const ctx = ctxOf(w);
    const db = serviceDb();
    // Due a minute after midnight, on a storm that started yesterday: late at any time of day but that one minute.
    await db.update(site).set({ service_window: { open_by: '00:01' } }).where(eq(site.id, w.siteIds[0]!));
    const out = await createStorm(ctx, { name: 'Late lots', routeIds: [w.routeId], crewAssignments: {} });
    await db.update(storm).set({ started_at: new Date(Date.now() - 26 * 3600_000).toISOString() }).where(eq(storm.id, out.storm.id));
    await publishStorm(ctx, out.storm.id);
    await addPass(ctx, out.storm.id);
    const live = await stormLive({ ...ctx, timezone: 'America/New_York', role: 'owner' }, out.storm.id);
    const late = live.alerts.filter((a) => a.kind === 'late' && a.text.startsWith('Site 0 '));
    expect(late, JSON.stringify(late)).toHaveLength(1);
    expect(late[0]!.text).toBe('Site 0 is past its 12:01 AM deadline');
    expect(live.alerts.some((a) => a.text === 'Site 2 is past its 6:00 AM deadline') || new Date().getHours() < 6).toBe(true);
    await closeStorm(ctx, out.storm.id, true);
    const after = await stormLive({ ...ctx, timezone: 'America/New_York', role: 'owner' }, out.storm.id);
    expect(after.alerts.filter((a) => a.kind === 'late')).toEqual([]);
    expect(after.counts.late).toBe(0);
  });
});

describe('seasonal prices in words (issue 120)', () => {
  it('the plan names each installment, an uneven split, and when the first is billed', async () => {
    const { seasonalPlan, paymentText, billedBy } = await import('@/lib/scope');
    const nov = new Date('2026-11-14T15:00:00Z');
    expect(seasonalPlan({ total_cents: 90000, installments: 5 })).toBe('$900.00 for the season: 5 monthly installments of $180.00');
    expect(seasonalPlan({ total_cents: 100000, installments: 3 })).toBe('$1,000.00 for the season: 3 monthly installments of $333.34 then $333.33');
    expect(seasonalPlan({ total_cents: 50000, installments: 1 })).toBe('$500.00 for the season: one installment of $500.00');
    expect(seasonalPlan({ total_cents: 90000, installments: 5 }, '2026-27', nov)).toMatch(/the first in the month you sign$/);
    expect(seasonalPlan({ total_cents: 90000, installments: 5 }, '2027-28', nov)).toMatch(/the first in July 2027$/);
    const seasonal = { services: [{ service: 'plow', pricing: { type: 'seasonal' } }] };
    const push = { services: [{ service: 'plow', pricing: { type: 'per_push' } }] };
    expect(billedBy([seasonal])).toEqual({ perStorm: false, seasonal: true });
    expect(paymentText('card_on_file', 'Co', false, billedBy([seasonal]))).toBe('Each installment is charged to a card on file. Co will send you a secure link to add your card.');
    expect(paymentText('ach_on_file', 'Co', true, billedBy([seasonal]))).toBe('Each installment is paid from a bank account on file. You add the account after accepting.');
    expect(paymentText('manual', 'Co', true, billedBy([seasonal]))).toBe('Invoiced by Co for each installment.');
    expect(paymentText('manual', 'Co', true, billedBy([seasonal, push]))).toBe('Invoiced by Co after each storm. Seasonal prices are billed by monthly installment instead.');
    expect(paymentText('invoice_net30', 'Co')).toBe('Invoiced after each storm, due within 30 days.');
  });
});

describe('import preview edge cases (issue 123)', () => {
  it('an empty or header-only file says so, a repeated lot is left out, and semicolon files read', async () => {
    const { customersFromCsv } = await import('@/lib/csv');
    expect(customersFromCsv('').empty).toBe(true);
    expect(customersFromCsv('name,address\n').empty).toBe(true);
    const dup = customersFromCsv('name,address\nQA dupe,1 Main St Lakewood OH\nqa dupe,1 main st  lakewood oh\nQA dupe,2 Main St Lakewood OH').rows;
    expect(dup.map((r) => r.problem)).toEqual([null, 'Same lot as row 2.', null]);
    const semi = customersFromCsv('Name;Address;Kind\n"Smith; Jo";12 Elm St, Lakewood OH;HOA');
    expect(semi.missing).toEqual([]);
    expect(semi.rows[0]).toMatchObject({ name: 'Smith; Jo', address: '12 Elm St, Lakewood OH', kind: 'HOA', problem: null });
  });
});
