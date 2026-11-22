import { afterAll, describe, expect, it } from 'vitest';
import { and, closeDb, crew_member, eq, message_log, serviceDb, site, sql, storm, storm_run, tenant } from '@flake/db';
import { createStorm } from '@/lib/storms';
import { claimOffer, driverStatus, handoffsFor, noShowCheck, offerRun, setStandby } from '@/lib/noshow';
import { consent, ctxOf, drain, makeWorld, uuid } from './helpers';

afterAll(async () => {
  await closeDb();
});

describe('issue 234: driver no-shows', () => {
  it('reads a run\'s driver in one word', () => {
    expect(driverStatus({ crew: false, reply: null, asked: false, opened: false })).toBe('no_driver');
    expect(driverStatus({ crew: true, reply: 'YES', asked: true, opened: false })).toBe('confirmed');
    expect(driverStatus({ crew: true, reply: 'YES', asked: true, opened: true })).toBe('opened');
    expect(driverStatus({ crew: true, reply: 'NO', asked: true, opened: true })).toBe('declined');
    expect(driverStatus({ crew: true, reply: null, asked: true, opened: false })).toBe('no_reply');
    expect(driverStatus({ crew: true, reply: null, asked: false, opened: false })).toBe('not_opened');
    expect(driverStatus({ crew: true, reply: null, asked: false, opened: true })).toBe('opened');
  });

  it('offers a run to standbys; the first YES gets it, the next hears it is taken, and the hand-off is logged', async () => {
    const w = await makeWorld({ smsApproved: true });
    const db = serviceDb();
    const standbyA = uuid();
    const standbyB = uuid();
    await db.insert(crew_member).values([
      { id: standbyA, tenant_id: w.tenantId, name: 'Standby A', kind: 'employee', phone_e164: '+12165550193' },
      { id: standbyB, tenant_id: w.tenantId, name: 'Standby B', kind: 'employee', phone_e164: '+12165550194', language: 'es' },
    ]);
    for (const p of ['+12165550193', '+12165550194']) await consent(w.tenantId, p);
    const out = await createStorm(ctxOf(w) as never, { name: `Offer ${Date.now()}`, routeIds: [w.routeId], crewAssignments: {} });
    const runId = out.runs[0]!.id;
    await expect(offerRun(w.tenantId, runId)).rejects.toThrow(/standby/);
    await setStandby(w.tenantId, out.storm.id, [standbyA, standbyB]);
    expect((await offerRun(w.tenantId, runId)).sent).toBe(2);
    const [t] = await db.select().from(tenant).where(eq(tenant.id, w.tenantId));
    const won = await claimOffer(t!, standbyB);
    expect(won).toContain('es tuya');
    expect((await db.select({ crew: storm_run.crew_id }).from(storm_run).where(eq(storm_run.id, runId)))[0]!.crew).toBe(standbyB);
    expect(await claimOffer(t!, standbyA)).toContain('is taken');
    expect((await db.select({ crew: storm_run.crew_id }).from(storm_run).where(eq(storm_run.id, runId)))[0]!.crew).toBe(standbyB);
    const taken = await db.select().from(message_log).where(and(eq(message_log.tenant_id, w.tenantId), eq(message_log.template, 'offer_taken')));
    expect(taken.map((m) => m.to_addr)).toEqual(['+12165550193']);
    expect(await handoffsFor(w.tenantId, out.storm.id)).toEqual([expect.objectContaining({ run_id: runId, from: w.crewId, to: standbyB, how: 'offer' })]);
    await db.update(storm).set({ status: 'closed', closed_at: new Date().toISOString() }).where(eq(storm.id, out.storm.id));
  });

  it('alerts the office once when a run is unanswered close to its first open-by, and not for an opened run', async () => {
    const w = await makeWorld();
    const db = serviceDb();
    const out = await createStorm(ctxOf(w) as never, { name: `No show ${Date.now()}`, routeIds: [w.routeId, w.route2Id], crewAssignments: {} });
    await db.update(storm_run).set({ published_at: new Date().toISOString() }).where(eq(storm_run.storm_id, out.storm.id));
    // Every lot is due 10 minutes from now, local time; route B's driver opened their link.
    const hm = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/New_York' }).format(new Date(Date.now() + 10 * 60000));
    await db.update(site).set({ service_window: { open_by: hm } }).where(eq(site.tenant_id, w.tenantId));
    await db.update(storm).set({ started_at: new Date(Date.now() - 3600000).toISOString() }).where(eq(storm.id, out.storm.id));
    await db.update(storm_run).set({ link_opened_at: new Date().toISOString() }).where(and(eq(storm_run.storm_id, out.storm.id), eq(storm_run.route_id, w.route2Id)));
    expect((await noShowCheck()).alerted).toBeGreaterThanOrEqual(1);
    await noShowCheck();
    await drain();
    const alerts = await db.select().from(message_log).where(and(eq(message_log.tenant_id, w.tenantId), eq(message_log.template, 'owner_alert'), sql`${message_log.idempotency_key} like '%noshow:%'`));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.body).toContain('Route A');
    await db.update(storm).set({ status: 'closed', closed_at: new Date().toISOString() }).where(eq(storm.id, out.storm.id));
  });
});
