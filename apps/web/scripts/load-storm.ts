/**
 * Big storm load test. Local only: refuses anything but localhost.
 *
 *   pnpm build && APP_ENV=test PROVIDERS_MODE=mock pnpm exec next start -p 3200
 *   pnpm tsx --env-file=.env.local scripts/load-storm.ts http://localhost:3200 [routes] [stopsPerRoute]
 *
 * Builds a company with 20 trucks and 300 lots, starts a storm, then every driver works every stop at once the way
 * the phone does (arrive, before photo, done with depth and salt, after photo, GPS pings) while three dispatchers
 * watch the board. Then it closes the storm, bills all 300, and checks nothing was lost or doubled.
 */
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { closeDb, contract, crew_member, customer, membership, route, route_stop, serviceDb, site, sql, tenant } from '@flake/db';
import { adminClient } from '../lib/blob';

const BASE = process.argv[2] ?? 'http://localhost:3200';
const ROUTES = Number(process.argv[3] ?? 20);
const STOPS = Number(process.argv[4] ?? 15);
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) throw new Error('Local only');

type Stat = { ms: number[]; errors: Record<string, number> };
const stats: Record<string, Stat> = {};
/** FLAKY=1: every driver request goes out twice at once, like a phone retrying after a reply got lost. */
const FLAKY = process.env.FLAKY === '1';
async function call(name: string, path: string, init: RequestInit & { cookie?: string; ip?: string } = {}) {
  if (FLAKY && name.startsWith('driver') && init.method === 'POST') {
    const [a] = await Promise.all([once(name, path, init), once(`${name} (retry)`, path, init)]);
    return a;
  }
  return once(name, path, init);
}
async function once(name: string, path: string, init: RequestInit & { cookie?: string; ip?: string } = {}) {
  const st = (stats[name] ??= { ms: [], errors: {} });
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set('cookie', init.cookie);
  if (init.ip) headers.set('x-forwarded-for', init.ip);
  const t = performance.now();
  try {
    const res = await fetch(`${BASE}${path}`, { ...init, headers, signal: AbortSignal.timeout(60000) });
    st.ms.push(performance.now() - t);
    if (!res.ok) st.errors[res.status] = (st.errors[res.status] ?? 0) + 1;
    return res;
  } catch (e) {
    st.ms.push(performance.now() - t);
    const k = (e as Error).name;
    st.errors[k] = (st.errors[k] ?? 0) + 1;
    return null;
  }
}
const pct = (a: number[], p: number) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor((p / 100) * a.length))]! : 0);

