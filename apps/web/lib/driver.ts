import { and, asc, contract, crew_member, desc, driver_action, driver_position, driverScope, eq, inArray, problem_report, run_stop, serviceDb, site, site_pin, sql, storm, storm_run, tenant, visit, visit_correction, visit_photo, type DriverScope, type Tx } from '@flake/db';
import { driverAction, type DriverAction } from '@flake/contracts';
import { gpsMatches } from '@flake/core/geo';
import type { ContractService } from '@flake/core/pricing';
import type { MultiPolygon, Polygon } from 'geojson';
import { getBlob, putBlob, signedUploadUrl } from './blob';
import { log } from './log';
import { queuePush } from './messaging';
import { HttpError } from './http';
import { enqueue } from './jobs';
import { baseUrl } from './env';
import { hashToken, sha256Hex } from './tokens';

export const UNDO_WINDOW_MS = 2 * 60 * 1000;
const ON_THE_WAY_FRESH_MS = 15 * 60 * 1000;

export interface RunScope {
  scope: DriverScope;
  run: typeof storm_run.$inferSelect;
  storm: typeof storm.$inferSelect;
  crew: typeof crew_member.$inferSelect | null;
  tenant: typeof tenant.$inferSelect;
}

/** Token to run. Unknown, revoked and expired links all read the same to the driver: ask for a new one. */
export async function resolveToken(token: string): Promise<RunScope> {
  const db = serviceDb();
  const [row] = await db.select({ run: storm_run, storm, tenant, crew: crew_member }).from(storm_run)
    .innerJoin(storm, eq(storm.id, storm_run.storm_id))
    .innerJoin(tenant, eq(tenant.id, storm_run.tenant_id))
    .leftJoin(crew_member, eq(crew_member.id, storm_run.crew_id))
    .where(eq(storm_run.link_token_hash, hashToken(token)));
  const expired = row && Date.parse(row.run.link_expires_at) < Date.now();
  if (!row || row.run.link_revoked_at || expired) throw new HttpError(410, 'This link is no longer active', 'link_dead');
  return {
    scope: driverScope(db, { tenantId: row.run.tenant_id, runId: row.run.id, crewId: row.run.crew_id, stormId: row.run.storm_id }),
    run: row.run,
    storm: row.storm,
    crew: row.crew,
    tenant: row.tenant,
  };
}

/** What the phone caches. Every query carries the tenant id and the run id from the token. */
export async function loadRun(rs: RunScope) {
  const db = serviceDb();
  const { tenantId, runId, stormId } = rs.scope;
  const rows = await db.select({ stop: run_stop, site }).from(run_stop).innerJoin(site, eq(site.id, run_stop.site_id)).where(and(eq(run_stop.tenant_id, tenantId), eq(run_stop.storm_run_id, runId))).orderBy(asc(run_stop.seq));
  const siteIds = rows.map((r) => r.site.id);
  const contracts = siteIds.length ? await db.select().from(contract).where(and(eq(contract.tenant_id, tenantId), inArray(contract.site_id, siteIds), eq(contract.status, 'accepted'))).orderBy(desc(contract.created_at)) : [];
  const pins = siteIds.length ? await db.select().from(site_pin).where(and(eq(site_pin.tenant_id, tenantId), inArray(site_pin.site_id, siteIds))) : [];
  const stormVisits = await db.select({ id: visit.id }).from(visit).where(and(eq(visit.tenant_id, tenantId), eq(visit.storm_id, stormId), eq(visit.crew_id, rs.run.crew_id ?? '00000000-0000-0000-0000-000000000000')));
  return {
    company: rs.tenant.name,
    storm: { id: rs.storm.id, name: rs.storm.name, status: rs.storm.status },
    run: { id: rs.run.id, pass: rs.run.pass },
    crew: rs.crew ? { name: rs.crew.name, language: rs.crew.language } : null,
    has_reported_depth: stormVisits.length > 0,
    stops: rows.map(({ stop, site: st }) => {
      const c = contracts.find((x) => x.site_id === st.id);
      const services = ((c?.services ?? [{ service: 'plow' }]) as ContractService[]).map((x) => x.service);
      const salt = c?.salt_pricing as { unit: string } | null | undefined;
      return {
        id: stop.id,
        seq: stop.seq,
        status: stop.status,
        site: { id: st.id, label: st.label, address: st.address, lat: st.lat, lon: st.lon, priority: st.priority, open_by: st.service_window?.open_by ?? null, notes: st.notes },
        pins: pins.filter((p) => p.site_id === st.id).map((p) => ({ id: p.id, kind: p.kind, note: p.note, has_photo: Boolean(p.photo_path) })),
        services,
        salt_unit: salt?.unit ?? (services.includes('salt') ? 'bag50lb' : null),
      };
    }),
  };
}
export type RunPayload = Awaited<ReturnType<typeof loadRun>>;

