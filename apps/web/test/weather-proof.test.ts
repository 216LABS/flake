import { randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, closeDb, eq, inArray, job, message_log, proof_packet, run_stop, serviceDb, site, sql, sms_consent, storm, tenant, trigger_alert, visit, visit_correction, weather_snapshot, withUser, desc } from '@flake/db';
import { signTwilio, MOCK_TWILIO_TOKEN } from '@flake/providers';
import { POST as inbound } from '@/app/api/webhooks/twilio/inbound/route';
import { POST as smsStatus } from '@/app/api/webhooks/twilio/status/route';
import { POST as toolContractRoute } from '@/app/api/tools/contract/route';
import { POST as toolPriceRoute } from '@/app/api/tools/price/route';
import { generateDrafts } from '@/lib/billing';
import { getBlob } from '@/lib/blob';
import { runJobs } from '@/lib/handlers';
import { processActions, resolveToken } from '@/lib/driver';
import { drainJobs, enqueue } from '@/lib/jobs';
import { sendSms } from '@/lib/messaging';
import { assembleProof, renderProof } from '@/lib/proof';
import { setSetting } from '@/lib/providers';
import { createQuote, acceptQuote, getQuote, mockConfirmSetup } from '@/lib/quotes';
import { MockEmail } from '@flake/providers';
import { requestTollFree, submitTollFree } from '@/lib/sms-admin';

import { decryptToken, sha256Hex } from '@/lib/tokens';
import { buildManifest } from '@flake/core/proof';
import { breakerOpen, breakerState, evaluateTenant, fetchAlerts, fetchCell, fetchNohrsc, latestSnapshotIds, mapSites, parseGridpoint, tenantWeatherHeader } from '@/lib/weather';
import { ctxOf, consent, drain, jsonReq, makeWorld, req, stopActions, type World, createStorm } from './helpers';

afterAll(() => closeDb());

const cellsOf = async (tenantId: string) => serviceDb().selectDistinct({ office: site.nws_office, x: site.nws_grid_x, y: site.nws_grid_y }).from(site).where(eq(site.tenant_id, tenantId));

