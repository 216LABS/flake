import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, driverScope, serviceDb, sql, withUser, type Tx } from '../src/index';
import * as s from '../src/schema';

/** Runs against the real local Postgres. Nothing about RLS is mocked. */
const db = serviceDb();
const A = { tenant: randomUUID(), owner: randomUUID(), viewer: randomUUID(), dispatcher: randomUUID() };
const B = { tenant: randomUUID(), owner: randomUUID() };
const ids = {
  aCrew: randomUUID(), bCrew: randomUUID(), aCustomer: randomUUID(), bCustomer: randomUUID(), aSite: randomUUID(), bSite: randomUUID(),
  aStorm: randomUUID(), bStorm: randomUUID(), aRun: randomUUID(), aRun2: randomUUID(), bRun: randomUUID(), aStop: randomUUID(), aStop2: randomUUID(), bStop: randomUUID(),
  aVisit: randomUUID(), bVisit: randomUUID(), aRoute: randomUUID(), aContract: randomUUID(), aDraft: randomUUID(), bDraft: randomUUID(),
};

async function user(id: string, email: string) {
  await db.execute(sql`insert into auth.users (id, email, aud, role, instance_id) values (${id}, ${email}, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000')`);
}

beforeAll(async () => {
  await user(A.owner, `${A.owner}@flake.test`);
  await user(A.viewer, `${A.viewer}@flake.test`);
  await user(A.dispatcher, `${A.dispatcher}@flake.test`);
  await user(B.owner, `${B.owner}@flake.test`);
  await db.insert(s.tenant).values([{ id: A.tenant, name: 'A', slug: `a-${A.tenant}` }, { id: B.tenant, name: 'B', slug: `b-${B.tenant}` }]);
  await db.insert(s.membership).values([
    { tenant_id: A.tenant, user_id: A.owner, role: 'owner' }, { tenant_id: A.tenant, user_id: A.viewer, role: 'viewer' },
    { tenant_id: A.tenant, user_id: A.dispatcher, role: 'dispatcher' }, { tenant_id: B.tenant, user_id: B.owner, role: 'owner' },
  ]);
  await db.insert(s.crew_member).values([{ id: ids.aCrew, tenant_id: A.tenant, name: 'A crew', kind: 'employee' }, { id: ids.bCrew, tenant_id: B.tenant, name: 'B crew', kind: 'employee' }]);
  await db.insert(s.customer).values([{ id: ids.aCustomer, tenant_id: A.tenant, name: 'A cust', kind: 'commercial' }, { id: ids.bCustomer, tenant_id: B.tenant, name: 'B cust', kind: 'commercial' }]);
  await db.insert(s.site).values([
    { id: ids.aSite, tenant_id: A.tenant, customer_id: ids.aCustomer, label: 'A site', address: 'x', lat: 41.48, lon: -81.8, nws_office: 'CLE', nws_grid_x: 1, nws_grid_y: 1 },
    { id: ids.bSite, tenant_id: B.tenant, customer_id: ids.bCustomer, label: 'B site', address: 'y', lat: 41.48, lon: -81.8, nws_office: 'CLE', nws_grid_x: 2, nws_grid_y: 2 },
  ]);
  await db.insert(s.route).values({ id: ids.aRoute, tenant_id: A.tenant, name: 'r' });
  const bRoute = randomUUID();
  await db.insert(s.route).values({ id: bRoute, tenant_id: B.tenant, name: 'b' });
  await db.insert(s.route_stop).values({ route_id: bRoute, site_id: ids.bSite, seq: 1, tenant_id: B.tenant });
  await db.insert(s.route_stop).values({ route_id: ids.aRoute, site_id: ids.aSite, seq: 1, tenant_id: A.tenant });
  await db.insert(s.contract).values([{ id: ids.aContract, tenant_id: A.tenant, site_id: ids.aSite, season: '2026-27', services: [] }, { tenant_id: B.tenant, site_id: ids.bSite, season: '2026-27', services: [] }]);
  await db.insert(s.storm).values([
    { id: ids.aStorm, tenant_id: A.tenant, name: 'a', started_at: '2025-12-12T00:00:00Z' },
    { id: ids.bStorm, tenant_id: B.tenant, name: 'b', started_at: '2025-12-12T00:00:00Z' },
  ]);
  const run = (id: string, tenant_id: string, storm_id: string, crew_id: string) => ({ id, tenant_id, storm_id, crew_id, link_token_hash: randomUUID(), link_expires_at: '2030-01-01T00:00:00Z' });
  await db.insert(s.storm_run).values([run(ids.aRun, A.tenant, ids.aStorm, ids.aCrew), run(ids.aRun2, A.tenant, ids.aStorm, ids.aCrew), run(ids.bRun, B.tenant, ids.bStorm, ids.bCrew)]);
  await db.insert(s.run_stop).values([
    { id: ids.aStop, tenant_id: A.tenant, storm_run_id: ids.aRun, site_id: ids.aSite, seq: 1 },
    { id: ids.aStop2, tenant_id: A.tenant, storm_run_id: ids.aRun2, site_id: ids.aSite, seq: 1 },
    { id: ids.bStop, tenant_id: B.tenant, storm_run_id: ids.bRun, site_id: ids.bSite, seq: 1 },
  ]);
  const visit = (id: string, tenant_id: string, storm_id: string, site_id: string, crew_id: string) => ({ id, tenant_id, client_uuid: randomUUID(), storm_id, site_id, crew_id, services: ['plow'], arrived_device_at: '2025-12-12T01:00:00Z' });
  await db.insert(s.visit).values([visit(ids.aVisit, A.tenant, ids.aStorm, ids.aSite, ids.aCrew), visit(ids.bVisit, B.tenant, ids.bStorm, ids.bSite, ids.bCrew)]);
  await db.insert(s.visit_photo).values({ tenant_id: B.tenant, visit_id: ids.bVisit, client_uuid: randomUUID(), phase: 'before', storage_path: 'p', sha256: 'h' });
  await db.insert(s.invoice_draft).values([
    { id: ids.aDraft, tenant_id: A.tenant, storm_id: ids.aStorm, customer_id: ids.aCustomer, lines: [], subtotal_cents: 0 },
    { id: ids.bDraft, tenant_id: B.tenant, storm_id: ids.bStorm, customer_id: ids.bCustomer, lines: [], subtotal_cents: 0 },
  ]);
  await db.insert(s.message_log).values({ tenant_id: B.tenant, channel: 'email', to_addr: 'x', template: 't', body: 'b', idempotency_key: randomUUID() });
  await db.insert(s.sms_consent).values({ tenant_id: B.tenant, phone_e164: `+1216555${Math.floor(Math.random() * 9000 + 1000)}`, party: 'crew' });
  await db.insert(s.proof_packet).values({ tenant_id: B.tenant, site_id: ids.bSite, from_ts: '2025-12-01T00:00:00Z', to_ts: '2025-12-30T00:00:00Z', pdf_path: 'x', sha256: 'h', manifest: {} });
  await db.insert(s.trigger_alert).values({ tenant_id: B.tenant, kind: 'forecast', site_ids: [ids.bSite], detail: {} });
  await db.insert(s.problem_report).values({ tenant_id: B.tenant, client_uuid: randomUUID(), kind: 'other' });
  await db.insert(s.driver_action).values({ tenant_id: B.tenant, client_uuid: randomUUID(), storm_run_id: ids.bRun, kind: 'arrive', payload: {}, device_at: '2025-12-12T01:00:00Z' });
  await db.insert(s.driver_position).values({ tenant_id: B.tenant, storm_run_id: ids.bRun, lat: 1, lon: 1, device_at: '2025-12-12T01:00:00Z' });
  await db.insert(s.visit_correction).values({ tenant_id: B.tenant, visit_id: ids.bVisit, field: 'notes', reason: 'r', by_user: B.owner });
  await db.insert(s.site_pin).values({ tenant_id: B.tenant, site_id: ids.bSite, kind: 'stake' });
});