export type Ack = { client_uuid: string; status: 'ok' | 'duplicate' | 'rejected'; reason?: string };

type Stop = typeof run_stop.$inferSelect;

function setStop(tx: Tx, rs: RunScope, stopId: string, status: Stop['status'], only?: Stop['status'][]) {
  return tx.update(run_stop).set({ status, updated_at: new Date().toISOString() }).where(and(eq(run_stop.tenant_id, rs.scope.tenantId), eq(run_stop.id, stopId), only ? inArray(run_stop.status, only) : undefined));
}

/**
 * Applies one outbox action exactly once. The ledger's unique client_uuid is the idempotency key, and the
 * ledger row and its effects commit together, so a retry after a dropped response changes nothing.
 */
export async function processAction(rs: RunScope, a: DriverAction): Promise<Ack> {
  const { tenantId, runId, crewId, stormId } = rs.scope;
  if (!crewId) return { client_uuid: a.client_uuid, status: 'rejected', reason: 'no_crew' };
  const stop = a.run_stop_id ? await rs.scope.stop(a.run_stop_id) : null;
  if (a.run_stop_id && !stop) return { client_uuid: a.client_uuid, status: 'rejected', reason: 'out_of_scope' };
  const [st] = stop ? await serviceDb().select().from(site).where(and(eq(site.tenant_id, tenantId), eq(site.id, stop.site_id))) : [];

  const after: (() => Promise<void>)[] = [];
  const result = await serviceDb().transaction(async (tx): Promise<Ack> => {
    const payload: Record<string, unknown> = { ...a };
    if (a.kind === 'depth' && st) {
      payload.lat = a.gps?.lat ?? st.lat;
      payload.lon = a.gps?.lon ?? st.lon;
      payload.site_id = st.id;
    }
    const inserted = await tx.insert(driver_action).values({
      tenant_id: tenantId, client_uuid: a.client_uuid, storm_run_id: runId, run_stop_id: a.run_stop_id ?? null, kind: a.kind, payload, device_at: a.at,
    }).onConflictDoNothing({ target: driver_action.client_uuid }).returning({ id: driver_action.id });
    if (!inserted.length) return { client_uuid: a.client_uuid, status: 'duplicate' };

    await tx.update(storm_run).set({ started_at: a.at }).where(and(eq(storm_run.id, runId), sql`started_at is null`));

    switch (a.kind) {
      case 'enroute':
        await setStop(tx, rs, a.run_stop_id, 'enroute', ['open', 'problem']);
        // A phone syncing late may be well past this stop, so only a recent tap tells the customer.
        if (stop!.status === 'open' && Date.now() - Date.parse(a.at) < ON_THE_WAY_FRESH_MS) after.push(() => enqueue('notify.customer', { tenantId, siteId: st!.id, stormId, template: 'on_the_way', key: `on_the_way:${stormId}:${st!.id}` }, { dedupeKey: `notify:on_the_way:${stormId}:${st!.id}` }));
        break;
      case 'arrive': {
        const polygons = st!.polygons as Polygon | MultiPolygon | null;
        await tx.insert(visit).values({
          tenant_id: tenantId, client_uuid: a.visit_client_uuid, storm_id: stormId, run_stop_id: stop!.id, site_id: st!.id, crew_id: crewId, services: [],
          arrived_device_at: a.at, arrive_lat: a.gps?.lat ?? null, arrive_lon: a.gps?.lon ?? null, arrive_acc_m: a.gps?.acc ?? null,
          gps_match: gpsMatches(a.gps?.lat, a.gps?.lon, { lat: st!.lat, lon: st!.lon, polygons }), is_replow: rs.run.pass > 1,
        }).onConflictDoNothing({ target: visit.client_uuid });
        await setStop(tx, rs, stop!.id, 'onsite', ['open', 'enroute', 'problem']);
        break;
      }
      case 'depth':
        after.push(() => enqueue('trigger.evaluate', { tenantId }, { dedupeKey: `eval:${tenantId}:${Math.floor(Date.now() / 60000)}` }));
        break;
      case 'salt':
      case 'photo_meta':
        // Ledger only. Salt totals are final on Done; photos arrive through the upload endpoint.
        break;
      case 'done': {
        const [v] = await tx.select().from(visit).where(and(eq(visit.tenant_id, tenantId), eq(visit.client_uuid, a.visit_client_uuid), eq(visit.crew_id, crewId)));
        if (!v) throw new HttpError(409, 'visit_missing');
        if (v.departed_device_at) break;
        await tx.update(visit).set({
          departed_device_at: a.at, departed_received_at: new Date().toISOString(), depart_lat: a.gps?.lat ?? null, depart_lon: a.gps?.lon ?? null,
          services: a.services, depth_in: a.depth_in ?? null, salt: a.salt?.length ? a.salt : null,
        }).where(eq(visit.id, v.id));
        await setStop(tx, rs, stop!.id, 'done');
        after.push(async () => {
          await enqueue('notify.visit_done', { tenantId, visitId: v.id }, { dedupeKey: `done:${v.id}`, runAt: new Date(Date.now() + 20000) });
          await enqueue('report.completion', { tenantId, visitId: v.id }, { dedupeKey: `report:${v.id}`, runAt: new Date(Date.now() + 60000) });
        });
        break;
      }
      case 'problem': {
        await tx.insert(problem_report).values({ tenant_id: tenantId, client_uuid: a.client_uuid, storm_run_id: runId, site_id: st?.id ?? null, crew_id: crewId, kind: a.problem, note: a.note ?? null }).onConflictDoNothing({ target: problem_report.client_uuid });
        await setStop(tx, rs, stop!.id, a.problem === 'skip' ? 'skipped' : 'problem', ['open', 'enroute', 'onsite', 'problem']);
        after.push(() => queuePush(tenantId, { title: 'Driver problem', body: `${a.problem} at ${st?.label ?? 'a site'}`, url: `/storms/${stormId}`, key: `problem:${a.client_uuid}`, related: { storm_id: stormId } }));
        break;
      }
      case 'undo_last': {
        const [v] = await tx.select().from(visit).where(and(eq(visit.tenant_id, tenantId), eq(visit.client_uuid, a.visit_client_uuid), eq(visit.crew_id, crewId)));
        if (!v) throw new HttpError(409, 'visit_missing');
        const last = Date.parse(v.departed_device_at ?? v.arrived_device_at);
        if (Date.parse(a.at) - last > UNDO_WINDOW_MS) throw new HttpError(409, 'undo_window_passed');
        await tx.insert(visit_correction).values({ tenant_id: tenantId, visit_id: v.id, field: 'voided', old_value: false, new_value: true, reason: 'Driver tapped Undo last', by_crew: crewId, client_uuid: a.client_uuid });
        await setStop(tx, rs, stop!.id, 'open');
        break;
      }
    }
    return { client_uuid: a.client_uuid, status: 'ok' };
  }).catch((err: unknown): Ack => {
    if (err instanceof HttpError) return { client_uuid: a.client_uuid, status: 'rejected', reason: err.message };
    throw err;
  });
  if (result.status === 'ok') for (const fn of after) await fn();
  return result;
}

