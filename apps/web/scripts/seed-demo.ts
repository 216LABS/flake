import { createHash } from 'node:crypto';
import { contract, crew_member, customer, eq, membership, message_log, proof_packet, route, route_stop, run_stop, serviceDb, closeDb, site, sms_consent, sql, storm, storm_run, tenant, visit, visit_photo } from '@flake/db';
import { SEED_CREW, SEED_ROUTES, SEED_SITES } from '@flake/db/seed-data';
import { DEFAULT_RATE_CARD } from '@flake/core/quote';
import { FREE_SEASON_END } from '@flake/core/fees';
import sharp from 'sharp';
import { adminClient, putBlob } from '../lib/blob';
import { generateDrafts } from '../lib/billing';
import { renderProof } from '../lib/proof';
import { setSetting } from '../lib/providers';
import { encryptToken, hashToken, sha256Hex } from '../lib/tokens';
import { fetchAlerts, fetchCell, fetchNohrsc, latestSnapshotIds, mapSites } from '../lib/weather';

const SEED = 'flake-demo-v1';
/** Stable, valid UUIDs so re-running changes nothing. */
function id(key: string): string {
  const h = createHash('sha256').update(`${SEED}:${key}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const PASSWORD = 'flake-demo-only'; // Local-only demo login. /api/dev/login returns 404 in production.

async function ensureUser(email: string): Promise<string> {
  const admin = adminClient().auth.admin;
  // Look up by email directly: test runs add thousands of users, more than one page of listUsers.
  const found = (await serviceDb().execute(sql`select id from auth.users where lower(email) = lower(${email}) limit 1`)) as unknown as { id: string }[];
  if (found[0]) return found[0].id;
  const { data, error } = await admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw new Error(`Could not create ${email}: ${error.message}`);
  return data.user.id;
}

/** A placeholder image clearly watermarked DEMO, at full field-photo size. */
async function demoPhoto(phase: string, label: string): Promise<{ bytes: Buffer; width: number; height: number }> {
  const width = 2048;
  const height = 1536;
  const shade = phase === 'before' ? '#9fb3c8' : '#d9e2ec';
  const safe = label.replace(/[<>&"']/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${shade}"/><text x="50%" y="46%" font-family="Arial" font-size="260" font-weight="700" fill="#102a43" text-anchor="middle" opacity="0.8">DEMO</text><text x="50%" y="58%" font-family="Arial" font-size="72" fill="#102a43" text-anchor="middle">${phase.toUpperCase()}: ${safe}</text><text x="50%" y="66%" font-family="Arial" font-size="48" fill="#102a43" text-anchor="middle">Placeholder image, not a real photo</text></svg>`;
  return { bytes: await sharp(Buffer.from(svg)).jpeg({ quality: 70 }).toBuffer(), width, height };
}

async function main() {
  const db = serviceDb();
  const ownerId = await ensureUser('demo@flake.test');
  const dispatcherId = await ensureUser('dispatch@flake.test');
  const tenantId = id('tenant');

  await db.insert(tenant).values({
    id: tenantId, name: 'Lakeshore Plow Co. (Demo)', slug: 'lakeshore-demo', free_season_until: FREE_SEASON_END, rate_card: DEFAULT_RATE_CARD,
    stripe_account_id: 'acct_mock_demo', stripe_charges_enabled: true, twilio_subaccount_sid: 'AC_mock_demo', sms_sender: '+18335550100', sms_status: 'approved',
    business_legal_name: 'Lakeshore Plow Co. (Demo)', ein_last4: '0000', contact_email: 'demo@flake.test', contact_phone: '+12165550100',
    address: { line1: '100 Example St', city: 'Lakewood', state: 'OH', zip: '44107' }, sms_verification: { contact_name: 'Demo Owner' },
  }).onConflictDoNothing();
  await db.insert(membership).values([{ tenant_id: tenantId, user_id: ownerId, role: 'owner' }, { tenant_id: tenantId, user_id: dispatcherId, role: 'dispatcher' }]).onConflictDoNothing();

  for (const c of SEED_CREW) {
    await db.insert(crew_member).values({ id: id(`crew:${c.key}`), tenant_id: tenantId, name: c.name, phone_e164: c.phone, email: c.email, kind: c.kind, language: c.language, joined_at: new Date().toISOString(), ...(c.kind === 'sub' ? { sub_rate_card: { per_visit_cents: 2500, hourly_cents: 6000, per_bag_cents: 200 } } : {}) }).onConflictDoNothing();
    await db.insert(sms_consent).values({ tenant_id: tenantId, phone_e164: c.phone, party: 'crew', opted_in_at: new Date().toISOString(), opted_in_source: 'crew_invite' }).onConflictDoNothing();
  }
  for (const r of SEED_ROUTES) {
    await db.insert(route).values({ id: id(`route:${r.key}`), tenant_id: tenantId, name: r.name, default_crew_id: id(`crew:${r.crew}`) }).onConflictDoNothing();
  }

  const seqByRoute: Record<string, number> = {};
  for (const [i, s] of SEED_SITES.entries()) {
    const customerId = id(`customer:${s.key}`);
    const phone = `+121655501${String(10 + i).padStart(2, '0')}`;
    await db.insert(customer).values({
      id: customerId, tenant_id: tenantId, name: s.kind === 'residential' ? `${s.street} Household (Demo)` : `${s.label} (Demo)`, kind: s.kind, contact_name: 'Demo Contact', phone_e164: phone, email: `customer-${s.key}@flake.test`,
      billing_mode: s.billing, stripe_customer_id: `cus_mock_${s.key}`, stripe_payment_method_id: s.pm ?? null, notify_sms: i % 2 === 0, notify_email: true,
    }).onConflictDoNothing();
    if (i % 2 === 0) await db.insert(sms_consent).values({ tenant_id: tenantId, phone_e164: phone, party: 'customer', opted_in_at: new Date().toISOString(), opted_in_source: 'quote_page' }).onConflictDoNothing();
    await db.insert(site).values({
      id: id(`site:${s.key}`), tenant_id: tenantId, customer_id: customerId, label: s.label, address: `${s.street}, ${s.city}, OH`, lat: s.lat, lon: s.lon,
      priority: s.priority ?? 3, service_window: s.open_by ? { open_by: s.open_by } : null, notes: s.kind === 'residential' ? 'Keep clear of the mailbox.' : 'Pile snow at the back of the lot.',
    }).onConflictDoNothing();
    const services = [{ service: 'plow', trigger_in: s.trigger, pricing: s.pricing }, ...(s.salt ? [{ service: 'salt', trigger_in: null }] : [])];
    await db.insert(contract).values({
      id: id(`contract:${s.key}`), tenant_id: tenantId, site_id: id(`site:${s.key}`), season: '2026-27', status: 'accepted', services, salt_pricing: s.salt ? { unit: 'bag50lb', amount_cents: 1800 } : null,
      terms_md: 'Demo contract terms.', accepted_at: '2025-11-01T15:00:00Z', accepted_name: 'Demo Contact',
    }).onConflictDoNothing();
    const seq = (seqByRoute[s.route] = (seqByRoute[s.route] ?? 0) + 1);
    await db.insert(route_stop).values({ route_id: id(`route:${s.route}`), site_id: id(`site:${s.key}`), seq, tenant_id: tenantId }).onConflictDoNothing();
  }
  await mapSites(tenantId);

  const stormId = id('storm:history');
  const [existing] = await db.select({ id: storm.id }).from(storm).where(eq(storm.id, stormId));
  if (!existing) {
    await seedHistory(tenantId, stormId);
    console.log('Seeded the historical storm.');
  }
  // Separate from the storm so an interrupted seed finishes these on the next run.
  await generateDrafts({ userId: ownerId, tenantId }, stormId);
  const [packet] = await db.select({ id: proof_packet.id }).from(proof_packet).where(eq(proof_packet.id, id('proof:c1')));
  if (!packet) await renderProof({ tenantId, siteId: id('site:c1'), from: '2025-12-01T00:00:00Z', to: '2025-12-31T23:59:59Z', packetId: id('proof:c1'), createdBy: ownerId });
  await setSetting('dev.weather_fixture', 'lakewood-lake-effect-2025-12');
  await setSetting('dev.clock', '2025-12-12T12:00:00Z');
  console.log('Demo tenant ready. Sign in at /login with "Use the demo company".');
}

/** One completed storm: every run done except for the three flags the billing demo needs. */
async function seedHistory(tenantId: string, stormId: string) {
  const db = serviceDb();
  await setSetting('dev.weather_fixture', 'lakewood-lake-effect-2025-12');
  await setSetting('dev.clock', '2025-12-13T06:00:00Z');
  const cells = await db.selectDistinct({ office: site.nws_office, x: site.nws_grid_x, y: site.nws_grid_y }).from(site).where(eq(site.tenant_id, tenantId));
  for (const c of cells) await fetchCell(c.office!, c.x!, c.y!);
  await fetchAlerts(tenantId);
  await setSetting('dev.clock', '2025-12-13T13:00:00Z');
  await fetchNohrsc(24);
  // Evaluations queued above would judge the old clock. This demo starts with a clean slate.
  await db.execute(sql`delete from job where kind = 'trigger.evaluate'`);
  const snapshotIds = await latestSnapshotIds(tenantId);

  await db.insert(storm).values({ id: stormId, tenant_id: tenantId, name: 'Dec 13 Lake-Effect Storm (Demo)', started_at: '2025-12-13T04:00:00Z', closed_at: '2025-12-13T18:00:00Z', status: 'closed', forecast_snapshot_ids: snapshotIds });

  const missing = 'r3'; // missing_visit
  const noPhoto = 'r5'; // no_after_photo
  const noSalt = 'c4'; // missing_salt_qty
  let clock = Date.parse('2025-12-13T05:00:00Z');
  for (const r of SEED_ROUTES) {
    const runId = id(`run:${r.key}`);
    const token = `demo-history-${r.key}`;
    await db.insert(storm_run).values({ id: runId, tenant_id: tenantId, storm_id: stormId, route_id: id(`route:${r.key}`), crew_id: id(`crew:${r.crew}`), link_token_hash: hashToken(token), link_token_enc: encryptToken(token), link_expires_at: '2025-12-14T18:00:00Z', published_at: '2025-12-13T04:05:00Z', started_at: '2025-12-13T04:30:00Z' });
    const sites = SEED_SITES.filter((s) => s.route === r.key);
    for (const [i, s] of sites.entries()) {
      const stopId = id(`stop:${s.key}`);
      const done = s.key !== missing;
      await db.insert(run_stop).values({ id: stopId, tenant_id: tenantId, storm_run_id: runId, site_id: id(`site:${s.key}`), seq: i + 1, status: done ? 'done' : 'open' });
      if (!done) continue;
      const arrived = new Date(clock).toISOString();
      const departed = new Date(clock + (s.pricing.type === 'hourly' ? 95 : 25) * 60000).toISOString();
      clock += 70 * 60000 / 3;
      const visitId = id(`visit:${s.key}`);
      const services = s.salt ? ['plow', 'salt'] : ['plow'];
      await db.insert(visit).values({
        id: visitId, tenant_id: tenantId, client_uuid: id(`visit-client:${s.key}`), storm_id: stormId, run_stop_id: stopId, site_id: id(`site:${s.key}`), crew_id: id(`crew:${r.crew}`), services,
        arrived_device_at: arrived, arrived_received_at: arrived, departed_device_at: departed, departed_received_at: departed, arrive_lat: s.lat + 0.00005, arrive_lon: s.lon - 0.00005, arrive_acc_m: 8, depart_lat: s.lat, depart_lon: s.lon,
        depth_in: 3 + (i % 2), salt: s.salt && s.key !== noSalt ? [{ unit: 'bag50lb', qty: 2 + (i % 3) }] : null, gps_match: true,
      });
      for (const phase of ['before', 'after'] as const) {
        if (phase === 'after' && s.key === noPhoto) continue;
        const { bytes, width, height } = await demoPhoto(phase, s.label);
        const client = id(`photo:${s.key}:${phase}`);
        const path = `${tenantId}/${visitId}/${client}.jpg`;
        await putBlob('photos', path, bytes, 'image/jpeg', { upsert: true });
        await db.insert(visit_photo).values({ tenant_id: tenantId, visit_id: visitId, client_uuid: client, phase, storage_path: path, sha256: sha256Hex(bytes), width, height, taken_device_at: phase === 'before' ? arrived : departed, received_at: phase === 'before' ? arrived : departed });
      }
      await db.insert(message_log).values({
        tenant_id: tenantId, channel: 'email', to_addr: `customer-${s.key}@flake.test`, template: 'done', body: `Lakeshore Plow Co. (Demo): ${s.label} cleared.`, related: { site_id: id(`site:${s.key}`), storm_id: stormId, visit_id: visitId }, provider_id: `em_mock_seed_${s.key}`, status: 'sent', idempotency_key: `seed:done:${s.key}`, created_at: departed,
      }).onConflictDoNothing();
    }
  }
}

main()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