afterAll(() => closeDb());

const TENANT_TABLES = ['crew_member', 'customer', 'site', 'site_pin', 'contract', 'route', 'route_stop', 'trigger_alert', 'storm', 'storm_run', 'run_stop', 'visit', 'visit_photo', 'visit_correction', 'problem_report', 'invoice_draft', 'installment_invoice', 'message_log', 'sms_consent', 'proof_packet', 'driver_action', 'driver_position'] as const;
const SERVER_ONLY = ['job', 'stripe_event', 'lead', 'short_link', 'cached_lookup', 'app_setting', 'weather_snapshot'] as const;

/** Expects the statement to fail or touch nothing. Each attempt gets its own transaction. */
/** Drizzle wraps Postgres errors; the database's own message is on the cause. */
async function rejectsWith(p: Promise<unknown>, re: RegExp) {
  const err = await p.then(() => null, (e: { message: string; cause?: { message?: string } }) => e);
  expect(err, 'expected the statement to be refused').not.toBeNull();
  expect(err!.cause?.message ?? err!.message).toMatch(re);
}

async function deniedOrZero(user: string, stmt: (tx: Tx) => Promise<unknown>) {
  let rows: unknown;
  try {
    rows = await withUser(user, stmt);
  } catch {
    return;
  }
  const count = (rows as { count?: number }).count ?? (rows as unknown[]).length ?? 0;
  expect(count).toBe(0);
}