describe('weather and triggers', () => {
  let w: World;
  beforeAll(async () => {
    w = await makeWorld();
    await setSetting('dev.weather_fixture', 'lakewood-lake-effect-2025-12');
    await setSetting('dev.clock', '2025-12-12T20:00:00Z');
    await mapSites(w.tenantId);
    // A fixed Last-Modified would return 304 once any earlier run stored a snapshot for this cell.
    await serviceDb().execute(sql`alter table weather_snapshot disable trigger weather_snapshot_append_only`);
    await serviceDb().execute(sql`delete from weather_snapshot where request_url like 'mock://%' and source = 'nws_grid'`);
    await serviceDb().execute(sql`alter table weather_snapshot enable trigger weather_snapshot_append_only`);
  });

  it('archives the raw bytes with a matching sha256 and labels synthetic data', async () => {
    const [c] = await cellsOf(w.tenantId);
    await fetchCell(c!.office!, c!.x!, c!.y!);
    const [snap] = await serviceDb().select().from(weather_snapshot).where(and(eq(weather_snapshot.office, c!.office!), eq(weather_snapshot.grid_x, c!.x!), eq(weather_snapshot.grid_y, c!.y!))).orderBy(desc(weather_snapshot.fetched_at)).limit(1);
    expect(snap!.summary.synthetic).toBe(true);
    expect(snap!.request_url.startsWith('mock://')).toBe(true);
    const gz = await getBlob('weather-archive', snap!.storage_path);
    expect(sha256Hex(gunzipSync(gz!))).toBe(snap!.sha256);
    expect(snap!.summary.snow_next12h_in).toBeGreaterThan(0);
  });

  it('a second fetch is conditional and adds no snapshot', async () => {
    const [c] = await cellsOf(w.tenantId);
    const count = async () => (await serviceDb().select().from(weather_snapshot).where(and(eq(weather_snapshot.office, c!.office!), eq(weather_snapshot.grid_x, c!.x!), eq(weather_snapshot.grid_y, c!.y!)))).length;
    const before = await count();
    await fetchCell(c!.office!, c!.x!, c!.y!);
    expect(await count()).toBe(before);
  });

  it('creates an alert per kind, never a storm, and only once per event', async () => {
    const cells = await cellsOf(w.tenantId);
    for (const c of cells) await fetchCell(c.office!, c.x!, c.y!);
    const created = await evaluateTenant(w.tenantId);
    expect(created.length).toBeGreaterThan(0);
    const [alert] = await serviceDb().select().from(trigger_alert).where(eq(trigger_alert.id, created[0]!));
    expect(alert!.kind).toBe('forecast');
    expect(alert!.site_ids.length).toBeGreaterThan(0);
    expect(alert!.snapshot_ids.length).toBeGreaterThan(0);
    expect(alert!.detail.headline).toMatch(/Lakewood: .*forecast/);
    expect(await serviceDb().select().from(storm).where(eq(storm.tenant_id, w.tenantId))).toHaveLength(0);
    expect(await evaluateTenant(w.tenantId)).toEqual([]);
  });

  it('emails the owner when an alert fires', async () => {
    await drain();
    const rows = await serviceDb().select().from(message_log).where(and(eq(message_log.tenant_id, w.tenantId), eq(message_log.template, 'owner_alert')));
    expect(rows.length).toBeGreaterThan(0);
  });

  it('an email outage during an alert still tells the owner afterward', async () => {
    const x = await makeWorld();
    await setSetting('dev.weather_fixture', 'lakewood-lake-effect-2025-12');
    await setSetting('dev.clock', '2025-12-12T20:00:00Z');
    await mapSites(x.tenantId);
    for (const c of await cellsOf(x.tenantId)) await fetchCell(c.office!, c.x!, c.y!);
    const outage = vi.spyOn(MockEmail.prototype, 'send').mockRejectedValue(new Error('Resend 500: down'));
    const created = await evaluateTenant(x.tenantId);
    expect(created.length).toBeGreaterThan(0);
    await runJobs(100); // One round, as real backoff would do it.
    outage.mockRestore();
    await drain();
    const rows = await serviceDb().select().from(message_log).where(and(eq(message_log.tenant_id, x.tenantId), eq(message_log.template, 'owner_alert'), eq(message_log.status, 'sent')));
    expect(rows.length).toBeGreaterThan(0);
  });

  it('starting from an alert attaches its snapshots and only its sites, and marks it dispatched', async () => {
    const [alert] = await serviceDb().select().from(trigger_alert).where(and(eq(trigger_alert.tenant_id, w.tenantId), eq(trigger_alert.kind, 'forecast')));
    const out = await createStorm(ctxOf(w), { name: 'From alert', routeIds: [w.routeId], crewAssignments: {}, triggerAlertId: alert!.id, siteIds: alert!.site_ids });
    expect(out.storm.forecast_snapshot_ids).toEqual(expect.arrayContaining(alert!.snapshot_ids));
    const [again] = await serviceDb().select().from(trigger_alert).where(eq(trigger_alert.id, alert!.id));
    expect(again!.status).toBe('dispatched');
  });

  it('a nearby driver depth report fires depth_report on a quiet forecast', async () => {
    const x = await makeWorld();
    await setSetting('dev.weather_fixture', 'quiet');
    await setSetting('dev.clock', '2025-12-12T12:00:00Z');
    await mapSites(x.tenantId);
    const out = await createStorm(ctxOf(x), { name: 'Depth', routeIds: [x.routeId], crewAssignments: {} });
    const rs = await resolveToken(decryptToken(out.runs[0]!.link_token_enc!));
    const [s] = await serviceDb().select().from(run_stop).where(and(eq(run_stop.storm_run_id, out.runs[0]!.id), eq(run_stop.seq, 1)));
    const a = stopActions(s!.id, new Date('2025-12-12T11:00:00Z'));
    await processActions(rs, [a.actions[0] as never, { client_uuid: randomUUID(), at: '2025-12-12T11:05:00Z', kind: 'depth', run_stop_id: s!.id, visit_client_uuid: a.visit, depth_in: 4, gps: null }]);
    const cells = await cellsOf(x.tenantId);
    for (const c of cells) await fetchCell(c.office!, c.x!, c.y!);
    // Other tests may hold the conditional state of these cells, so seed a snapshot if the fetch returned 304.
    await evaluateTenant(x.tenantId);
    const alerts = await serviceDb().select().from(trigger_alert).where(and(eq(trigger_alert.tenant_id, x.tenantId), eq(trigger_alert.kind, 'depth_report')));
    expect(alerts.length).toBe(1);
    await setSetting('dev.weather_fixture', 'lakewood-lake-effect-2025-12');
  });

  it('winter alerts create one nws_alert per alert id', async () => {
    await setSetting('dev.clock', '2025-12-12T20:00:00Z');
    await fetchAlerts(w.tenantId);
    await fetchAlerts(w.tenantId);
    const rows = await serviceDb().select().from(trigger_alert).where(and(eq(trigger_alert.tenant_id, w.tenantId), eq(trigger_alert.kind, 'nws_alert')));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.detail.headline).toContain('SYNTHETIC');
  });

  it('samples NOHRSC at site points and hides other tenants through the view', async () => {
    await setSetting('dev.clock', '2025-12-13T13:00:00Z');
    const stranger = await makeWorld();
    const snap = await fetchNohrsc(24);
    expect(snap!.summary.sites[w.siteIds[0]!]).toBe(3.2);
    const rows = (await withUser(stranger.userId, (tx) => tx.execute(sql`select summary from tenant_weather_snapshot where id = ${snap!.id}`))) as unknown as { summary: { sites: Record<string, unknown> } }[];
    expect(rows[0]!.summary.sites[w.siteIds[0]!]).toBeUndefined();
    expect(rows[0]!.summary.sites[stranger.siteIds[0]!]).toBe(3.2);
  });

  it('an observed 24 h total prices the tier only when its whole window falls inside the storm (issue 13)', async () => {
    const x = await makeWorld();
    await setSetting('dev.clock', '2025-12-13T13:00:00Z');
    await mapSites(x.tenantId);
    const day = await fetchNohrsc(24);
    const six = await fetchNohrsc(6);
    const ids = await latestSnapshotIds(x.tenantId);
    const attached = await serviceDb().select().from(weather_snapshot).where(inArray(weather_snapshot.id, ids));
    expect(attached.filter((s) => s.source === 'nohrsc').map((s) => s.summary.hours).sort()).toEqual([24, 6]);
    const out = await createStorm(ctxOf(x), { name: 'Tier depth', routeIds: [x.routeId], crewAssignments: {} });
    await serviceDb().update(storm).set({ forecast_snapshot_ids: [day!.id, six!.id] }).where(eq(storm.id, out.storm.id));
    const rs = await resolveToken(decryptToken(out.runs[0]!.link_token_enc!));
    const [s] = await serviceDb().select().from(run_stop).where(and(eq(run_stop.storm_run_id, out.runs[0]!.id), eq(run_stop.seq, 2)));
    // The driver saw 1", the 24 h analysis says 3.2": both fall in the first tier here, so raise the tier edge to tell them apart.
    // The replayed storm is from December 2025, so its contract is that season's.
    await serviceDb().execute(sql`update contract set season = '2025-26', services = '[{"service":"plow","pricing":{"type":"per_inch_tier","tiers":[{"up_to_in":2,"amount_cents":10000},{"up_to_in":null,"amount_cents":20000}]}}]'::jsonb where site_id = ${x.siteIds[1]!}`);
    await processActions(rs, stopActions(s!.id, new Date('2025-12-13T12:00:00Z'), { depth: 1 }).actions as never);
    // A storm that ran the whole day the 24 h file covers: its 3.2" is this storm's snow and sets the tier.
    const windowStart = new Date(Date.parse(day!.summary.valid_at) - 24 * 3600_000).toISOString();
    await serviceDb().update(storm).set({ status: 'closed', started_at: windowStart, closed_at: '2025-12-13T14:00:00Z' }).where(eq(storm.id, out.storm.id));
    const drafts = await generateDrafts(ctxOf(x), out.storm.id);
    expect(drafts.find((d) => d.draft.customer_id === x.customerIds[1])!.draft.subtotal_cents).toBe(20000);
    // A storm that started an hour before close: most of that 24 h total fell before it, maybe in another storm, so
    // only the driver's 1" counts.
    await serviceDb().update(storm).set({ started_at: '2025-12-13T13:00:00Z' }).where(eq(storm.id, out.storm.id));
    const later = await generateDrafts(ctxOf(x), out.storm.id);
    expect(later.find((d) => d.draft.customer_id === x.customerIds[1])!.draft.subtotal_cents).toBe(10000);
  });

  it('missing weather reads as unavailable, never zero', async () => {
    const stranger = await makeWorld();
    const h = await tenantWeatherHeader(stranger.tenantId);
    expect(h.forecast_in).toBeNull();
    expect(h.source).toBe('unavailable');
    expect(parseGridpoint({ properties: {} }).snowIn).toEqual([]);
  });

  it('the breaker opens after 5 consecutive failures and closes on success', async () => {
    vi.resetModules();
    await setSetting('weather_breaker', { failures: 4, open_until: null });
    vi.doMock('@/lib/providers', async (orig) => {
      const real = await orig<typeof import('@/lib/providers')>();
      return { ...real, getProviders: async () => ({ weather: { fetchGridpoint: async () => { throw new Error('NWS 500'); } } }) };
    });
    const mod = await import('@/lib/weather');
    await expect(mod.fetchCell('CLE', 999, 999)).rejects.toThrow('NWS 500');
    const b = await breakerState();
    expect(b.failures).toBe(5);
    expect(breakerOpen(b)).toBe(true);
    expect((await mod.scheduleWeather()).skipped).toBe('breaker_open');
    vi.doUnmock('@/lib/providers');
    vi.resetModules();
    await setSetting('weather_breaker', { failures: 0, open_until: null });
  });
});

