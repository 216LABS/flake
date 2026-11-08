import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb, eq, job, message_log, run_stop, serviceDb, sql, storm } from '@flake/db';
import { lateCheck } from '@/lib/handlers';
import { processActions, resolveToken } from '@/lib/driver';
import { createStorm, publishStorm } from '@/lib/storms';
import { decryptToken } from '@/lib/tokens';
import { ctxOf, drain, makeWorld, stopActions, type World } from './helpers';

// Noon in Cleveland on a storm day; the storm started at 3 AM. Site 2 must be open by 6 AM.
const NOON = Date.parse('2026-01-20T17:00:00Z');
const STARTED = '2026-01-20T08:00:00Z';

const lateJobs = (stormId: string) => serviceDb().select().from(job).where(sql`${job.kind} = 'notify.push' and ${job.dedupe_key} like ${`%late:${stormId}:%`}`);
const lateEmails = (stormId: string) => serviceDb().select().from(message_log).where(sql`${message_log.template} = 'owner_alert' and ${message_log.idempotency_key} like ${`%late_alert:${stormId}:%`}`);

afterAll(() => closeDb());
afterEach(() => vi.restoreAllMocks());

describe('late site alerts', () => {
  let w: World;
  beforeAll(async () => {
    w = await makeWorld();
  });

  async function storming(publish: boolean) {
    const ctx = ctxOf(w);
    const out = await createStorm(ctx, { name: `Late ${Date.now()}`, routeIds: [w.routeId], crewAssignments: {} });
    if (publish) await publishStorm(ctx, out.storm.id);
    await serviceDb().update(storm).set({ started_at: STARTED }).where(eq(storm.id, out.storm.id));
    return out;
  }

  it('tells the office once about a stop past its open-by time, however often the check runs', async () => {
    const out = await storming(true);
    vi.spyOn(Date, 'now').mockReturnValue(NOON);
    const first = await lateCheck();
    expect(first.late).toBeGreaterThanOrEqual(1);
    await lateCheck();
    await lateCheck();
    expect(await lateJobs(out.storm.id)).toHaveLength(1);
    await drain();
    const emails = await lateEmails(out.storm.id);
    expect(emails.length).toBe(1);
    expect(emails[0]!.idempotency_key).toContain(w.siteIds[2]!);
  });

  it('an email outage cannot stop the check for everyone else', async () => {
    const out = await storming(true);
    vi.spyOn(Date, 'now').mockReturnValue(NOON);
    const providers = await import('@/lib/providers');
    const real = await providers.getProviders();
    vi.spyOn(providers, 'getProviders').mockResolvedValue({ ...real, email: { send: async () => { throw new Error('email down'); } } } as never);
    await expect(lateCheck()).resolves.toMatchObject({ late: expect.any(Number) });
    expect(await lateJobs(out.storm.id)).toHaveLength(1);
  });

  it('says nothing before the deadline, for a finished stop, or for a run nobody has been sent', async () => {
    const early = await storming(true);
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-01-20T10:30:00Z')); // 5:30 AM
    await lateCheck();
    expect(await lateJobs(early.storm.id)).toHaveLength(0);
    vi.restoreAllMocks();

    const done = await storming(true);
    const run = done.runs[0]!;
    const rs = await resolveToken(decryptToken(run.link_token_enc!));
    const stop = (await serviceDb().select().from(run_stop).where(eq(run_stop.storm_run_id, run.id))).find((s) => s.site_id === w.siteIds[2])!;
    await processActions(rs, stopActions(stop.id, new Date('2026-01-20T10:00:00Z'), { depth: 3, minutes: 30 }).actions as never);

    const unsent = await storming(false);
    vi.spyOn(Date, 'now').mockReturnValue(NOON);
    await lateCheck();
    expect(await lateJobs(done.storm.id)).toHaveLength(0);
    expect(await lateJobs(unsent.storm.id)).toHaveLength(0);
  });
});