describe('every public table has RLS', () => {
  it('leaves no table without it', async () => {
    const rows = await db.execute(sql`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
    expect(rows).toEqual([]);
  });
});

describe('tenant isolation', () => {
  for (const table of TENANT_TABLES) {
    it(`tenant A reads nothing of tenant B in ${table}`, async () => {
      const rows = await withUser(A.owner, (tx) => tx.execute(sql`select * from ${sql.identifier(table)} where tenant_id = ${B.tenant}`));
      expect(rows.length).toBe(0);
    });
    it(`tenant A cannot update or delete tenant B in ${table}`, async () => {
      await deniedOrZero(A.owner, (tx) => tx.execute(sql`update ${sql.identifier(table)} set tenant_id = tenant_id where tenant_id = ${B.tenant} returning 1`));
      await deniedOrZero(A.owner, (tx) => tx.execute(sql`delete from ${sql.identifier(table)} where tenant_id = ${B.tenant} returning 1`));
    });
  }
  it('sanity: tenant B can see its own rows, so the checks above are not passing on empty tables', async () => {
    for (const table of TENANT_TABLES.filter((t) => t !== 'installment_invoice')) {
      const rows = await withUser(B.owner, (tx) => tx.execute(sql`select 1 from ${sql.identifier(table)} where tenant_id = ${B.tenant}`));
      expect(rows.length, table).toBeGreaterThan(0);
    }
  });
  it('tenant A cannot see the tenant B row or membership', async () => {
    expect((await withUser(A.owner, (tx) => tx.select().from(s.tenant))).map((t) => t.id)).toEqual([A.tenant]);
    expect((await withUser(A.owner, (tx) => tx.select().from(s.membership))).every((m) => m.tenant_id === A.tenant)).toBe(true);
  });
  it('tenant A cannot insert rows into tenant B', async () => {
    await expect(withUser(A.owner, (tx) => tx.insert(s.customer).values({ tenant_id: B.tenant, name: 'evil', kind: 'commercial' }))).rejects.toThrow();
    await expect(withUser(A.owner, (tx) => tx.insert(s.crew_member).values({ tenant_id: B.tenant, name: 'evil', kind: 'sub' }))).rejects.toThrow();
  });
  it('tenant A cannot reference a tenant B row from its own row', async () => {
    await rejectsWith(withUser(A.owner, (tx) => tx.insert(s.site).values({ tenant_id: A.tenant, customer_id: ids.bCustomer, label: 'evil', address: 'x', lat: 1, lon: 1 })), /does not belong/);
    await rejectsWith(withUser(A.owner, (tx) => tx.insert(s.route_stop).values({ route_id: ids.aRoute, site_id: ids.bSite, seq: 2, tenant_id: A.tenant })), /does not belong/);
  });
  for (const table of SERVER_ONLY) {
    it(`office users cannot touch server-only table ${table}`, async () => {
      await expect(withUser(A.owner, (tx) => tx.execute(sql`select * from ${sql.identifier(table)} limit 1`))).rejects.toThrow();
    });
  }
  it('anon cannot read anything', async () => {
    await expect(db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('role', 'anon', true)`);
      return tx.select().from(s.customer);
    })).rejects.toThrow();
  });
});