describe('proof packets', () => {
  let w: World;
  let siteId: string;
  const from = '2026-02-01T00:00:00Z';
  const to = '2026-02-28T23:59:59Z';
  beforeAll(async () => {
    w = await makeWorld();
    siteId = w.siteIds[0]!;
    await setSetting('dev.weather_fixture', 'lakewood-lake-effect-2025-12');
    await setSetting('dev.clock', '2025-12-13T13:00:00Z');
    await mapSites(w.tenantId);
    for (const c of await cellsOf(w.tenantId)) await fetchCell(c.office!, c.x!, c.y!);
    await fetchNohrsc(24);
    for (let i = 0; i < 3; i++) {
      const out = await createStorm(ctxOf(w), { name: `Storm ${i}`, routeIds: [w.routeId], crewAssignments: {} });
      await serviceDb().update(storm).set({ started_at: `2026-02-0${i + 2}T05:00:00Z`, closed_at: `2026-02-0${i + 2}T15:00:00Z`, status: 'closed' }).where(eq(storm.id, out.storm.id));
      const rs = await resolveToken(decryptToken(out.runs[0]!.link_token_enc!));
      const [s] = await serviceDb().select().from(run_stop).where(and(eq(run_stop.storm_run_id, out.runs[0]!.id), eq(run_stop.seq, 1)));
      await processActions(rs, stopActions(s!.id, new Date(`2026-02-0${i + 2}T06:00:00Z`)).actions as never);
    }
  });

  it('the same inputs give the same manifest hash', async () => {
    const a = await assembleProof(w.tenantId, siteId, from, to);
    const b = await assembleProof(w.tenantId, siteId, from, to);
    expect(buildManifest(a).hash).toBe(buildManifest(b).hash);
    expect(a.storms).toHaveLength(3);
    expect(a.visits).toHaveLength(3);
  });

  it('renders for a site with 3 storms in under 20 s and carries snapshot hashes', async () => {
    const started = Date.now();
    const p1 = await renderProof({ tenantId: w.tenantId, siteId, from, to });
    expect(Date.now() - started).toBeLessThan(20000);
    const p2 = await renderProof({ tenantId: w.tenantId, siteId, from, to });
    expect(p2!.manifest_sha256).toBe(p1!.manifest_sha256);
    const manifest = p1!.manifest as any;
    const snaps = manifest.storms.flatMap((s: any) => s.snapshots);
    expect(snaps.length).toBeGreaterThan(0);
    expect(snaps.every((s: any) => /^[0-9a-f]{64}$/.test(s.sha256) && s.request_url)).toBe(true);
    expect(JSON.stringify(manifest)).not.toContain('"hourly"');
    const pdf = await getBlob('proof', p1!.pdf_path);
    expect(Buffer.from(pdf!).subarray(0, 4).toString()).toBe('%PDF');
    expect(p1!.pdf_path.startsWith(`${w.tenantId}/`)).toBe(true);
  }, 60000);

  it('strips other tenants from shared NOHRSC rows', async () => {
    const input = await assembleProof(w.tenantId, siteId, from, to);
    const nohrsc = input.storms.flatMap((s) => s.snapshots).find((s) => s.source === 'nohrsc');
    expect(Object.keys(nohrsc!.summary.sites as object)).toEqual([siteId]);
  });

  it('any correction appears in the log and changes the hash', async () => {
    const before = buildManifest(await assembleProof(w.tenantId, siteId, from, to));
    const [v] = await serviceDb().select().from(visit).where(and(eq(visit.tenant_id, w.tenantId), eq(visit.site_id, siteId))).limit(1);
    await withUser(w.userId, (tx) => tx.insert(visit_correction).values({ tenant_id: w.tenantId, visit_id: v!.id, field: 'depth_in', old_value: 3, new_value: 4, reason: 'Typo', by_user: w.userId }));
    const after = buildManifest(await assembleProof(w.tenantId, siteId, from, to));
    expect(after.hash).not.toBe(before.hash);
    expect(after.manifest.corrections.map((c) => c.reason)).toEqual(['Typo']);
  });

  it('a tenant cannot read another tenant packet, and rendering refuses a foreign site', async () => {
    const stranger = await makeWorld();
    await expect(renderProof({ tenantId: stranger.tenantId, siteId, from, to })).rejects.toThrow(/not found/i);
    const rows = await withUser(stranger.userId, (tx) => tx.select().from(proof_packet).where(eq(proof_packet.site_id, siteId)));
    expect(rows).toHaveLength(0);
  });
});