/**
 * Order matters: Arrive must land before the Done that follows it. A bad action is rejected on its own so it can't
 * block the outbox forever. A server error stops the batch, because later actions may depend on that one: nothing
 * after it is acknowledged, so the phone keeps them and retries in order.
 */
export async function processActions(rs: RunScope, actions: unknown[]): Promise<Ack[]> {
  const acks: Ack[] = [];
  for (const raw of actions) {
    const parsed = driverAction.safeParse(raw);
    if (!parsed.success) {
      const id = (raw as { client_uuid?: unknown } | null)?.client_uuid;
      acks.push({ client_uuid: typeof id === 'string' ? id : 'unknown', status: 'rejected', reason: 'invalid' });
      continue;
    }
    try {
      acks.push(await processAction(rs, parsed.data));
    } catch (err) {
      log.error('driver action failed', err, { tenant_id: rs.scope.tenantId, kind: parsed.data.kind });
      break;
    }
  }
  for (const a of acks) if (a.status === 'rejected') log.info('driver action rejected', { tenant_id: rs.scope.tenantId, run: rs.scope.runId, reason: a.reason });
  return acks;
}

export interface PhotoInput {
  client_uuid: string;
  visit_client_uuid?: string;
  phase: 'before' | 'after' | 'issue' | 'voice';
  taken_at?: string;
  problem_client_uuid?: string;
  bytes: Uint8Array;
  contentType: string;
}

