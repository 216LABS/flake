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
    expect(dup.map((r) => r.problem)).toEqual([null, 'Same lot as #1.', null]);
    const semi = customersFromCsv('Name;Address;Kind\n"Smith; Jo";12 Elm St, Lakewood OH;HOA');
    expect(semi.missing).toEqual([]);
    expect(semi.rows[0]).toMatchObject({ name: 'Smith; Jo', address: '12 Elm St, Lakewood OH', kind: 'HOA', problem: null });
  });
});

describe('a crew join link after the driver joins (issue 133)', () => {
  it('a second post cannot change the email, and a new link from the office is a fresh invite', async () => {
    const { crew_member } = await import('@flake/db');
    const { hashToken } = await import('@/lib/tokens');
    const { jsonReq } = await import('./helpers');
    const { POST: join } = await import('@/app/api/join/[token]/route');
    const w = await makeWorld();
    const db = serviceDb();
    const token = `t-${Date.now()}`;
    await db.update(crew_member).set({ invite_token_hash: hashToken(token), joined_at: null }).where(eq(crew_member.id, w.crewId));
    const post = (email: string) => join(jsonReq(`/api/join/${token}`, { consent: false, email }), { params: Promise.resolve({ token }) });
    expect((await post('driver@example.com')).status).toBe(200);
    const again = await post('someone-else@example.com');
    expect(again.status).toBe(409);
    expect((await db.select().from(crew_member).where(eq(crew_member.id, w.crewId)))[0]!.email).toBe('driver@example.com');
    // The office sends a new link: the driver can join again with it.
    await db.update(crew_member).set({ invite_token_hash: hashToken(`${token}2`), joined_at: null }).where(eq(crew_member.id, w.crewId));
    expect((await join(jsonReq(`/api/join/${token}2`, { consent: false, email: 'new@example.com' }), { params: Promise.resolve({ token: `${token}2` }) })).status).toBe(200);
  });
});

describe('quote and site input that would bill wrongly (issues 125, 126)', () => {
  it('refuses a service twice, tiers out of order, a season outside this or next, and an impossible window', async () => {
    const { quoteCreate, quotableSeasons, rateCardSchema, siteCreate } = await import('@flake/contracts');
    const [now, next] = quotableSeasons();
    const base = { site_id: '00000000-0000-4000-8000-000000000001', season: now, send: false };
    const plow = (cents: number) => ({ service: 'plow' as const, trigger_in: 2, pricing: { type: 'per_push' as const, amount_cents: cents } });
    const twice = quoteCreate.safeParse({ ...base, services: [plow(5000), plow(7000)] });
    expect(twice.success).toBe(false);
    expect(twice.error!.issues[0]!.message).toBe('Plow is listed twice. Give each service one price.');
    expect(quoteCreate.safeParse({ ...base, services: [plow(5000)] }).success).toBe(true);
    const tiers = (t: { up_to_in: number | null; amount_cents: number }[]) => quoteCreate.safeParse({ ...base, services: [{ service: 'plow', pricing: { type: 'per_inch_tier', tiers: t } }] }).success;
    expect(tiers([{ up_to_in: 2, amount_cents: 4000 }, { up_to_in: 6, amount_cents: 9000 }, { up_to_in: null, amount_cents: 12000 }])).toBe(true);
    expect(tiers([{ up_to_in: 6, amount_cents: 9000 }, { up_to_in: 2, amount_cents: 4000 }])).toBe(false);
    expect(tiers([{ up_to_in: 2, amount_cents: 4000 }, { up_to_in: null, amount_cents: 12000 }, { up_to_in: null, amount_cents: 1 }])).toBe(false);
    expect(tiers([{ up_to_in: null, amount_cents: 12000 }, { up_to_in: 2, amount_cents: 4000 }])).toBe(false);
    expect(rateCardSchema.shape.tiers.safeParse([{ up_to_in: 4, multiplier: 1 }, { up_to_in: 4, multiplier: 2 }]).success).toBe(false);
    expect(quoteCreate.safeParse({ ...base, season: next, services: [plow(5000)] }).success).toBe(true);
    for (const bad of ['1999-00', '2016-17', '2062-63']) {
      const r = quoteCreate.safeParse({ ...base, season: bad, services: [plow(5000)] });
      expect(r.success).toBe(false);
      expect(r.error!.issues[0]!.message).toBe(`Quotes are for ${now} or ${next}.`);
    }
    const site = { customer_id: base.site_id, label: 'L', address: '1 Main St', lat: 41.48, lon: -81.8 };
    expect(siteCreate.safeParse({ ...site, service_window: { open_by: '06:00', not_before: '09:00' } }).success).toBe(false);
    const days = siteCreate.safeParse({ ...site, service_window: { days: ['mon', 'xyz'] } });
    expect(days.success).toBe(false);
    const { readableIssue } = await import('@/lib/issues');
    expect(readableIssue(days.error!.issues[0]!)).toBe('Days have to be mon, tue, wed, thu, fri, sat or sun.');
    expect(siteCreate.safeParse({ ...site, service_window: { open_by: '09:00', not_before: '06:00', days: ['mon', 'sat'] } }).success).toBe(true);
  });
});

describe('error wording for fields people never see the name of (issue 135)', () => {
  it('terms, sub pay and the agree box read as plain sentences', async () => {
    const { quoteAccept, contractCreate, crewCreate } = await import('@flake/contracts');
    const { readableIssue } = await import('@/lib/issues');
    const say = (r: { success: boolean; error?: { issues: unknown[] } }) => (r.error!.issues as Parameters<typeof readableIssue>[0][]).map(readableIssue).join(' ');
    expect(say(quoteAccept.safeParse({ name: 'Pat', agree: false }))).toContain('Tick the box to agree to the terms.');
    expect(say(contractCreate.safeParse({ site_id: '00000000-0000-4000-8000-000000000001', season: '2026-27', services: [{ service: 'plow' }], terms_md: 'x'.repeat(20001) }))).toContain('The terms must be 20,000 characters or fewer.');
    expect(say(crewCreate.safeParse({ name: 'S', kind: 'sub', sub_rate_card: { per_visit_cents: -1 } }))).toContain('Pay per visit must be at least $0.00.');
  });
});

describe('crew join links expire after two weeks (issue 137)', () => {
  it('a new link carries its time and stops working after 14 days; an old link without one still works', async () => {
    const { crew_member } = await import('@flake/db');
    const { hashToken, newInviteToken, inviteExpired } = await import('@/lib/tokens');
    const { jsonReq } = await import('./helpers');
    const { POST: join } = await import('@/app/api/join/[token]/route');
    const now = Date.now();
    expect(inviteExpired(newInviteToken(now - 13 * 86_400_000), now)).toBe(false);
    expect(inviteExpired(newInviteToken(now - 15 * 86_400_000), now)).toBe(true);
    expect(inviteExpired('legacyTokenWithoutTime_abc', now)).toBe(false);
    const w = await makeWorld();
    const old = newInviteToken(now - 15 * 86_400_000);
    await serviceDb().update(crew_member).set({ invite_token_hash: hashToken(old), joined_at: null }).where(eq(crew_member.id, w.crewId));
    expect((await join(jsonReq(`/api/join/${old}`, { consent: false }), { params: Promise.resolve({ token: old }) })).status).toBe(410);
  });
});