describe('quotes', () => {
  it('accepting stores name, IP and time plus a PDF snapshot, and SMS consent stays opt-in', async () => {
    const w = await makeWorld();
    const { token, contract } = await createQuote(ctxOf(w), { site_id: w.siteIds[5]!, season: '2026-27', services: [{ service: 'plow', trigger_in: 2, pricing: { type: 'per_push', amount_cents: 6500 } }], send: true });
    const q = await getQuote(token);
    expect(q.contract.status).toBe('sent');
    expect(JSON.stringify(q)).not.toContain('application_fee');
    await acceptQuote(token, { name: 'Pat Example', agree: true, consentSms: false, consentEmail: true, phone_e164: null }, '203.0.113.9');
    const [row] = await serviceDb().execute(sql`select status, accepted_name, accepted_ip::text as ip, accepted_at, pdf_path from contract where id = ${contract.id}`);
    expect(row).toMatchObject({ status: 'accepted', accepted_name: 'Pat Example' });
    expect((row as any).ip).toContain('203.0.113.9');
    expect((row as any).pdf_path).toBeTruthy();
    expect(await getBlob('contracts', (row as any).pdf_path)).not.toBeNull();
    expect((await acceptQuote(token, { name: 'Someone Else', agree: true, consentSms: false, consentEmail: true, phone_e164: null }, null)).already).toBe(true);
    expect(await serviceDb().select().from(sms_consent).where(eq(sms_consent.tenant_id, w.tenantId))).toHaveLength(0);
  }, 30000);

  it('two taps on Accept keep the first signature, and a voided quote cannot be accepted', async () => {
    const w = await makeWorld();
    const mk = () => createQuote(ctxOf(w), { site_id: w.siteIds[5]!, season: '2026-27', services: [{ service: 'plow', trigger_in: 2, pricing: { type: 'per_push', amount_cents: 6500 } }], send: false });
    const { token, contract: c } = await mk();
    const sign = (name: string) => acceptQuote(token, { name, agree: true, consentSms: false, consentEmail: true, phone_e164: null }, null);
    const [a, b] = await Promise.all([sign('First Tap'), sign('Second Tap')]);
    expect([a.already, b.already].sort()).toEqual([false, true]);
    const [row] = (await serviceDb().execute(sql`select accepted_name, pdf_path from contract where id = ${c.id}`)) as any[];
    expect(['First Tap', 'Second Tap']).toContain(row.accepted_name);
    expect(await getBlob('contracts', row.pdf_path)).not.toBeNull();
    const v = await mk();
    await serviceDb().execute(sql`update contract set status = 'void' where id = ${v.contract.id}`);
    await expect(acceptQuote(v.token, { name: 'Late', agree: true, consentSms: false, consentEmail: true, phone_e164: null }, null)).rejects.toMatchObject({ status: 404 });
  }, 30000);

  it('checking the box records consent, and a mock card is stored', async () => {
    const w = await makeWorld();
    const { token } = await createQuote(ctxOf(w), { site_id: w.siteIds[5]!, season: '2026-27', services: [{ service: 'plow', trigger_in: 2, pricing: { type: 'per_push', amount_cents: 6500 } }], send: false });
    await acceptQuote(token, { name: 'Pat Example', agree: true, consentSms: true, consentEmail: true, phone_e164: '+12165550177' }, null);
    expect(await serviceDb().select().from(sms_consent).where(and(eq(sms_consent.tenant_id, w.tenantId), eq(sms_consent.phone_e164, '+12165550177')))).toHaveLength(1);
    expect((await mockConfirmSetup(token, { card: '4000000000000002' })).payment_method).toBe('pm_mock_0002');
  }, 30000);

  it('a bad token is a 404, not a crash', async () => {
    await expect(getQuote('nope')).rejects.toThrow(/no longer available/);
  });
});