/** Keeps the original bytes untouched, so resolution and EXIF survive server-side. Idempotent on client_uuid. */
export async function savePhoto(rs: RunScope, input: PhotoInput): Promise<{ status: 'ok' | 'duplicate'; id?: string }> {
  const db = serviceDb();
  const { tenantId } = rs.scope;
  const ext = input.contentType.includes('png') ? 'png' : input.contentType.includes('webm') ? 'webm' : input.contentType.includes('mp4') ? 'm4a' : 'jpg';

  if (input.phase === 'voice') {
    if (!input.problem_client_uuid) throw new HttpError(422, 'Voice notes need a problem');
    const path = `${tenantId}/voice/${input.client_uuid}.${ext}`;
    await putBlob('photos', path, input.bytes, input.contentType, { upsert: true });
    const updated = await db.update(problem_report).set({ voice_path: path }).where(and(eq(problem_report.tenant_id, tenantId), eq(problem_report.client_uuid, input.problem_client_uuid), eq(problem_report.storm_run_id, rs.scope.runId))).returning({ id: problem_report.id });
    if (!updated.length) throw new HttpError(409, 'problem_not_synced');
    return { status: 'ok', id: updated[0]!.id };
  }

  const [existing] = await db.select({ id: visit_photo.id }).from(visit_photo).where(and(eq(visit_photo.tenant_id, tenantId), eq(visit_photo.client_uuid, input.client_uuid)));
  if (existing) return { status: 'duplicate', id: existing.id };
  if (!input.visit_client_uuid) throw new HttpError(422, 'Photos need a visit');
  const v = await rs.scope.visit(input.visit_client_uuid);
  if (!v) throw new HttpError(409, 'visit_not_synced', 'visit_not_synced');

  const path = `${tenantId}/${v.id}/${input.client_uuid}.${ext}`;
  await putBlob('photos', path, input.bytes, input.contentType, { upsert: true });
  return recordPhoto(rs, v.id, path, input);
}

async function recordPhoto(rs: RunScope, visitId: string, path: string, input: { client_uuid: string; phase: string; taken_at?: string; bytes: Uint8Array }): Promise<{ status: 'ok' | 'duplicate'; id?: string }> {
  const { tenantId } = rs.scope;
  const meta = await readImageMeta(input.bytes);
  const rows = await serviceDb().insert(visit_photo).values({
    tenant_id: tenantId, visit_id: visitId, client_uuid: input.client_uuid, phase: input.phase as 'before' | 'after' | 'issue', storage_path: path, sha256: sha256Hex(input.bytes),
    width: meta.width, height: meta.height, taken_device_at: input.taken_at ?? null, exif: meta.exif,
  }).onConflictDoNothing({ target: visit_photo.client_uuid }).returning({ id: visit_photo.id });
  if (!rows.length) return { status: 'duplicate' };
  await enqueue('photo.process', { tenantId, photoId: rows[0]!.id }, { dedupeKey: `photo:${rows[0]!.id}` });
  return { status: 'ok', id: rows[0]!.id };
}

