import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { and, closeDb, crew_member, eq, invoice_draft, membership, run_stop, serviceDb, site, sql, storm_run, tenant, trigger_alert } from '@flake/db';
import { onboardTenant, routeCreate, tenantSettings } from '@flake/contracts';
import { signTwilio, MOCK_TWILIO_TOKEN } from '@flake/providers';
import { POST as joinRoute } from '@/app/api/join/[token]/route';
import { POST as tollfree } from '@/app/api/webhooks/twilio/tollfree/route';
import { approveDrafts, generateDrafts } from '@/lib/billing';
import { processActions, resolveToken } from '@/lib/driver';
import { JOB_HANDLERS } from '@/lib/handlers';
import { portalData } from '@/lib/portal';
import { createQuote } from '@/lib/quotes';
import { saltReport, period } from '@/lib/reports';
import { setSetting } from '@/lib/providers';
import { assignRunDriver, closeStorm, notifyCustomers, patchRunStop, publishStorm, reorderRun, stormLive } from '@/lib/storms';
import { createTenantForUser } from '@/lib/tenants';
import { decryptToken, hashToken } from '@/lib/tokens';
import { fetchCell, mapSites } from '@/lib/weather';
import { withUser } from '@flake/db';
import { ctxOf, jsonReq, makeWorld, req, stopActions, type World, createStorm } from './helpers';

afterAll(() => closeDb());

const newUser = async () => {
  const id = randomUUID();
  await serviceDb().execute(sql`insert into auth.users (id, email, aud, role, instance_id) values (${id}, ${`p2-${id}@flake.test`}, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000')`);
  return id;
};

async function liveStorm(w: World) {
  const ctx = ctxOf(w);
  const out = await createStorm(ctx, { name: 'Pass 2', routeIds: [w.routeId], crewAssignments: {} });
  await publishStorm(ctx, out.storm.id);
  const run = out.runs[0]!;
  const rs = await resolveToken(decryptToken(run.link_token_enc!));
  const stops = (await serviceDb().select().from(run_stop).where(eq(run_stop.storm_run_id, run.id))).sort((a, b) => a.seq - b.seq);
  return { ctx, stormId: out.storm.id, run, rs, stops };
}

describe('signing up', () => {
  it('a double tap on Continue makes one company', async () => {
    const u = await newUser();
    const name = `Double Tap ${randomUUID().slice(0, 6)}`;
    const ids = await Promise.all([createTenantForUser(u, null, name, 'America/New_York'), createTenantForUser(u, null, name, 'America/New_York')]);
    expect(ids[0]).toBe(ids[1]);
    expect(await serviceDb().select().from(membership).where(eq(membership.user_id, u))).toHaveLength(1);
  });

  it('two companies with the same name at once both get set up', async () => {
    const [a, b] = [await newUser(), await newUser()];
    const name = `Same Name ${randomUUID().slice(0, 6)}`;
    const [ta, tb] = await Promise.all([createTenantForUser(a, null, name, 'America/New_York'), createTenantForUser(b, null, name, 'America/New_York')]);
    expect(ta).not.toBe(tb);
  });

  it('a made-up time zone never reaches the database', () => {
    expect(onboardTenant.parse({ name: 'Plow Co', timezone: 'Mars/Olympus' }).timezone).toBe('America/New_York');
    expect(onboardTenant.parse({ name: 'Plow Co', timezone: 'America/Chicago' }).timezone).toBe('America/Chicago');
    expect(tenantSettings.safeParse({ timezone: 'Not/AZone' }).success).toBe(false);
    expect(tenantSettings.safeParse({ timezone: 'America/Denver' }).success).toBe(true);
  });

  it('a route lists each lot once', () => {
    const id = randomUUID();
    expect(routeCreate.parse({ name: 'R', site_ids: [id, id] }).site_ids).toEqual([id]);
  });
});

describe('crew who left', () => {
  it('an old invite link no longer joins someone who was taken off the crew', async () => {
    const w = await makeWorld();
    const token = randomUUID();
    await serviceDb().update(crew_member).set({ invite_token_hash: hashToken(token), active: false }).where(eq(crew_member.id, w.crewId));
    const res = await joinRoute(jsonReq(`/api/join/${token}`, { consent: false }), { params: Promise.resolve({ token }) });
    expect(res.status).toBe(404);
    const [c] = await serviceDb().select().from(crew_member).where(eq(crew_member.id, w.crewId));
    expect(c!.joined_at).toBeNull();
  });
});