describe('roles', () => {
  it('viewers can read but not write', async () => {
    expect((await withUser(A.viewer, (tx) => tx.select().from(s.customer))).length).toBeGreaterThan(0);
    await expect(withUser(A.viewer, (tx) => tx.insert(s.customer).values({ tenant_id: A.tenant, name: 'nope', kind: 'commercial' }))).rejects.toThrow();
    await deniedOrZero(A.viewer, (tx) => tx.execute(sql`update customer set name = 'nope' where tenant_id = ${A.tenant} returning 1`));
  });
  it('dispatchers can write customers but not change the tenant', async () => {
    const out = await withUser(A.dispatcher, (tx) => tx.insert(s.customer).values({ tenant_id: A.tenant, name: 'ok', kind: 'residential' }).returning());
    expect(out).toHaveLength(1);
    await deniedOrZero(A.dispatcher, (tx) => tx.execute(sql`update tenant set name = 'nope' where id = ${A.tenant} returning 1`));
  });
  it('owners cannot grant themselves a plan, a free season, Stripe status or SMS approval', async () => {
    for (const change of [sql`plan = 'pro'`, sql`free_season_until = '2099-01-01'`, sql`stripe_charges_enabled = true`, sql`stripe_account_id = 'acct_x'`, sql`sms_status = 'approved'`, sql`sms_sender = '+18335550000'`, sql`slug = 'taken'`]) {
      await rejectsWith(withUser(A.owner, (tx) => tx.execute(sql`update tenant set ${change} where id = ${A.tenant}`)), /permission denied/);
    }
  });
  it('nobody in the office can write SMS consent directly', async () => {
    await rejectsWith(withUser(A.owner, (tx) => tx.insert(s.sms_consent).values({ tenant_id: A.tenant, phone_e164: '+12165550000', party: 'crew', opted_in_at: '2026-01-01T00:00:00Z' })), /permission denied/);
  });
  it('owners can change their tenant', async () => {
    const out = await withUser(A.owner, (tx) => tx.execute(sql`update tenant set contact_email = 'a@flake.test' where id = ${A.tenant} returning 1`));
    expect(out.length).toBe(1);
  });
});