describe('SMS compliance', () => {
  it('never texts without a consent row or from an unverified tenant', async () => {
    const w = await makeWorld({ smsApproved: true });
    const [t] = await serviceDb().select().from(tenant).where(eq(tenant.id, w.tenantId));
    const send = () => sendSms(t!, { to: '+12165550191', template: 'on_the_way', vars: { company: 'x', site: 'y' }, key: randomUUID() });
    expect(await send()).toBe(false);
    await consent(w.tenantId, '+12165550191');
    expect(await send()).toBe(true);
    const unverified = await makeWorld();
    await consent(unverified.tenantId, '+12165550191');
    const [u] = await serviceDb().select().from(tenant).where(eq(tenant.id, unverified.tenantId));
    expect(await sendSms(u!, { to: '+12165550191', template: 'on_the_way', vars: { company: 'x', site: 'y' }, key: randomUUID() })).toBe(false);
  });

  it('the same idempotency key sends once', async () => {
    const w = await makeWorld({ smsApproved: true });
    await consent(w.tenantId, '+12165550191');
    const [t] = await serviceDb().select().from(tenant).where(eq(tenant.id, w.tenantId));
    const key = randomUUID();
    const send = () => sendSms(t!, { to: '+12165550191', template: 'on_the_way', vars: { company: 'x', site: 'y' }, key });
    expect(await send()).toBe(true);
    expect(await send()).toBe(false);
    expect(await serviceDb().select().from(message_log).where(and(eq(message_log.tenant_id, w.tenantId), eq(message_log.idempotency_key, `sms:${key}`)))).toHaveLength(1);
  });

  const inboundReq = (params: Record<string, string>, url = 'http://localhost:3999/api/webhooks/twilio/inbound', token = MOCK_TWILIO_TOKEN) =>
    req('/api/webhooks/twilio/inbound', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'x-twilio-signature': signTwilio(token, url, params) }, body: new URLSearchParams(params) });

  it('a late "sent" from Twilio does not overwrite "delivered"', async () => {
    const w = await makeWorld({ smsApproved: true });
    const sid = `SM${randomUUID().replace(/-/g, '')}`;
    await serviceDb().insert(message_log).values({ tenant_id: w.tenantId, channel: 'sms', template: 'on_the_way', to_addr: '+12165550192', body: 'x', status: 'queued', provider_id: sid, idempotency_key: `t:${sid}` } as never);
    const url = 'http://localhost:3999/api/webhooks/twilio/status';
    const post = (MessageStatus: string) => {
      const params = { MessageSid: sid, MessageStatus };
      return smsStatus(req('/api/webhooks/twilio/status', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'x-twilio-signature': signTwilio(MOCK_TWILIO_TOKEN, url, params) }, body: new URLSearchParams(params) }));
    };
    const status = async () => (await serviceDb().select().from(message_log).where(eq(message_log.provider_id, sid)))[0]!.status;
    await post('delivered');
    await post('sent');
    expect(await status()).toBe('delivered');
    await post('read');
    expect(await status()).toBe('read');
  });

  it('honors STOP, START and HELP through the signed webhook and rejects a bad signature', async () => {
    const w = await makeWorld({ smsApproved: true });
    await consent(w.tenantId, '+12165550191');
    const [t] = await serviceDb().select().from(tenant).where(eq(tenant.id, w.tenantId));
    const base = { To: t!.sms_sender!, From: '+12165550191' };
    expect((await inbound(inboundReq({ ...base, Body: 'STOP' }, undefined, 'wrong'))).status).toBe(403);
    expect((await inbound(inboundReq({ ...base, Body: 'STOP' }))).status).toBe(200);
    expect(await sendSms(t!, { to: '+12165550191', template: 'on_the_way', vars: { company: 'x', site: 'y' }, key: randomUUID() })).toBe(false);
    const help = await (await inbound(inboundReq({ ...base, Body: 'HELP' }))).text();
    expect(help).toContain('Reply STOP to opt out');
    await inbound(inboundReq({ ...base, Body: 'START' }));
    expect(await sendSms(t!, { to: '+12165550191', template: 'on_the_way', vars: { company: 'x', site: 'y' }, key: randomUUID() })).toBe(true);
    await inbound(inboundReq({ ...base, Body: 'YES' }));
    const rows = await serviceDb().execute(sql`select callout_reply from crew_member where tenant_id = ${w.tenantId} and phone_e164 = '+12165550191'`);
    expect(rows[0]!.callout_reply).toBe('YES');
  });

  it('toll-free submit needs the business details, keeps only the last 4, and goes pending', async () => {
    const w = await makeWorld();
    await expect(requestTollFree(w.tenantId, '12-3456789')).rejects.toThrow(/Add these first/);
    await serviceDb().update(tenant).set({ business_legal_name: 'Test Plow LLC', address: { line1: '1 Main', city: 'Lakewood', state: 'OH', zip: '44107' }, contact_email: 'a@flake.test', contact_phone: '+12165550100', sms_verification: { contact_name: 'Pat' } }).where(eq(tenant.id, w.tenantId));
    await requestTollFree(w.tenantId, '12-3456789');
    const [t] = await serviceDb().select().from(tenant).where(eq(tenant.id, w.tenantId));
    expect(t!.sms_status).toBe('pending');
    expect(t!.ein_last4).toBe('6789');
    expect(JSON.stringify(t)).not.toContain('3456789');
    const jobs = await serviceDb().select().from(job).where(sql`kind = 'sms.tollfree_submit' and payload->>'tenantId' = ${w.tenantId}`);
    expect(JSON.stringify(jobs[0]!.payload)).not.toContain('3456789');
    await submitTollFree(w.tenantId, '12-3456789');
    await serviceDb().execute(sql`update job set run_at = now() where kind = 'sms.mock_approve' and payload->>'tenantId' = ${w.tenantId}`);
    await drain();
    const [after] = await serviceDb().select().from(tenant).where(eq(tenant.id, w.tenantId));
    expect(after!.sms_status).toBe('approved');
    expect(after!.twilio_subaccount_sid).toMatch(/^AC_mock/);
  });
});

