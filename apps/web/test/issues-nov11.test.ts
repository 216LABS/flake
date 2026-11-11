import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { and, closeDb, crew_member, eq, invoice_draft, job, message_log, run_stop, serviceDb, site, sql, storm, visit, visit_photo, weather_snapshot } from '@flake/db';
import { MOCK_REJECTED_DOMAIN } from '@flake/providers';
import { processActions, resolveToken } from '@/lib/driver';
import { closeStormAndDraft, publishStorm, stormLive } from '@/lib/storms';
import { officePhotoUrl, stopDetail } from '@/lib/stop-detail';
import { decryptToken } from '@/lib/tokens';
import { plainJobError } from '@/lib/usage';
import { stormWeather } from '@/lib/weather';
import { createStorm, ctxOf, drain, makeWorld, stopActions } from './helpers';

afterAll(() => closeDb());

/** A storm on Route A with the first stop done (with a photo when asked), still open. */
async function stormWithVisit(opts: { photo?: boolean } = {}) {
  const w = await makeWorld();
  const ctx = ctxOf(w);
  const out = await createStorm(ctx, { name: 'Nov storm', routeIds: [w.routeId], crewAssignments: {} });
  const run = out.runs[0]!;
  const rs = await resolveToken(decryptToken(run.link_token_enc!));
  const stops = (await serviceDb().select().from(run_stop).where(eq(run_stop.storm_run_id, run.id))).sort((a, b) => a.seq - b.seq);
  const a = stopActions(stops[0]!.id, new Date(Date.now() - 3600_000), { depth: 4, gps: { lat: 41.48, lon: -81.8 } });
  await processActions(rs, a.actions as never);
  const [v] = await serviceDb().select().from(visit).where(eq(visit.client_uuid, a.visit));
  if (opts.photo) {
    await serviceDb().insert(visit_photo).values({ tenant_id: w.tenantId, visit_id: v!.id, client_uuid: randomUUID(), phase: 'after', storage_path: `${w.tenantId}/test/${randomUUID()}.jpg`, sha256: 'ab'.repeat(32), taken_device_at: new Date().toISOString() });
  }
  return { w, ctx, stormId: out.storm.id, run, stops, visit: v! };
}

describe('issue 48: closing a storm drafts its invoices', () => {
  it('the drafts are there when the office lands on Billing', async () => {
    const { ctx, stormId } = await stormWithVisit();
    const out = await closeStormAndDraft(ctx, stormId, true);
    expect(out.status).toBe('closed');
    expect(out.drafted).toBeGreaterThan(0);
    const rows = await serviceDb().select().from(invoice_draft).where(eq(invoice_draft.storm_id, stormId));
    expect(rows.length).toBe(out.drafted);
  });
  it('closing again does not redraft or fail, and approved invoices are left alone', async () => {
    const { ctx, stormId } = await stormWithVisit();
    await closeStormAndDraft(ctx, stormId, true);
    await serviceDb().update(invoice_draft).set({ status: 'approved' }).where(eq(invoice_draft.storm_id, stormId));
    const again = await closeStormAndDraft(ctx, stormId, true);
    expect(again.drafted).toBeNull();
    const rows = await serviceDb().select().from(invoice_draft).where(eq(invoice_draft.storm_id, stormId));
    expect(rows.every((r) => r.status === 'approved')).toBe(true);
  });
});

describe('issue 49: an address the provider rejects is not retried', () => {
  it('marks the message rejected, finishes the job, and a fixed address goes out', async () => {
    const w = await makeWorld();
    const ctx = ctxOf(w);
    const bad = `typo@${MOCK_REJECTED_DOMAIN}`;
    await serviceDb().update(crew_member).set({ email: bad }).where(eq(crew_member.id, w.crewId));
    const out = await createStorm(ctx, { name: 'S', routeIds: [w.routeId], crewAssignments: {} });
    await publishStorm(ctx, out.storm.id);
    await drain();
    const sent = () => serviceDb().select().from(message_log).where(and(eq(message_log.tenant_id, w.tenantId), eq(message_log.template, 'crew_link')));
    const [first] = await sent();
    expect(first).toMatchObject({ status: 'rejected', to_addr: bad });
    const jobs = await serviceDb().select().from(job).where(sql`payload->>'runId' = ${out.runs[0]!.id}`);
    expect(jobs.every((j) => j.done_at && !j.dead_at)).toBe(true);

    // The office fixes the address on the driver; the route link goes again, to the new one.
    const good = `fixed-${randomUUID().slice(0, 8)}@example.com`;
    await serviceDb().update(crew_member).set({ email: good }).where(eq(crew_member.id, w.crewId));
    const { enqueue } = await import('@/lib/jobs');
    await enqueue('storm.publish_links', { tenantId: w.tenantId, runId: out.runs[0]!.id }, { dedupeKey: `publish:${out.runs[0]!.id}:fix` });
    await drain();
    const [after] = await sent();
    expect(after).toMatchObject({ status: 'sent', to_addr: good });
  });
  it('the same rejected address is not sent again', async () => {
    const w = await makeWorld();
    const ctx = ctxOf(w);
    await serviceDb().update(crew_member).set({ email: `x@${MOCK_REJECTED_DOMAIN}` }).where(eq(crew_member.id, w.crewId));
    const out = await createStorm(ctx, { name: 'S', routeIds: [w.routeId], crewAssignments: {} });
    await publishStorm(ctx, out.storm.id);
    await drain();
    const { enqueue } = await import('@/lib/jobs');
    await enqueue('storm.publish_links', { tenantId: w.tenantId, runId: out.runs[0]!.id }, { dedupeKey: `publish:${out.runs[0]!.id}:again` });
    await drain();
    const rows = await serviceDb().select().from(message_log).where(and(eq(message_log.tenant_id, w.tenantId), eq(message_log.template, 'crew_link')));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('rejected');
  });
  it('network errors read as a hiccup in System', () => {
    expect(plainJobError('Error in the HTTP2 framing layer')).toMatch(/network hiccup/);
    expect(plainJobError('fetch failed')).toMatch(/network hiccup/);
    expect(plainJobError('Twilio 503: down')).toMatch(/Twilio service/);
    expect(plainJobError('Something else')).toBe('Something else');
  });
});

