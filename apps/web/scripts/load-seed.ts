/**
 * Big-company scale check (issue 228). QA only: it refuses any database but a local one unless LOAD_ALLOW_DB names the
 * exact host, and it only ever creates a new company of its own ("zz Load ..."). It never touches the demo company or
 * any existing company, and it never runs pnpm db:schedule.
 *
 *   pnpm build && APP_ENV=test PROVIDERS_MODE=mock pnpm exec next start -p 3200
 *   pnpm tsx --env-file=.env.local scripts/load-seed.ts http://localhost:3200 [sites=600] [crew=60] [passes=5]
 *
 * Builds 600 lots on 60 routes with 60 drivers, and one storm with 5 passes over every lot: 3,000 finished visits with
 * before and after photo rows (no image files). Then it times what the office does on a busy night: the board's first
 * load and polls, the big lists, Close storm and drafting 3,000 visits. The driver side (60 phones posting at once) is
 * scripts/load-storm.ts. Prints a table and exits 1 if a target in docs/SCALE.md is missed.
 */
import { randomUUID } from 'node:crypto';
import { closeDb, membership, serviceDb, sql, tenant } from '@flake/db';
import { adminClient } from '../lib/blob';

const BASE = process.argv[2] ?? 'http://localhost:3200';
const SITES = Number(process.argv[3] ?? 600);
const CREW = Number(process.argv[4] ?? 60);
const PASSES = Number(process.argv[5] ?? 5);
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) throw new Error('The app must be a local build.');
const dbHost = new URL(process.env.DATABASE_URL ?? 'postgres://x@localhost/x').hostname;
if (!['localhost', '127.0.0.1'].includes(dbHost) && process.env.LOAD_ALLOW_DB !== dbHost) throw new Error(`Refusing database ${dbHost}. Set LOAD_ALLOW_DB=${dbHost} only for a QA or preview database.`);

const times: Record<string, number[]> = {};
const errors: Record<string, string[]> = {};
async function timed(name: string, path: string, init: RequestInit & { cookie: string }) {
  const headers = new Headers(init.headers);
  headers.set('cookie', init.cookie);
  const t = performance.now();
  const res = await fetch(`${BASE}${path}`, { ...init, headers, signal: AbortSignal.timeout(120_000) });
  const body = await res.text();
  (times[name] ??= []).push(performance.now() - t);
  if (!res.ok) (errors[name] ??= []).push(`${res.status} ${body.slice(0, 200)}`);
  return body;
}
const pct = (a: number[], p: number) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor((p / 100) * a.length))]! : 0);