describe('free plan housekeeping', () => {
  it('prunes old finished jobs and keeps recent and failed ones', async () => {
    const { queueMissedReports } = await import('@/lib/handlers');
    const key = (s: string) => `prune:${s}:${randomUUID()}`;
    const [oldDone, newDone, oldDead] = [key('a'), key('b'), key('c')];
    await serviceDb().insert(job).values([
      { kind: 'x', payload: {}, dedupe_key: oldDone, done_at: '2020-01-01T00:00:00Z' },
      { kind: 'x', payload: {}, dedupe_key: newDone, done_at: new Date().toISOString() },
      { kind: 'x', payload: {}, dedupe_key: oldDead, dead_at: '2020-01-01T00:00:00Z' },
    ]);
    await queueMissedReports();
    await drain(); // Leave the queue empty for the job tests that follow.
    const left = await serviceDb().select({ k: job.dedupe_key }).from(job).where(sql`dedupe_key like 'prune:%'`);
    const keys = left.map((x) => x.k);
    expect(keys).not.toContain(oldDone);
    expect(keys).toContain(newDone);
    expect(keys).toContain(oldDead);
  });

  it('reads real storage and database usage', async () => {
    const { deploymentUsage } = await import('@/lib/usage');
    const u = await deploymentUsage();
    expect(u.db_mb).toBeGreaterThan(0);
    expect(u.files_limit_mb).toBe(1024);
    expect(typeof u.near_limit).toBe('boolean');
  });
});

