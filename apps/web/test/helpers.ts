import { randomUUID } from 'node:crypto';
import { contract, crew_member, customer, membership, route, route_stop, serviceDb, site, sms_consent, sql, tenant } from '@flake/db';
import { runJobs } from '@/lib/handlers';
import { createStorm as startStorm } from '@/lib/storms';
import { hashToken } from '@/lib/tokens';

export const iso = (d = new Date()) => d.toISOString();
export { randomUUID as uuid };

export interface World {
  tenantId: string;
  userId: string;
  viewerId: string;
  crewId: string;
  crew2Id: string;
  routeId: string;
  route2Id: string;
  customerIds: string[];
  siteIds: string[];
}

const LAT = 41.48;
const LON = -81.8;

/** A fresh tenant with one site per pricing type on one route, plus a second crew and route. */
export async function makeWorld(opts: { plan?: 'free' | 'pro'; freeUntil?: string | null; smsApproved?: boolean; connected?: boolean } = {}): Promise<World> {
  const db = serviceDb();
  const tenantId = randomUUID();
  const userId = randomUUID();
  const viewerId = randomUUID();
  for (const [id, label] of [[userId, 'o'], [viewerId, 'v']] as const) {
    await db.execute(sql`insert into auth.users (id, email, aud, role, instance_id) values (${id}, ${`${label}-${id}@flake.test`}, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000')`);
  }
  await db.insert(tenant).values({
    id: tenantId, name: 'Test Plow', slug: `t-${tenantId}`, plan: opts.plan ?? 'free', free_season_until: opts.freeUntil === undefined ? null : opts.freeUntil,
    stripe_account_id: opts.connected === false ? null : `acct_mock_${tenantId.slice(0, 8)}`, stripe_charges_enabled: opts.connected !== false,
    sms_status: opts.smsApproved ? 'approved' : 'none', sms_sender: opts.smsApproved ? `+1833${Math.floor(Math.random() * 9000000 + 1000000)}` : null, twilio_subaccount_sid: opts.smsApproved ? 'AC_mock' : null, contact_email: 'owner@flake.test',
  });
  await db.insert(membership).values([{ tenant_id: tenantId, user_id: userId, role: 'owner' }, { tenant_id: tenantId, user_id: viewerId, role: 'viewer' }]);
  const crewId = randomUUID();
  const crew2Id = randomUUID();
  await db.insert(crew_member).values([
    { id: crewId, tenant_id: tenantId, name: 'Crew One', kind: 'employee', phone_e164: '+12165550191', email: 'crew1@flake.test' },
    { id: crew2Id, tenant_id: tenantId, name: 'Crew Two', kind: 'sub', phone_e164: '+12165550192', email: 'crew2@flake.test', sub_rate_card: { per_visit_cents: 1000 } },
  ]);
  const routeId = randomUUID();
  const route2Id = randomUUID();
  await db.insert(route).values([{ id: routeId, tenant_id: tenantId, name: 'Route A', default_crew_id: crewId }, { id: route2Id, tenant_id: tenantId, name: 'Route B', default_crew_id: crew2Id }]);
  const pricings = [
    { service: 'plow', trigger_in: 2, pricing: { type: 'per_push', amount_cents: 6500 } },
    { service: 'plow', trigger_in: 2, pricing: { type: 'per_inch_tier', tiers: [{ up_to_in: 4, amount_cents: 15000 }, { up_to_in: null, amount_cents: 25000 }] } },
    { service: 'plow', trigger_in: 1, pricing: { type: 'per_event', amount_cents: 30000 } },
    { service: 'plow', trigger_in: 2, pricing: { type: 'seasonal', total_cents: 300000, installments: 5 } },
    { service: 'plow', trigger_in: 2, pricing: { type: 'hourly', rate_cents: 12000 } },
  ];
  const customerIds: string[] = [];
  const siteIds: string[] = [];
  for (const [i, p] of pricings.entries()) {
    const customerId = randomUUID();
    const siteId = randomUUID();
    customerIds.push(customerId);
    siteIds.push(siteId);
    await db.insert(customer).values({ id: customerId, tenant_id: tenantId, name: `Customer ${i}`, kind: i === 0 ? 'residential' : 'commercial', email: `c${i}-${customerId}@flake.test`, phone_e164: `+1216555${String(1000 + i)}`, billing_mode: i === 2 ? 'invoice_net30' : 'card_on_file', stripe_payment_method_id: 'pm_mock_4242', notify_sms: true });
    await db.insert(site).values({ id: siteId, tenant_id: tenantId, customer_id: customerId, label: `Site ${i}`, address: `${i} Main St, Lakewood, OH`, lat: LAT + i * 0.001, lon: LON, service_window: i === 2 ? { open_by: '06:00' } : null });
    await db.insert(contract).values({ tenant_id: tenantId, site_id: siteId, season: '2026-27', status: 'accepted', services: [p] });
    await db.insert(route_stop).values({ route_id: routeId, site_id: siteId, seq: i + 1, tenant_id: tenantId });
  }
  const extra = randomUUID();
  const extraCustomer = randomUUID();
  await db.insert(customer).values({ id: extraCustomer, tenant_id: tenantId, name: 'Customer B', kind: 'commercial', email: `b-${extra}@flake.test` });
  await db.insert(site).values({ id: extra, tenant_id: tenantId, customer_id: extraCustomer, label: 'Site B', address: '9 Side St, Lakewood, OH', lat: LAT, lon: LON + 0.001 });
  await db.insert(route_stop).values({ route_id: route2Id, site_id: extra, seq: 1, tenant_id: tenantId });
  return { tenantId, userId, viewerId, crewId, crew2Id, routeId, route2Id, customerIds, siteIds: [...siteIds, extra] };
}