describe('append-only evidence', () => {
  it('office users cannot insert, update or delete visits', async () => {
    await expect(withUser(A.owner, (tx) => tx.execute(sql`update visit set notes = 'x' where id = ${ids.aVisit}`))).rejects.toThrow();
    await expect(withUser(A.owner, (tx) => tx.execute(sql`delete from visit where id = ${ids.aVisit}`))).rejects.toThrow();
    await expect(withUser(A.owner, (tx) => tx.insert(s.visit).values({ tenant_id: A.tenant, client_uuid: randomUUID(), storm_id: ids.aStorm, site_id: ids.aSite, crew_id: ids.aCrew, services: [], arrived_device_at: '2025-12-12T00:00:00Z' }))).rejects.toThrow();
  });
  it('office users cannot update or delete photos, snapshots or corrections', async () => {
    for (const table of ['visit_photo', 'weather_snapshot', 'visit_correction']) {
      await expect(withUser(A.owner, (tx) => tx.execute(sql`update ${sql.identifier(table)} set id = id`))).rejects.toThrow();
      await expect(withUser(A.owner, (tx) => tx.execute(sql`delete from ${sql.identifier(table)}`))).rejects.toThrow();
    }
  });
  it('even the service role cannot delete a visit, or edit timestamps or GPS', async () => {
    await rejectsWith(db.execute(sql`delete from visit where id = ${ids.aVisit}`), /append-only/);
    await rejectsWith(db.execute(sql`update visit set arrive_lat = 1, departed_device_at = now() where id = ${ids.bVisit}`), /immutable/);
    await rejectsWith(db.execute(sql`update visit set arrived_device_at = now(), departed_device_at = now() where id = ${ids.bVisit}`), /immutable/);
    await rejectsWith(db.execute(sql`update visit set notes = 'x' where id = ${ids.bVisit}`), /only complete/);
  });
  it('a visit completes exactly once, then can never change', async () => {
    await db.execute(sql`update visit set departed_device_at = now(), departed_received_at = now(), depth_in = 3 where id = ${ids.aVisit}`);
    await rejectsWith(db.execute(sql`update visit set depth_in = 9 where id = ${ids.aVisit}`), /completed visit/);
    await rejectsWith(db.execute(sql`update visit set departed_device_at = now() where id = ${ids.aVisit}`), /completed visit/);
  });
  it('the service role cannot change photos or snapshots', async () => {
    await rejectsWith(db.execute(sql`update visit_photo set sha256 = 'x' where tenant_id = ${B.tenant}`), /append-only/);
    await rejectsWith(db.execute(sql`delete from visit_photo where tenant_id = ${B.tenant}`), /append-only/);
    const [snap] = await db.insert(s.weather_snapshot).values({ source: 'nws_grid', fetched_at: '2025-12-12T00:00:00Z', request_url: 'u', storage_path: 'p', sha256: 'h', summary: {} }).returning();
    await rejectsWith(db.execute(sql`update weather_snapshot set sha256 = 'x' where id = ${snap!.id}`), /append-only/);
    await rejectsWith(db.execute(sql`delete from weather_snapshot where id = ${snap!.id}`), /append-only/);
  });
  it('corrections can be added by a writer as themselves, and only that way', async () => {
    const ok = await withUser(A.owner, (tx) => tx.insert(s.visit_correction).values({ tenant_id: A.tenant, visit_id: ids.aVisit, field: 'depth_in', new_value: 4, reason: 'typo', by_user: A.owner }).returning());
    expect(ok).toHaveLength(1);
    await expect(withUser(A.owner, (tx) => tx.insert(s.visit_correction).values({ tenant_id: A.tenant, visit_id: ids.aVisit, field: 'depth_in', reason: 'x', by_user: B.owner }))).rejects.toThrow();
    await expect(withUser(A.owner, (tx) => tx.insert(s.visit_correction).values({ tenant_id: A.tenant, visit_id: ids.aVisit, field: 'arrived_device_at', reason: 'x', by_user: A.owner }))).rejects.toThrow();
    await expect(withUser(A.viewer, (tx) => tx.insert(s.visit_correction).values({ tenant_id: A.tenant, visit_id: ids.aVisit, field: 'depth_in', reason: 'x', by_user: A.viewer }))).rejects.toThrow();
  });
});

describe('weather snapshot view', () => {
  it('shows a tenant only its own cells and its own NOHRSC samples', async () => {
    const [mine] = await db.insert(s.weather_snapshot).values({ source: 'nws_grid', office: 'CLE', grid_x: 1, grid_y: 1, fetched_at: '2025-12-12T00:00:00Z', request_url: 'u', storage_path: 'p', sha256: 'h', summary: {} }).returning();
    const [theirs] = await db.insert(s.weather_snapshot).values({ source: 'nws_grid', office: 'CLE', grid_x: 2, grid_y: 2, fetched_at: '2025-12-12T00:00:00Z', request_url: 'u', storage_path: 'p', sha256: 'h', summary: {} }).returning();
    const [nohrsc] = await db.insert(s.weather_snapshot).values({ source: 'nohrsc', fetched_at: '2025-12-12T00:00:00Z', request_url: 'u', storage_path: 'p', sha256: 'h', summary: { sites: { [ids.aSite]: { h24: 1 }, [ids.bSite]: { h24: 2 } } } }).returning();
    const rows = (await withUser(A.owner, (tx) => tx.execute(sql`select id, summary from tenant_weather_snapshot`))) as unknown as { id: string; summary: { sites?: Record<string, unknown> } }[];
    expect(rows.some((r) => r.id === mine!.id)).toBe(true);
    expect(rows.some((r) => r.id === theirs!.id)).toBe(false);
    expect(Object.keys(rows.find((r) => r.id === nohrsc!.id)!.summary.sites!)).toEqual([ids.aSite]);
  });
});