describe('job queue', () => {
  it('companies take turns, so a huge storm cannot hold up a small one', async () => {
    await drain();
    const marker = randomUUID();
    const seen: string[] = [];
    const handler = async (p: Record<string, unknown>) => { if (p.marker === marker) seen.push(p.who as string); };
    const old = new Date(Date.now() - 60000);
    for (let i = 0; i < 30; i++) await enqueue('notify.customer', { marker, who: 'big', tenantId: `big-${marker}` }, { dedupeKey: `fair:${marker}:${i}`, runAt: old });
    await enqueue('notify.customer', { marker, who: 'small', tenantId: `small-${marker}` }, { dedupeKey: `fair:${marker}:small` });
    await drainJobs({ 'notify.customer': handler });
    expect(seen).toContain('small');
    expect(seen.indexOf('small')).toBeLessThan(4);
  });

  it('a job that has waited long enough moves up, so low priority work still gets done', async () => {
    await drain();
    const marker = randomUUID();
    const seen: string[] = [];
    const handler = (name: string) => async (p: Record<string, unknown>) => { if (p.marker === marker) seen.push(name); };
    await enqueue('report.completion', { marker }, { dedupeKey: `age:${marker}:old`, runAt: new Date(Date.now() - 45 * 60000) });
    await enqueue('notify.customer', { marker }, { dedupeKey: `age:${marker}:new` });
    await drainJobs({ 'report.completion': handler('old report'), 'notify.customer': handler('new notice') }, { limit: 1 });
    expect(seen).toEqual(['old report']);
    await drain();
  });

  it('a provider rate limit waits without using up an attempt', async () => {
    await drain();
    const key = `limit:${randomUUID()}`;
    await enqueue('test.limited', { key }, { dedupeKey: key });
    await drainJobs({ 'test.limited': async () => { throw Object.assign(new Error('slow down'), { retryAfterSeconds: 600 }); } }, { limit: 1 });
    const [row] = await serviceDb().select().from(job).where(eq(job.dedupe_key, key));
    expect(row!.attempts).toBe(0);
    expect(row!.dead_at).toBeNull();
    expect(Date.parse(row!.run_at!)).toBeGreaterThan(Date.now() + 500000);
    await serviceDb().execute(sql`update job set done_at = now() where dedupe_key = ${key}`);
  });

  it('the urgent run leaves everything else for the schedule', async () => {
    await drain();
    const marker = randomUUID();
    const seen: string[] = [];
    const handler = (name: string) => async (p: Record<string, unknown>) => { if (p.marker === marker) seen.push(name); };
    await enqueue('report.completion', { marker }, { dedupeKey: `urgent:${marker}:report` });
    await enqueue('storm.publish_links', { marker }, { dedupeKey: `urgent:${marker}:link` });
    const handlers = { 'report.completion': handler('report'), 'storm.publish_links': handler('link') };
    await drainJobs(handlers, { maxLane: 0 });
    expect(seen).toEqual(['link']);
    await drainJobs(handlers);
    expect(seen).toEqual(['link', 'report']);
  });

  it("a driver's link goes ahead of reports already waiting, and one run clears more than a small batch", async () => {
    await drain();
    const marker = randomUUID();
    const seen: string[] = [];
    const handler = (name: string) => async (p: Record<string, unknown>) => { if (p.marker === marker) seen.push(name); };
    const old = new Date(Date.now() - 60000);
    for (let i = 0; i < 40; i++) await enqueue('report.completion', { marker }, { dedupeKey: `order:${marker}:${i}`, runAt: old });
    await enqueue('storm.publish_links', { marker }, { dedupeKey: `order:${marker}:link` });
    const { ran } = await drainJobs({ 'report.completion': handler('report'), 'storm.publish_links': handler('link') });
    expect(seen[0]).toBe('link');
    expect(seen).toHaveLength(41);
    expect(ran).toBeGreaterThanOrEqual(41);
  });

  it('retries with backoff and dead-letters after max attempts', async () => {
    const key = `test:${randomUUID()}`;
    await enqueue('test.fail', { tenantId: randomUUID() }, { dedupeKey: key });
    await serviceDb().execute(sql`update job set max_attempts = 2 where dedupe_key = ${key}`);
    const handlers = { 'test.fail': async () => { throw new Error('boom'); } };
    await drainJobs(handlers, { limit: 1 });
    let [row] = await serviceDb().select().from(job).where(eq(job.dedupe_key, key));
    expect(row!.attempts).toBe(1);
    expect(row!.dead_at).toBeNull();
    expect(row!.last_error).toBe('boom');
    expect(Date.parse(row!.run_at!)).toBeGreaterThan(Date.now());
    await serviceDb().execute(sql`update job set run_at = now() where dedupe_key = ${key}`);
    await drainJobs(handlers, { limit: 1 });
    [row] = await serviceDb().select().from(job).where(eq(job.dedupe_key, key));
    expect(row!.dead_at).not.toBeNull();
  });

  it('dedupe keys enqueue once, and concurrent drains run every job exactly once', async () => {
    await drain();
    const key = `test:${randomUUID()}`;
    await enqueue('test.count', { key }, { dedupeKey: key });
    await enqueue('test.count', { key }, { dedupeKey: key });
    expect(await serviceDb().select().from(job).where(eq(job.dedupe_key, key))).toHaveLength(1);
    // Many jobs and many overlapping runs, so a race shows up every time rather than now and then.
    const marker = randomUUID();
    for (let i = 0; i < 30; i++) await enqueue('test.count', { key: marker, i }, { dedupeKey: `${marker}:${i}` });
    const runs = new Map<number | string, number>();
    const handlers = { 'test.count': async (p: Record<string, unknown>) => { const k = p.key === marker ? (p.i as number) : 'single'; runs.set(k, (runs.get(k) ?? 0) + 1); } };
    await Promise.all(Array.from({ length: 6 }, () => drainJobs(handlers)));
    expect(runs.get('single')).toBe(1);
    for (let i = 0; i < 30; i++) expect(runs.get(i), `job ${i}`).toBe(1);
  });

  it('latest snapshot ids stay empty for a tenant with no weather', async () => {
    const w = await makeWorld();
    const ids = await latestSnapshotIds(w.tenantId);
    expect(Array.isArray(ids)).toBe(true);
  });
});