async function setup() {
  const db = serviceDb();
  const stamp = Date.now();
  const email = `load-${stamp}@flake.test`;
  const { data, error } = await adminClient().auth.admin.createUser({ email, password: 'flake-demo-only', email_confirm: true });
  if (error) throw error;
  const tenantId = randomUUID();
  await db.insert(tenant).values({ id: tenantId, name: `Load Plow ${stamp}`, slug: `load-${stamp}`, stripe_account_id: `acct_mock_${stamp}`, stripe_charges_enabled: true, sms_status: 'approved', sms_sender: '+18335550100', twilio_subaccount_sid: 'AC_mock', contact_email: email });
  await db.insert(membership).values({ tenant_id: tenantId, user_id: data.user.id, role: 'owner' });
  for (let r = 0; r < ROUTES; r++) {
    const crewId = randomUUID();
    const routeId = randomUUID();
    await db.insert(crew_member).values({ id: crewId, tenant_id: tenantId, name: `Driver ${r + 1}`, kind: 'employee', email: `driver${r}-${stamp}@flake.test` });
    await db.insert(route).values({ id: routeId, tenant_id: tenantId, name: `Route ${r + 1}`, default_crew_id: crewId });
    for (let i = 0; i < STOPS; i++) {
      const customerId = randomUUID();
      const siteId = randomUUID();
      await db.insert(customer).values({ id: customerId, tenant_id: tenantId, name: `Lot ${r + 1}-${i + 1}`, kind: 'commercial', email: `lot${r}-${i}-${stamp}@flake.test`, billing_mode: i % 5 === 4 ? 'invoice_net30' : 'card_on_file', stripe_payment_method_id: i % 5 === 4 ? null : 'pm_mock_4242' });
      await db.insert(site).values({ id: siteId, tenant_id: tenantId, customer_id: customerId, label: `Lot ${r + 1}-${i + 1}`, address: `${100 + i} Load St, Lakewood, OH`, lat: 41.45 + r * 0.004, lon: -81.85 + i * 0.003, area_estimate_sqft: 20000 + i * 3000, service_window: i % 4 === 0 ? { open_by: '07:00' } : null });
      await db.insert(contract).values({ tenant_id: tenantId, site_id: siteId, season: '2026-27', status: 'accepted', services: [{ service: 'plow', trigger_in: 2, pricing: { type: 'per_push', amount_cents: 9000 + i * 500 } }] });
      await db.insert(route_stop).values({ route_id: routeId, site_id: siteId, seq: i + 1, tenant_id: tenantId });
    }
  }
  const login = await fetch(`${BASE}/api/dev/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
  if (!login.ok) throw new Error(`login ${login.status}`);
  const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  return { tenantId, cookie };
}

async function main() {
  const db = serviceDb();
  console.log(`Setting up ${ROUTES} routes x ${STOPS} stops...`);
  const { tenantId, cookie } = await setup();
  const routeIds = (await db.execute(sql`select id from route where tenant_id = ${tenantId}`) as unknown as { id: string }[]).map((r) => r.id);

  const t0 = performance.now();
  const made = await call('office: create storm', '/api/storms', { method: 'POST', cookie, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Big storm', routeIds }) });
  const { id: stormId } = (await made!.json()) as { id: string };
  await call('office: publish', `/api/storms/${stormId}/publish`, { method: 'POST', cookie });
  const live = (await (await call('office: board', `/api/storms/${stormId}/live`, { cookie }))!.json()) as { runs: { link: string; stops: { id: string; site_id: string }[] }[] };
  console.log(`Storm published in ${Math.round(performance.now() - t0)} ms with ${live.runs.length} runs`);

  const sites = new Map((await db.execute(sql`select id, lat, lon from site where tenant_id = ${tenantId}`) as unknown as { id: string; lat: number; lon: number }[]).map((s) => [s.id, s]));
  const jpg = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: { r: 120, g: 140, b: 160 } } }).jpeg({ quality: 80 }).toBuffer();

  let driving = true;
  const watchers = Array.from({ length: 3 }, async () => {
    while (driving) {
      await call('office: board', `/api/storms/${stormId}/live`, { cookie });
      await new Promise((r) => setTimeout(r, 3000));
    }
  });

  const tDrive = performance.now();
  // Each driver on their own carrier address, except routes 0-4, which share one, like phones behind one carrier gateway.
  await Promise.all(live.runs.map(async (run, ri) => {
    const token = new URL(run.link).pathname.split('/').pop()!;
    const ip = ri < 5 ? '100.64.0.1' : `100.64.1.${ri}`;
    await call('driver: load route', `/api/d/${token}/run`, { ip });
    const base = Date.now() - 6 * 3600000;
    for (const [i, stop] of run.stops.entries()) {
      const s = sites.get(stop.site_id)!;
      const visit = randomUUID();
      const at = base + i * 20 * 60000;
      const gps = { lat: s.lat, lon: s.lon, acc: 8 };
      const json = { 'content-type': 'application/json' };
      await call('driver: position', `/api/d/${token}/position`, { method: 'POST', ip, headers: json, body: JSON.stringify({ ...gps, at: new Date(at).toISOString() }) });
      await call('driver: actions', `/api/d/${token}/actions`, { method: 'POST', ip, headers: json, body: JSON.stringify({ actions: [{ client_uuid: randomUUID(), at: new Date(at).toISOString(), kind: 'arrive', run_stop_id: stop.id, visit_client_uuid: visit, gps }] }) });
      for (const phase of ['before', 'after']) {
        const form = new FormData();
        form.set('client_uuid', randomUUID());
        form.set('visit_client_uuid', visit);
        form.set('phase', phase);
        form.set('file', new Blob([new Uint8Array(jpg)], { type: 'image/jpeg' }), 'p.jpg');
        await call('driver: photo', `/api/d/${token}/photos`, { method: 'POST', ip, body: form });
        if (phase === 'before') {
          await call('driver: actions', `/api/d/${token}/actions`, { method: 'POST', ip, headers: json, body: JSON.stringify({ actions: [{ client_uuid: randomUUID(), at: new Date(at + 15 * 60000).toISOString(), kind: 'done', run_stop_id: stop.id, visit_client_uuid: visit, services: ['plow', 'salt'], depth_in: 4, salt: [{ unit: 'bag50lb', qty: 4 }], gps }] }) });
        }
      }
    }
  }));
  driving = false;
  await Promise.all(watchers);
  console.log(`All drivers finished in ${Math.round((performance.now() - tDrive) / 1000)} s`);

  // Background work: completion texts and emails, reports. The local ticker drains the queue every 2 s, like the cron.
  const tJobs = performance.now();
  const pending = async () => (await db.execute(sql`select count(*)::int as n from job where done_at is null and dead_at is null and payload->>'tenantId' = ${tenantId}`) as unknown as { n: number }[])[0]!.n;
  while ((await pending()) > 0 && performance.now() - tJobs < 600000) await new Promise((r) => setTimeout(r, 2000));
  console.log(`Queue drained in ${Math.round((performance.now() - tJobs) / 1000)} s (${await pending()} left)`);

  await call('office: close', `/api/storms/${stormId}/close`, { method: 'POST', cookie, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ force: false }) });
  const tBill = performance.now();
  const gen = await call('office: generate bills', `/api/storms/${stormId}/billing/draft`, { method: 'POST', cookie });
  const drafts = ((await gen!.json()) as { drafts: { draft: { id: string } }[] }).drafts.map((d) => d.draft);
  for (let i = 0; i < drafts.length; i += 500) {
    const res = await call('office: approve all', '/api/billing/approve', { method: 'POST', cookie, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ draftIds: drafts.slice(i, i + 500).map((d) => d.id) }) });
    if (!res?.ok) throw new Error(`approve ${res?.status} ${await res?.text()}`);
  }
  const unbilled = async () => (await db.execute(sql`select count(*)::int as n from invoice_draft where storm_id = ${stormId} and status not in ('paid','sent','failed')`) as unknown as { n: number }[])[0]!.n;
  while ((await unbilled()) > 0 && performance.now() - tBill < 600000) await new Promise((r) => setTimeout(r, 2000));
  console.log(`Billed ${drafts.length} in ${Math.round((performance.now() - tBill) / 1000)} s`);

  const one = async (q: ReturnType<typeof sql>) => (await db.execute(q) as unknown as Record<string, number>[])[0]!;
  const totals = await one(sql`select
    (select count(*)::int from visit where storm_id = ${stormId} and departed_device_at is not null) as visits_done,
    (select count(*)::int from visit where storm_id = ${stormId}) as visits,
    (select count(*)::int from visit_photo p join visit v on v.id = p.visit_id where v.storm_id = ${stormId}) as photos,
    (select count(*)::int from invoice_draft where storm_id = ${stormId}) as drafts,
    (select count(*)::int from invoice_draft where storm_id = ${stormId} and status = 'paid') as paid,
    (select count(*)::int from invoice_draft where storm_id = ${stormId} and status = 'sent') as sent,
    (select count(*)::int from invoice_draft where storm_id = ${stormId} and status = 'failed') as failed,
    (select count(*)::int from message_log where tenant_id = ${tenantId} and template = 'done') as done_messages,
    (select count(*)::int from (select to_addr from message_log where tenant_id = ${tenantId} and template = 'done' group by to_addr, channel having count(*) > 1) d) as doubled_messages,
    (select count(*)::int from job where dead_at is not null and payload->>'tenantId' = ${tenantId}) as dead_jobs`);
  const n = ROUTES * STOPS;
  console.log('\nResults', JSON.stringify(totals));
  console.log(`\n${'endpoint'.padEnd(26)} ${'calls'.padStart(6)} ${'p50'.padStart(7)} ${'p95'.padStart(7)} ${'p99'.padStart(7)} ${'max'.padStart(7)}  errors`);
  for (const [k, v] of Object.entries(stats)) console.log(`${k.padEnd(26)} ${String(v.ms.length).padStart(6)} ${pct(v.ms, 50).toFixed(0).padStart(7)} ${pct(v.ms, 95).toFixed(0).padStart(7)} ${pct(v.ms, 99).toFixed(0).padStart(7)} ${Math.max(...v.ms).toFixed(0).padStart(7)}  ${JSON.stringify(v.errors)}`);
  const problems = [
    totals.visits_done !== n && `visits done ${totals.visits_done}/${n}`,
    totals.visits !== n && `visit rows ${totals.visits} (expected ${n}, more means doubled)`,
    totals.photos !== n * 2 && `photos ${totals.photos}/${n * 2}`,
    totals.drafts !== n && `bills ${totals.drafts}/${n}`,
    totals.paid + totals.sent !== n && `paid+sent ${totals.paid + totals.sent}/${n}`,
    totals.doubled_messages > 0 && `${totals.doubled_messages} customers messaged twice`,
    totals.dead_jobs > 0 && `${totals.dead_jobs} jobs dead`,
  ].filter(Boolean);
  console.log(problems.length ? `\nPROBLEMS:\n- ${problems.join('\n- ')}` : '\nNo data lost or doubled.');
  await closeDb();
  process.exit(problems.length ? 1 : 0);
}

void main();