describe('driverScope', () => {
  const scope = () => driverScope(db, { tenantId: A.tenant, runId: ids.aRun, crewId: ids.aCrew, stormId: ids.aStorm });
  it('sees only its own run', async () => {
    expect((await scope().stops()).map((x) => x.id)).toEqual([ids.aStop]);
    expect(await scope().stop(ids.aStop)).not.toBeNull();
  });
  it('cannot touch another run in the same tenant, or another tenant', async () => {
    expect(await scope().stop(ids.aStop2)).toBeNull();
    expect(await scope().stop(ids.bStop)).toBeNull();
  });
  it('can still reach a stop that was moved away from it', async () => {
    await db.execute(sql`update run_stop set previous_run_ids = array[${ids.aRun}::uuid] where id = ${ids.aStop2}`);
    expect(await scope().stop(ids.aStop2)).not.toBeNull();
  });
});

describe('advisor hardening', () => {
  it('keeps security-definer helpers out of the exposed public schema', async () => {
    const rows = (await db.execute(sql`
      select p.proname, n.nspname, p.prosecdef,
        has_function_privilege('anon', p.oid, 'execute') as anon_exec,
        has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where p.proname in ('auth_tenant_ids','auth_write_tenant_ids','auth_owner_tenant_ids','check_tenant_ref','tenant_weather_snapshot')
      order by p.proname`)) as unknown as { proname: string; nspname: string; prosecdef: boolean; anon_exec: boolean; auth_exec: boolean }[];
    expect(rows.map((r) => r.nspname)).toEqual(['private', 'private', 'private', 'private', 'private']);
    expect(rows.every((r) => r.prosecdef && r.auth_exec && !r.anon_exec)).toBe(true);
  });
  it('publishes weather through a security-invoker view', async () => {
    const rows = (await db.execute(sql`
      select c.reloptions from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'tenant_weather_snapshot' and c.relkind = 'v'`)) as unknown as { reloptions: string[] | null }[];
    expect(String(rows[0]?.reloptions)).toMatch(/security_invoker=(true|on)/);
  });
  it('pins search_path on the append-only triggers', async () => {
    const rows = (await db.execute(sql`
      select p.proname, p.proconfig from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('reject_change','visit_guard')`)) as unknown as { proconfig: string[] | null }[];
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => (r.proconfig ?? []).some((c) => c.startsWith('search_path=')))).toBe(true);
  });
  it('does not overlap permissive membership policies for one command', async () => {
    const rows = (await db.execute(sql`
      select pol.polcmd from pg_policy pol
      join pg_class c on c.oid = pol.polrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'membership'`)) as unknown as { polcmd: string }[];
    const commands = rows.map((r) => r.polcmd).sort();
    expect(commands).toEqual(['a', 'd', 'r', 'w']);
  });
  it('indexes every foreign key', async () => {
    const rows = await db.execute(sql`
      select c.conrelid::regclass::text as tbl, a.attname as col
      from pg_constraint c
      join lateral unnest(c.conkey) with ordinality as k(attnum, ord) on true
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
      where c.contype = 'f' and c.connamespace = 'public'::regnamespace and k.ord = 1
        and not exists (
          select 1 from pg_index i
          where i.indrelid = c.conrelid and i.indisvalid and i.indkey[0] = k.attnum
        )`);
    expect(rows).toEqual([]);
  });
});

describe('schema drift', () => {
  it('every Drizzle column exists in Postgres', async () => {
    const { getTableColumns, getTableName, is } = await import('drizzle-orm');
    const { PgTable } = await import('drizzle-orm/pg-core');
    for (const table of Object.values(s)) {
      if (!is(table, PgTable)) continue;
      const name = getTableName(table);
      const cols = (await db.execute(sql`select column_name from information_schema.columns where table_schema = 'public' and table_name = ${name}`)) as unknown as { column_name: string }[];
      const have = new Set(cols.map((c) => c.column_name));
      for (const col of Object.values(getTableColumns(table))) expect(have.has(col.name), `${name}.${col.name}`).toBe(true);
    }
  });
});