describe("issue 45: a storm's weather is that storm's", () => {
  it('a closed storm with nothing attached says so, not 0 or today', async () => {
    const out = await stormWeather(randomUUID(), { status: 'closed', started_at: '2026-01-01T00:00:00Z', closed_at: '2026-01-01T06:00:00Z', forecast_snapshot_ids: [] }, []);
    expect(out).toEqual({ forecast_in: null, observed_in: null, synthetic: false, note: 'No weather was captured for this storm.' });
  });
  it("sums the attached forecast over the storm's own hours, and ignores a newer forecast", async () => {
    const w = await makeWorld();
    const office = `T${randomUUID().slice(0, 2).toUpperCase()}`;
    await serviceDb().update(site).set({ nws_office: office, nws_grid_x: 1, nws_grid_y: 2 }).where(eq(site.tenant_id, w.tenantId));
    const t0 = Date.parse('2026-01-10T00:00:00Z');
    const H = 3600_000;
    const snap = async (fetched: number, perHour: number) => {
      const [s] = await serviceDb().insert(weather_snapshot).values({ source: 'nws_grid', office, grid_x: 1, grid_y: 2, fetched_at: new Date(fetched).toISOString(), request_url: 'test', storage_path: 'test', sha256: 'x', summary: { hourly: { snow: Array.from({ length: 12 }, (_, i) => [t0 + i * H, perHour]) } } }).returning();
      return s!.id;
    };
    const attached = await snap(t0 + 6 * H, 0.5);
    await snap(t0 + 48 * H, 0); // A later clear night must not make this storm look like 0".
    const out = await stormWeather(w.tenantId, { status: 'closed', started_at: new Date(t0).toISOString(), closed_at: new Date(t0 + 4 * H).toISOString(), forecast_snapshot_ids: [attached] }, w.siteIds);
    expect(out.forecast_in).toBe(2);
    expect(out.note).toBeNull();
  });
  it('the live board of a closed storm has no live forecast, only its own', async () => {
    const { w, ctx, stormId } = await stormWithVisit();
    await closeStormAndDraft(ctx, stormId, true);
    const live = await stormLive({ ...ctx, timezone: 'America/New_York', role: 'owner' }, stormId);
    expect(live.weather).toBeNull();
    expect(live.storm_weather.note).toBe('No weather was captured for this storm.');
    void w;
  });
});

describe('issue 41: a stop opens to its visit and photos', () => {
  it('shows times, services, depth, GPS and photos, and the board counts them', async () => {
    const { w, ctx, stormId, stops } = await stormWithVisit({ photo: true });
    const d = await stopDetail(w.userId, stops[0]!.id);
    expect(d.status).toBe('done');
    expect(d.visits).toHaveLength(1);
    expect(d.visits[0]).toMatchObject({ services: ['plow'], depth_in: 4, voided: false });
    expect(d.visits[0]!.gps).toMatchObject({ lat: 41.48, lon: -81.8 });
    expect(d.visits[0]!.photos).toHaveLength(1);
    const live = await stormLive({ ...ctx, timezone: 'America/New_York', role: 'owner' }, stormId);
    const card = live.runs[0]!.stops.find((s) => s.id === stops[0]!.id)!;
    expect(card).toMatchObject({ photos: 1, depth_in: 4 });
    expect(card.done_at).toBeTruthy();
    // A stop nobody has reached yet opens too, and says so.
    const open = await stopDetail(w.userId, stops[1]!.id);
    expect(open.visits).toEqual([]);
    expect(JSON.stringify(d)).not.toMatch(/\/d\//);
  });
  it('a viewer can open it, another company cannot, and photos follow the same rule', async () => {
    const { w, stops, visit: v } = await stormWithVisit({ photo: true });
    await expect(stopDetail(w.viewerId, stops[0]!.id)).resolves.toMatchObject({ status: 'done' });
    const stranger = await makeWorld();
    await expect(stopDetail(stranger.userId, stops[0]!.id)).rejects.toMatchObject({ status: 404 });
    const [p] = await serviceDb().select().from(visit_photo).where(eq(visit_photo.visit_id, v.id));
    expect(await officePhotoUrl(stranger.userId, p!.id, true)).toBeNull();
  });
  it('a problem the driver reported is on the stop', async () => {
    const { w, run, stops } = await stormWithVisit();
    const rs = await resolveToken(decryptToken(run.link_token_enc!));
    await processActions(rs, [{ client_uuid: randomUUID(), at: new Date().toISOString(), kind: 'problem', run_stop_id: stops[1]!.id, problem: 'blocked', note: 'Car in the drive' }] as never);
    const d = await stopDetail(w.userId, stops[1]!.id);
    expect(d.problems[0]).toMatchObject({ kind: 'blocked', note: 'Car in the drive' });
    const [s] = await serviceDb().select().from(storm).where(eq(storm.id, run.storm_id));
    expect(s!.status).toBe('active');
  });
});