export interface PhotoUpload { client_uuid: string; visit_client_uuid: string; phase: 'before' | 'after' | 'issue'; taken_at?: string; content_type: string }

async function uploadTarget(rs: RunScope, input: PhotoUpload) {
  const v = await rs.scope.visit(input.visit_client_uuid);
  if (!v) throw new HttpError(409, 'visit_not_synced', 'visit_not_synced');
  const ext = input.content_type.includes('png') ? 'png' : 'jpg';
  return { visitId: v.id, path: `${rs.scope.tenantId}/${v.id}/${input.client_uuid}.${ext}` };
}

async function photoExists(rs: RunScope, clientUuid: string) {
  const [row] = await serviceDb().select({ id: visit_photo.id }).from(visit_photo).where(and(eq(visit_photo.tenant_id, rs.scope.tenantId), eq(visit_photo.client_uuid, clientUuid)));
  return row ?? null;
}

/** Full-size phone photos exceed the host's request limit, so the phone sends them straight to private storage. */
export async function signPhotoUpload(rs: RunScope, input: PhotoUpload): Promise<{ status: 'duplicate' } | { status: 'upload'; url: string }> {
  if (await photoExists(rs, input.client_uuid)) return { status: 'duplicate' };
  const { path } = await uploadTarget(rs, input);
  return { status: 'upload', url: await signedUploadUrl('photos', path) };
}

/** After the direct upload. The server reads the stored bytes itself, so the hash and metadata are its own. */
export async function finishPhotoUpload(rs: RunScope, input: PhotoUpload) {
  const existing = await photoExists(rs, input.client_uuid);
  if (existing) return { status: 'duplicate' as const, id: existing.id };
  const { visitId, path } = await uploadTarget(rs, input);
  const bytes = await getBlob('photos', path);
  if (!bytes) throw new HttpError(409, 'upload_missing', 'upload_missing');
  return recordPhoto(rs, visitId, path, { ...input, bytes });
}

export async function readImageMeta(bytes: Uint8Array): Promise<{ width: number | null; height: number | null; exif: Record<string, unknown> | null }> {
  let width: number | null = null;
  let height: number | null = null;
  let exif: Record<string, unknown> | null = null;
  try {
    const sharp = (await import('sharp')).default;
    const m = await sharp(bytes).metadata();
    width = m.width ?? null;
    height = m.height ?? null;
  } catch {
    // Unreadable format: the original is still stored and hashed.
  }
  try {
    const exifr = (await import('exifr')).default;
    const parsed = await exifr.parse(Buffer.from(bytes), { pick: ['DateTimeOriginal', 'CreateDate', 'latitude', 'longitude', 'Make', 'Model'], gps: true });
    if (parsed) exif = JSON.parse(JSON.stringify(parsed));
  } catch {
    exif = null;
  }
  return { width, height, exif };
}

/** A pin's photo for this link's own stops only. Same-origin, so the service worker can keep it for offline use. */
export async function pinPhotoForRun(rs: RunScope, pinId: string): Promise<Uint8Array | null> {
  const db = serviceDb();
  const [pin] = await db.select().from(site_pin).where(and(eq(site_pin.tenant_id, rs.scope.tenantId), eq(site_pin.id, pinId)));
  if (!pin?.photo_path) return null;
  const [onRun] = await db.select({ id: run_stop.id }).from(run_stop).where(and(eq(run_stop.tenant_id, rs.scope.tenantId), eq(run_stop.storm_run_id, rs.scope.runId), eq(run_stop.site_id, pin.site_id)));
  return onRun ? getBlob('photos', pin.photo_path) : null;
}

export async function savePosition(rs: RunScope, p: { lat: number; lon: number; acc?: number | null; at: string }) {
  if (rs.storm.status !== 'active') return;
  await serviceDb().insert(driver_position).values({ tenant_id: rs.scope.tenantId, storm_run_id: rs.scope.runId, crew_id: rs.scope.crewId, lat: p.lat, lon: p.lon, acc_m: p.acc ?? null, device_at: p.at });
}

/** The driver's run URL as the manifest start_url, so a home-screen install opens the right route. */
export const driverStartUrl = (token: string) => `${baseUrl()}/d/${token}`;