async function seed() {
  const db = serviceDb();
  const stamp = Date.now();
  const email = `zz-load-${stamp}@flake.test`;
  const { data, error } = await adminClient().auth.admin.createUser({ email, password: 'flake-demo-only', email_confirm: true });
  if (error) throw error;
  const tenantId = randomUUID();
  await db.insert(tenant).values({ id: tenantId, name: `zz Load ${stamp}`, slug: `zz-load-${stamp}`, contact_email: email, plan: 'pro' });
  await db.insert(membership).values({ tenant_id: tenantId, user_id: data.user.id, role: 'owner' });
  const t0 = performance.now();
  // Set-based inserts, so 600 lots take seconds, not minutes.
  await db.execute(sql`
    insert into crew_member (id, tenant_id, name, kind, phone_e164)
    select gen_random_uuid(), ${tenantId}, 'Driver ' || g, case when g % 6 = 0 then 'sub' else 'employee' end, '+1216555' || lpad(g::text, 4, '0')
    from generate_series(1, ${CREW}) g`);
  await db.execute(sql`
    insert into route (id, tenant_id, name, default_crew_id)
    select gen_random_uuid(), ${tenantId}, 'Route ' || lpad(g::text, 2, '0'), (select id from crew_member where tenant_id = ${tenantId} and name = 'Driver ' || g)
    from generate_series(1, ${CREW}) g`);
  await db.execute(sql`
    insert into customer (id, tenant_id, name, kind, phone_e164)
    select gen_random_uuid(), ${tenantId}, 'Customer ' || lpad(g::text, 4, '0'), 'commercial', '+1440555' || lpad(g::text, 4, '0')
    from generate_series(1, ${SITES}) g`);
  // Spread over about 20 by 15 miles, so the lots fall in many forecast grid cells.
  await db.execute(sql`
    insert into site (id, tenant_id, customer_id, label, address, lat, lon, area_estimate_sqft, service_window)
    select gen_random_uuid(), ${tenantId}, c.id, 'Lot ' || substr(c.name, 10), substr(c.name, 10) || ' Load Ave, Lakewood, OH',
      41.30 + (n % 30) * 0.008, -81.95 + (n / 30) * 0.012, 20000 + (n % 40) * 1500, case when n % 4 = 0 then '{"open_by":"07:00"}'::jsonb end
    from (select id, name, row_number() over (order by name) - 1 as n from customer where tenant_id = ${tenantId}) c`);
  await db.execute(sql`
    insert into contract (tenant_id, site_id, season, status, services)
    select ${tenantId}, s.id, '2026-27', 'accepted', '[{"service":"plow","trigger_in":2,"pricing":{"type":"per_push","amount_cents":9500}}]'::jsonb
    from site s where s.tenant_id = ${tenantId}`);
  await db.execute(sql`
    insert into route_stop (tenant_id, route_id, site_id, seq)
    select ${tenantId}, r.id, s.id, s.k
    from (select id, row_number() over (order by label) - 1 as n, (row_number() over (order by label) - 1) % ${Math.ceil(SITES / CREW)} + 1 as k from site where tenant_id = ${tenantId}) s
    join (select id, row_number() over (order by name) - 1 as n from route where tenant_id = ${tenantId}) r on r.n = s.n / ${Math.ceil(SITES / CREW)}`);
  // One storm, PASSES passes over every lot, all finished, as it stands just before Close.
  const stormId = randomUUID();
  const started = new Date(Date.now() - 20 * 3600_000).toISOString();
  await db.execute(sql`insert into storm (id, tenant_id, name, started_at, status) values (${stormId}, ${tenantId}, 'Load storm', ${started}, 'active')`);
  for (let pass = 1; pass <= PASSES; pass++) {
    await db.execute(sql`
      insert into storm_run (id, tenant_id, storm_id, route_id, crew_id, pass, link_token_hash, link_expires_at, published_at, started_at)
      select gen_random_uuid(), ${tenantId}, ${stormId}, r.id, r.default_crew_id, ${pass}, encode(gen_random_bytes(32), 'hex'), now() + interval '14 days', ${started}, ${started}
      from route r where r.tenant_id = ${tenantId}`);
  }
  await db.execute(sql`
    insert into run_stop (id, tenant_id, storm_run_id, site_id, seq, status, updated_at)
    select gen_random_uuid(), ${tenantId}, sr.id, rs.site_id, rs.seq, 'done', now()
    from storm_run sr join route_stop rs on rs.route_id = sr.route_id where sr.storm_id = ${stormId}`);
  await db.execute(sql`
    insert into visit (id, tenant_id, client_uuid, storm_id, site_id, crew_id, run_stop_id, arrived_device_at, departed_device_at, arrive_lat, arrive_lon, depth_in, services, salt)
    select gen_random_uuid(), ${tenantId}, gen_random_uuid(), ${stormId}, x.site_id, sr.crew_id, x.id,
      ${started}::timestamptz + (sr.pass - 1) * interval '3 hours' + x.seq * interval '12 minutes',
      ${started}::timestamptz + (sr.pass - 1) * interval '3 hours' + x.seq * interval '12 minutes' + interval '9 minutes',
      s.lat, s.lon, 3.5, array['plow'], '[{"unit":"bag50lb","qty":2}]'::jsonb
    from run_stop x join storm_run sr on sr.id = x.storm_run_id join site s on s.id = x.site_id where sr.storm_id = ${stormId}`);
  await db.execute(sql`
    insert into visit_photo (tenant_id, visit_id, client_uuid, phase, storage_path, sha256, width, height)
    select ${tenantId}, v.id, gen_random_uuid(), p.phase, ${tenantId} || '/load/' || v.id || '-' || p.phase || '.jpg', md5(v.id::text || p.phase), 1600, 1200
    from visit v cross join (values ('before'), ('after')) p(phase) where v.storm_id = ${stormId}`);
  const [counts] = (await db.execute(sql`select
    (select count(*)::int from site where tenant_id = ${tenantId}) as sites,
    (select count(*)::int from crew_member where tenant_id = ${tenantId}) as crew,
    (select count(*)::int from route where tenant_id = ${tenantId}) as routes,
    (select count(*)::int from visit where storm_id = ${stormId}) as visits,
    (select count(*)::int from visit_photo p join visit v on v.id = p.visit_id where v.storm_id = ${stormId}) as photos`)) as unknown as Record<string, number>[];
  console.log(`Seeded in ${Math.round((performance.now() - t0) / 1000)} s:`, JSON.stringify(counts));
  const login = await fetch(`${BASE}/api/dev/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
  if (!login.ok) throw new Error(`login ${login.status}`);
  return { tenantId, stormId, cookie: login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ') };
}

/** docs/SCALE.md: the targets this run checks, in ms (p95 where there are several calls). */
const TARGETS: Record<string, number> = {
  'board: first load (page)': 2500,
  'board: poll (live API)': 500,
  'close and draft (3,000 visits)': 60_000,
};

async function main() {
  const { stormId, cookie } = await seed();
  const db = serviceDb();
  await timed('board: first load (page)', `/storms/${stormId}`, { cookie });
  for (let i = 0; i < 20; i++) await timed('board: poll (live API)', `/api/storms/${stormId}/live`, { cookie });
  // Several dispatchers at once.
  await Promise.all(Array.from({ length: 5 }, () => timed('board: poll, 5 at once', `/api/storms/${stormId}/live`, { cookie })));
  for (const [name, path] of [['dashboard', '/dashboard'], ['customers', '/customers'], ['routes', '/routes'], ['proof', '/proof'], ['receivables', '/receivables'], ['reports', '/reports'], ['profit per lot', '/reports/profit'], ['settings, crew', '/settings?tab=crew']] as const) {
    for (let i = 0; i < 3; i++) await timed(`page: ${name}`, path, { cookie });
  }
  const t = performance.now();
  await timed('close storm', `/api/storms/${stormId}/close`, { method: 'POST', cookie, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ force: true }) });
  const body = await timed('draft bills', `/api/storms/${stormId}/billing/draft`, { method: 'POST', cookie });
  (times['close and draft (3,000 visits)'] ??= []).push(performance.now() - t);
  const [d] = (await db.execute(sql`select count(*)::int as n, coalesce(sum(subtotal_cents), 0)::int as cents from invoice_draft where storm_id = ${stormId}`)) as unknown as { n: number; cents: number }[];
  console.log(`Drafts: ${d!.n}, total ${(d!.cents / 100).toFixed(2)} (${body.length} bytes back)`);
  await timed('page: billing review', `/billing?storm=${stormId}`, { cookie });
  await timed('page: billing review', `/billing?storm=${stormId}`, { cookie });
  console.log(`\n${'what'.padEnd(34)} ${'calls'.padStart(5)} ${'p50'.padStart(7)} ${'p95'.padStart(7)} ${'max'.padStart(7)}  target`);
  const missed: string[] = [];
  for (const [k, v] of Object.entries(times)) {
    const target = TARGETS[k];
    const p95 = pct(v, 95);
    if (target && p95 > target) missed.push(`${k}: ${Math.round(p95)} ms, target ${target} ms`);
    console.log(`${k.padEnd(34)} ${String(v.length).padStart(5)} ${pct(v, 50).toFixed(0).padStart(7)} ${p95.toFixed(0).padStart(7)} ${Math.max(...v).toFixed(0).padStart(7)}  ${target ? `${target}${p95 > target ? ' MISSED' : ''}` : ''}`);
  }
  for (const [k, v] of Object.entries(errors)) console.log(`ERRORS ${k}: ${v.slice(0, 3).join(' | ')}`);
  console.log(missed.length ? `\nMISSED:\n- ${missed.join('\n- ')}` : '\nAll targets met.');
  await closeDb();
  process.exit(missed.length || Object.keys(errors).length ? 1 : 0);
}

void main();