describe('a closed storm stays as it was', () => {
  it('no moves, reorders, driver swaps, link sends or customer notices after close', async () => {
    const w = await makeWorld();
    const { ctx, stormId, run, stops } = await liveStorm(w);
    const [other] = await serviceDb().select().from(storm_run).where(eq(storm_run.storm_id, stormId));
    await closeStorm(ctx, stormId, true);
    await expect(patchRunStop(ctx, stops[0]!.id, { status: 'skipped' })).rejects.toMatchObject({ status: 409 });
    await expect(reorderRun(ctx, run.id, [...stops].reverse().map((s) => s.id))).rejects.toMatchObject({ status: 409 });
    await expect(assignRunDriver(ctx, other!.id, w.crew2Id)).rejects.toMatchObject({ status: 409 });
    await expect(publishStorm(ctx, stormId)).rejects.toMatchObject({ status: 409 });
    await expect(notifyCustomers(ctx, stormId, { siteIds: [stops[0]!.site_id], template: 'late' })).rejects.toMatchObject({ status: 409 });
    const [s] = await serviceDb().select().from(run_stop).where(eq(run_stop.id, stops[0]!.id));
    expect(s!.status).toBe('open');
  });

  it('a running-late notice only goes to lots on the storm', async () => {
    const w = await makeWorld();
    const { ctx, stormId } = await liveStorm(w);
    const offStorm = w.siteIds[w.siteIds.length - 1]!; // Site B is on Route B, which this storm doesn't include.
    await expect(notifyCustomers(ctx, stormId, { siteIds: [offStorm], template: 'late' })).rejects.toMatchObject({ status: 422 });
  });
});

describe('billing waits for the storm to close', () => {
  it('no drafts and no approvals while the storm is on', async () => {
    const w = await makeWorld();
    const { ctx, stormId, rs, stops } = await liveStorm(w);
    await processActions(rs, stopActions(stops[0]!.id, new Date(Date.now() - 3600000)).actions as never);
    await expect(generateDrafts(ctx, stormId)).rejects.toMatchObject({ status: 409 });
    // A draft from before this rule, or made by hand, still can't be charged mid-storm.
    const [d] = await serviceDb().insert(invoice_draft).values({ tenant_id: w.tenantId, storm_id: stormId, customer_id: w.customerIds[0]!, lines: [], subtotal_cents: 6500, flags: [] }).returning();
    expect(await approveDrafts(ctx, [d!.id])).toEqual({ approved: 0 });
    await closeStorm(ctx, stormId, true);
    expect((await generateDrafts(ctx, stormId)).length).toBeGreaterThan(0);
  });
});

describe('a visit the driver took back with Undo', () => {
  it('is not on the customer records page, the board, or the salt report', async () => {
    const w = await makeWorld();
    const { ctx, stormId, rs, stops } = await liveStorm(w);
    const stop = stops[1]!;
    const at = new Date(Date.now() - 600_000);
    const a = stopActions(stop.id, at, { salt: [{ unit: 'ton', qty: 2 }], minutes: 1 });
    await processActions(rs, a.actions as never);
    const undo = { client_uuid: randomUUID(), at: new Date(at.getTime() + 90_000).toISOString(), kind: 'undo_last', run_stop_id: stop.id, visit_client_uuid: a.visit };
    expect((await processActions(rs, [undo]))[0]!.status).toBe('ok');
    const customerId = w.customerIds[1]!;
    const portal = await portalData(customerId, w.tenantId);
    expect(portal!.sites.flatMap((s) => s.visits)).toHaveLength(0);
    const live = await stormLive({ ...ctx, timezone: 'America/New_York', role: 'owner' }, stormId);
    expect(live.runs.flatMap((r) => r.stops).find((s) => s.id === stop.id)!.done_at).toBeNull();
    const salt = await withUser(w.userId, (tx) => saltReport(tx, w.tenantId, period(undefined, undefined, 'America/New_York')));
    expect(salt.storms.reduce((n, s) => n + s.tons, 0)).toBe(0);
  });
});