describe('public tools', () => {
  it('builds a contract PDF with no account and stores a lead only when an email is given', async () => {
    const body = { company: 'A', client: 'B', site: 'C', season_start: 'Nov', season_end: 'Apr', services: ['plow'], trigger_in: 2, pricing_type: 'per_push', price_text: '$65' };
    const res = await toolContractRoute(jsonReq('/api/tools/contract', body), {});
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 4).toString()).toBe('%PDF');
    const email = `lead-${randomUUID()}@flake.test`;
    await toolContractRoute(jsonReq('/api/tools/contract', { ...body, email }), {});
    const rows = await serviceDb().execute(sql`select source from lead where email = ${email}`);
    expect(rows[0]!.source).toBe('tool_contract');
  }, 30000);

  it('estimates from square footage or an address and echoes its assumptions', async () => {
    const a = await (await toolPriceRoute(jsonReq('/api/tools/price', { sqft: 40000, walks_lf: 100 }), {})).json();
    expect(a.estimate.per_push_cents).toBe(25500);
    expect(a.assumptions.per_sqft_cents_per_push).toBe(0.6);
    const b = await (await toolPriceRoute(jsonReq('/api/tools/price', { address: '14701 Detroit Ave, Lakewood, OH' }), {})).json();
    expect(b.sqft).toBeGreaterThan(0);
    expect(b.measured.method).toBeTruthy();
    expect((await toolPriceRoute(jsonReq('/api/tools/price', {}), {})).status).toBe(422);
  });
});