export const ctxOf = (w: World) => ({ userId: w.userId, tenantId: w.tenantId });

export async function drain() {
  for (let i = 0; i < 30; i++) {
    await serviceDb().execute(sql`update job set run_at = now() where done_at is null and dead_at is null and run_at > now()`);
    const { ran } = await runJobs(100);
    if (!ran) return;
  }
}

export async function consent(tenantId: string, phone: string, party: 'crew' | 'customer' = 'crew') {
  await serviceDb().insert(sms_consent).values({ tenant_id: tenantId, phone_e164: phone, party, opted_in_at: iso(), opted_in_source: 'test' }).onConflictDoNothing();
}

export const req = (url: string, init?: RequestInit) => new Request(`http://localhost:3999${url}`, init);
export const jsonReq = (url: string, body: unknown, method = 'POST') => req(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** Completes a stop through the same batch the phone would send. */
export function stopActions(stopId: string, at: Date, opts: { depth?: number; salt?: { unit: string; qty: number }[]; services?: string[]; gps?: { lat: number; lon: number } | null; minutes?: number } = {}) {
  const visit = randomUUID();
  const done = new Date(at.getTime() + (opts.minutes ?? 20) * 60000);
  return {
    visit,
    actions: [
      { client_uuid: randomUUID(), at: at.toISOString(), kind: 'arrive', run_stop_id: stopId, visit_client_uuid: visit, gps: opts.gps === undefined ? { lat: LAT, lon: LON, acc: 5 } : opts.gps },
      { client_uuid: randomUUID(), at: done.toISOString(), kind: 'done', run_stop_id: stopId, visit_client_uuid: visit, services: opts.services ?? ['plow'], depth_in: opts.depth ?? 3, salt: opts.salt ?? null, gps: null },
    ],
  };
}

export const tokenHash = hashToken;

/**
 * Starts a storm the way an office does when one is still running on the same lots: that one is closed first. A lot
 * can be live on one storm at a time (issue 24); tests that check the block itself call the real createStorm.
 */
export async function createStorm(...args: Parameters<typeof startStorm>) {
  await serviceDb().execute(sql`update storm set status = 'closed', closed_at = now() where tenant_id = ${args[0].tenantId} and status = 'active'`);
  return startStorm(...args);
}