describe('quotes', () => {
  it('a retired site cannot be quoted', async () => {
    const w = await makeWorld();
    await serviceDb().update(site).set({ active: false }).where(eq(site.id, w.siteIds[0]!));
    await expect(createQuote(ctxOf(w), { site_id: w.siteIds[0]!, season: '2027-28', services: [{ service: 'plow', trigger_in: 2, pricing: { type: 'per_push', amount_cents: 5000 } }], send: false })).rejects.toMatchObject({ status: 409 });
  });
});

describe('snow alerts', () => {
  it('two checks at once make one alert, not two', async () => {
    const w = await makeWorld();
    await setSetting('dev.weather_fixture', 'lakewood-lake-effect-2025-12');
    await setSetting('dev.clock', '2025-12-12T20:00:00Z');
    await mapSites(w.tenantId);
    const cells = await serviceDb().selectDistinct({ office: site.nws_office, x: site.nws_grid_x, y: site.nws_grid_y }).from(site).where(eq(site.tenant_id, w.tenantId));
    for (const c of cells) await fetchCell(c.office!, c.x!, c.y!);
    const runs = await Promise.allSettled([JOB_HANDLERS['trigger.evaluate']!({ tenantId: w.tenantId }), JOB_HANDLERS['trigger.evaluate']!({ tenantId: w.tenantId })]);
    // The one that found the other running asks to be retried, and the retry finds nothing new.
    expect(runs.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
    await JOB_HANDLERS['trigger.evaluate']!({ tenantId: w.tenantId });
    const alerts = await serviceDb().select().from(trigger_alert).where(and(eq(trigger_alert.tenant_id, w.tenantId), eq(trigger_alert.kind, 'forecast')));
    expect(alerts).toHaveLength(1);
  });
});

describe('the toll-free status webhook', () => {
  it('a JSON body must match the hash Twilio signed', async () => {
    const w = await makeWorld();
    await serviceDb().update(tenant).set({ sms_status: 'pending', sms_verification: { twilio_verification_id: `HH_${w.tenantId}` } }).where(eq(tenant.id, w.tenantId));
    const url = 'http://localhost:3999/api/webhooks/twilio/tollfree';
    const real = JSON.stringify({ VerificationSid: `HH_other`, Status: 'TWILIO_REJECTED' });
    const hash = createHash('sha256').update(real).digest('hex');
    const sig = signTwilio(MOCK_TWILIO_TOKEN, `${url}?bodySHA256=${hash}`, {});
    // Someone replays that signature with a body of their own.
    const forged = JSON.stringify({ VerificationSid: `HH_${w.tenantId}`, Status: 'TWILIO_APPROVED' });
    const prev = process.env.TWILIO_WEBHOOK_BASE_URL;
    process.env.TWILIO_WEBHOOK_BASE_URL = 'http://localhost:3999';
    try {
      const res = await tollfree(req(`/api/webhooks/twilio/tollfree?bodySHA256=${hash}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-twilio-signature': sig }, body: forged }));
      expect(res.status).toBe(403);
      const ok = await tollfree(req(`/api/webhooks/twilio/tollfree?bodySHA256=${hash}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-twilio-signature': sig }, body: real }));
      expect(ok.status).toBe(204);
    } finally {
      process.env.TWILIO_WEBHOOK_BASE_URL = prev;
    }
    const [t] = await serviceDb().select().from(tenant).where(eq(tenant.id, w.tenantId));
    expect(t!.sms_status).toBe('pending');
  });
});

describe('call-out replies', () => {
  it('the board shows only an answer given during this storm', async () => {
    const w = await makeWorld();
    await serviceDb().update(crew_member).set({ callout_reply: 'NO', callout_reply_at: new Date(Date.now() - 3 * 86400000).toISOString() }).where(eq(crew_member.id, w.crewId));
    const { ctx, stormId } = await liveStorm(w);
    const live = await stormLive({ ...ctx, timezone: 'America/New_York', role: 'owner' }, stormId);
    expect(live.runs.find((r) => r.crew?.id === w.crewId)!.crew!.callout_reply).toBeNull();
    await serviceDb().update(crew_member).set({ callout_reply: 'YES', callout_reply_at: new Date().toISOString() }).where(eq(crew_member.id, w.crewId));
    const after = await stormLive({ ...ctx, timezone: 'America/New_York', role: 'owner' }, stormId);
    expect(after.runs.find((r) => r.crew?.id === w.crewId)!.crew!.callout_reply).toBe('YES');
  });
});
