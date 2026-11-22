import { and, asc, contract, crew_member, desc, driver_action, driver_position, driverScope, eq, inArray, isNotNull, problem_report, run_stop, serviceDb, site, site_pin, sql, storm, storm_run, tenant, visit, visit_correction, visit_photo, visitNotVoided, visitOnRun, type DriverScope, type Tx } from '@flake/db';
import { driverAction, saltUnit, serviceKind, type DriverAction } from '@flake/contracts';
import { gpsMatches } from '@flake/core/geo';
import { liveContracts } from '@flake/core/time';
import type { ContractService } from '@flake/core/pricing';
import type { MultiPolygon, Polygon } from 'geojson';
import { getBlob, putBlob, removeBlob, signedUploadUrl, signedUrl } from './blob';
import { log } from './log';
import { notifyOffice, plainText } from './messaging';
import { HttpError } from './http';
import { enqueue } from './jobs';
import { baseUrl } from './env';
import { getSetting } from './providers';
import { hashToken, sha256Hex } from './tokens';

/** The deployed commit on Vercel; 'dev' locally. */
export const APP_BUILD = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.FLAKE_BUILD ?? 'dev';
export const UNDO_WINDOW_MS = 2 * 60 * 1000;
/** A driver's problem kind, in the words an office alert uses. */
const PROBLEM_WORD: Record<string, string> = { blocked: 'Blocked', breakdown: 'Breakdown', damage: 'Damage', skip: 'Skipped', other: 'Problem' };
/** The same cap on every upload path, direct or through signed storage (issue 56). */
export const MAX_PHOTO_BYTES = 30 * 1024 * 1024;

/**
 * True when the bytes start like a photo format a phone makes: JPEG, PNG, GIF, WebP, or HEIC/HEIF/AVIF. A text file
 * renamed .jpg is not proof of anything. HEIC passes even when the server can't read its size, so an iPhone photo is
 * never thrown away.
 */
export function looksLikeImage(b: Uint8Array) {
  const at = (i: number, s: string) => [...s].every((c, k) => b[i + k] === c.charCodeAt(0));
  return (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) || (b[0] === 0x89 && at(1, 'PNG')) || at(0, 'GIF8') || (at(0, 'RIFF') && at(8, 'WEBP')) || at(4, 'ftyp');
}
/** HEIC/HEIF (not AVIF, which the server reads): an iPhone photo, or an Android set to "high efficiency". */
export function isHeifBytes(b: Uint8Array) {
  const brand = String.fromCharCode(...b.slice(8, 12));
  return String.fromCharCode(...b.slice(4, 8)) === 'ftyp' && ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(brand);
}
/** What an office upload says when a phone's browser sent HEIC it couldn't convert. */
export const HEIF_HELP = 'This phone saved the photo as HEIC, which this browser could not convert. In the camera settings, turn off High efficiency pictures (or choose Most Compatible), then add it again.';
/** Actions that begin work at a stop. A closed storm refuses these when they were tapped after the close. */
const STARTS_WORK = new Set(['enroute', 'arrive', 'problem']);
/**
 * A little clock drift, not the 10 minutes a dead link gets: once the phone hears of the close it shows the closed
 * screen, so anything later than this was tapped after the office ended the storm.
 */
const CLOSE_SLACK_MS = 60 * 1000;
const ON_THE_WAY_FRESH_MS = 15 * 60 * 1000;
/** The most of each salt unit one visit can plausibly use. More is a typo or a bad queue, and is held for the office. */
const SALT_MAX: Record<string, number> = { bag50lb: 400, lb: 20000, ton: 10, application: 20 };

/**
 * What a Done keeps (issue 155): only real services and salt units, so a stale app or a tampered link can't put junk
 * on the customer's records page. A visit is never refused for it; the rest of the Done still counts, and billing review
 * flags salt it can't price.
 */
export function cleanDone(services: string[], salt: { unit: string; qty: number }[] | null | undefined) {
  const kept = [...new Set(services.filter((x) => serviceKind.safeParse(x).success))];
  const bags = (salt ?? []).filter((e) => saltUnit.safeParse(e.unit).success && e.qty > 0 && e.qty <= (SALT_MAX[e.unit] ?? 0));
  return { services: kept, salt: bags.length ? bags : null };
}
/** Actions that change what a closed storm's bills should say: a late Done, an Undo, a skip after arriving (issue 159). */
const CHANGES_BILLING = new Set(['arrive', 'done', 'undo_last', 'problem']);

/**
 * Work that lands after the close remakes the drafts still in review, half a minute later so a burst of synced actions
 * remakes them once. Approved bills are left alone; the billing page names what changed on them.
 */
async function queueRedraft(tenantId: string, stormId: string) {
  const slot = Math.floor(Date.now() / 30_000);
  await enqueue('billing.redraft', { tenantId, stormId }, { dedupeKey: `redraft:${stormId}:${slot}`, runAt: new Date((slot + 1) * 30_000 + 5_000) });
}

export interface RunScope {
  scope: DriverScope;
  run: typeof storm_run.$inferSelect;
  storm: typeof storm.$inferSelect;
  crew: typeof crew_member.$inferSelect | null;
  tenant: typeof tenant.$inferSelect;
  /** Set when the link has been revoked or expired, and this request is only delivering earlier work. */
  deadAt: string | null;
}

/** Token to run. Unknown, revoked and expired links all read the same to the driver: ask for a new one. */
/** Replacing a link overwrites its token, so the old one is remembered here to let its queued work in. */
export const retiredLinkKey = (hash: string) => `retired_link:${hash}`;

/** A phone can be out of signal a long time. Past this, a dead link's queued work is refused. */
const UPLOAD_GRACE_MS = 7 * 24 * 3600 * 1000;
/** Phone clocks drift, so work stamped just after the link died still counts as before it. */
const CLOCK_SLACK_MS = 10 * 60 * 1000;

/**
 * A dead link can't start new work or see the route. With forUpload, it can still deliver what the driver did before
 * it died: revoking a link must not throw away a plowed lot's only record.
 */
/** True for any route link that was ever handed out, live or not. Unknown strings are a 404, not a route. */
export async function linkEverIssued(token: string) {
  if (!token || token.length > 200) return false;
  const hash = hashToken(token);
  const [row] = await serviceDb().select({ id: storm_run.id }).from(storm_run).where(eq(storm_run.link_token_hash, hash)).limit(1);
  return Boolean(row) || Boolean(await getSetting(retiredLinkKey(hash)));
}

export async function resolveToken(token: string, opts: { forUpload?: boolean } = {}): Promise<RunScope> {
  const db = serviceDb();
  const hash = hashToken(token);
  const find = (where: ReturnType<typeof eq>) => db.select({ run: storm_run, storm, tenant, crew: crew_member }).from(storm_run)
    .innerJoin(storm, eq(storm.id, storm_run.storm_id))
    .innerJoin(tenant, eq(tenant.id, storm_run.tenant_id))
    .leftJoin(crew_member, eq(crew_member.id, storm_run.crew_id))
    .where(where);
  let [row] = await find(eq(storm_run.link_token_hash, hash));
  const retired = !row && opts.forUpload ? await getSetting<{ runId: string; at: string }>(retiredLinkKey(hash)) : null;
  if (retired) [row] = await find(eq(storm_run.id, retired.runId));
  const deadAt = row ? (retired?.at ?? row.run.link_revoked_at ?? (Date.parse(row.run.link_expires_at) < Date.now() ? row.run.link_expires_at : null)) : null;
  if (!row || (deadAt && (!opts.forUpload || Date.now() - Date.parse(deadAt) > UPLOAD_GRACE_MS))) throw new HttpError(410, 'This link is no longer active', 'link_dead');
  return {
    scope: driverScope(db, { tenantId: row.run.tenant_id, runId: row.run.id, crewId: row.run.crew_id, stormId: row.run.storm_id }),
    deadAt,
    run: row.run,
    storm: row.storm,
    crew: row.crew,
    tenant: row.tenant,
  };
}

/** The first time the driver app loads its run, for "Opened 3:12 AM" on the board (issue 86). Later loads keep it. */
export async function markLinkOpened(runId: string) {
  await serviceDb().update(storm_run).set({ link_opened_at: new Date().toISOString() }).where(and(eq(storm_run.id, runId), sql`${storm_run.link_opened_at} is null`));
}

/** What the phone caches. Every query carries the tenant id and the run id from the token. */
export async function loadRun(rs: RunScope) {
  const db = serviceDb();
  const { tenantId, runId, stormId } = rs.scope;
  const rows = await db.select({ stop: run_stop, site }).from(run_stop).innerJoin(site, eq(site.id, run_stop.site_id)).where(and(eq(run_stop.tenant_id, tenantId), eq(run_stop.storm_run_id, runId))).orderBy(asc(run_stop.seq));
  const siteIds = rows.map((r) => r.site.id);
  const contracts = liveContracts(siteIds.length ? await db.select().from(contract).where(and(eq(contract.tenant_id, tenantId), inArray(contract.site_id, siteIds), eq(contract.status, 'accepted'))).orderBy(desc(contract.created_at)) : [], rs.storm.started_at, rs.tenant.timezone);
  const pins = siteIds.length ? await db.select().from(site_pin).where(and(eq(site_pin.tenant_id, tenantId), inArray(site_pin.site_id, siteIds))) : [];
  // A stop this run's driver is on site at, with the visit they started (issue 143): a phone opening the link fresh, after
  // a phone swap or a cleared browser, picks that visit up and can finish it instead of reading the stop as someone
  // else's. A visit the run's previous driver started stays theirs (issue 154).
  const open = rows.length ? await db.select({ stop: visit.run_stop_id, client_uuid: visit.client_uuid, arrived_at: visit.arrived_device_at }).from(visit)
    .where(and(eq(visit.tenant_id, tenantId), inArray(visit.run_stop_id, rows.map((r) => r.stop.id)), eq(visit.crew_id, rs.run.crew_id ?? '00000000-0000-0000-0000-000000000000'), sql`${visit.departed_device_at} is null`, visitNotVoided, visitOnRun(runId))) : [];
  // Depth is asked for until this crew has actually given one this storm (issue 205): Arrive makes a visit with no depth,
  // so counting visits let the first stop through without one once the phone synced.
  const depthGiven = await db.select({ id: visit.id }).from(visit).where(and(eq(visit.tenant_id, tenantId), eq(visit.storm_id, stormId), eq(visit.crew_id, rs.run.crew_id ?? '00000000-0000-0000-0000-000000000000'), isNotNull(visit.depth_in), visitNotVoided)).limit(1);
  // Salt rationing tonight, with each lot's priority areas (issue 232).
  const { rationAreas, stormRation } = await import('./salt-policy');
  const ration = (await stormRation(tenantId, stormId)).on;
  const areas = ration ? await rationAreas(rows.map((r) => r.site.id)) : new Map<string, string[]>();
  return {
    company: rs.tenant.name,
    office_phone: rs.tenant.contact_phone ?? null,
    storm: { id: rs.storm.id, name: rs.storm.name, status: rs.storm.status },
    run: { id: rs.run.id, pass: rs.run.pass },
    crew: rs.crew ? { name: rs.crew.name, language: rs.crew.language } : null,
    // The deployed version, so a page left open since before a fix knows to reload itself.
    build: APP_BUILD,
    has_reported_depth: depthGiven.length > 0,
    // A gentle "take a break" after a long shift (issue 235). Never a block.
    long_shift_hours: rs.run.crew_id && rs.storm.status === 'active' ? await (async () => { const { fatigueFor } = await import('./fatigue'); const f = (await fatigueFor(tenantId, [rs.run.crew_id!])).get(rs.run.crew_id!); return f?.long_shift ? f.on_hours : null; })() : null,
    stops: rows.map(({ stop, site: st }) => {
      const c = contracts.find((x) => x.site_id === st.id);
      const services = ((c?.services ?? [{ service: 'plow' }]) as ContractService[]).map((x) => x.service);
      const salt = c?.salt_pricing as { unit: string } | null | undefined;
      return {
        id: stop.id,
        seq: stop.seq,
        status: stop.status,
        site: { id: st.id, label: st.label, address: st.address, lat: st.lat, lon: st.lon, priority: st.priority, open_by: st.service_window?.open_by ?? null, not_before: st.service_window?.not_before ?? null, notes: st.notes },
        pins: pins.filter((p) => p.site_id === st.id).map((p) => ({ id: p.id, kind: p.kind, note: p.note, has_photo: Boolean(p.photo_path) })),
        services,
        salt_unit: salt?.unit ?? (services.includes('salt') ? 'bag50lb' : null),
        ration_areas: ration && services.includes('salt') ? (areas.get(st.id) ?? []) : null,
        open_visit: stop.status === 'onsite' ? (open.filter((o) => o.stop === stop.id).map((o) => ({ client_uuid: o.client_uuid, arrived_at: new Date(o.arrived_at).toISOString() }))[0] ?? null) : null,
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
  if (rs.deadAt && Date.parse(a.at) > Date.parse(rs.deadAt) + CLOCK_SLACK_MS) return { client_uuid: a.client_uuid, status: 'rejected', reason: 'link_dead' };
  // A closed storm takes work the driver did before the close, not new work (issue 53). Done, depth, salt and photos
  // finish a visit that was already started, so they still go through.
  if (rs.storm.status !== 'active' && STARTS_WORK.has(a.kind) && Date.parse(a.at) > Date.parse(rs.storm.closed_at ?? rs.storm.started_at) + CLOSE_SLACK_MS
    // Going back to a lot already started (after a Problem, say) resumes that visit: it isn't new work (issue 71).
    && !(a.kind === 'arrive' && (await rs.scope.visit(a.visit_client_uuid)))) {
    return { client_uuid: a.client_uuid, status: 'rejected', reason: 'storm_closed' };
  }
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
        // Two phones on one link (issue 54): the stop is locked, and a second live visit on it is refused, so one lot
        // can't be finished, and billed, twice. The same phone's retry has the same visit id and passes.
        await tx.select({ id: run_stop.id }).from(run_stop).where(eq(run_stop.id, stop!.id)).for('update');
        const [other] = await tx.select({ id: visit.id }).from(visit)
          .where(and(eq(visit.tenant_id, tenantId), eq(visit.run_stop_id, stop!.id), sql`${visit.client_uuid} <> ${a.visit_client_uuid}`, visitNotVoided));
        if (other) throw new HttpError(409, 'stop_taken');
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
        const [v] = await tx.select().from(visit).where(and(eq(visit.tenant_id, tenantId), eq(visit.client_uuid, a.visit_client_uuid), visitOnRun(runId)));
        if (!v) throw new HttpError(409, 'visit_missing');
        if (v.departed_device_at) break;
        await tx.update(visit).set({
          departed_device_at: a.at, departed_received_at: new Date().toISOString(), depart_lat: a.gps?.lat ?? null, depart_lon: a.gps?.lon ?? null,
          ...cleanDone(a.services, a.salt), depth_in: a.depth_in ?? null,
        }).where(eq(visit.id, v.id));
        await setStop(tx, rs, stop!.id, 'done');
        after.push(async () => {
          await enqueue('notify.visit_done', { tenantId, visitId: v.id, photosComing: a.photos_coming, queuedAt: Date.now() }, { dedupeKey: `done:${v.id}`, runAt: new Date(Date.now() + 20000) });
          await enqueue('report.completion', { tenantId, visitId: v.id, photosComing: a.photos_coming, queuedAt: Date.now() }, { dedupeKey: `report:${v.id}`, runAt: new Date(Date.now() + 60000) });
        });
        break;
      }
      case 'problem': {
        // Skipping a lot the driver had arrived at closes out that visit, so no half-open visit is left to bill (issue 57).
        if (a.problem === 'skip') {
          const open = await tx.select({ id: visit.id }).from(visit).where(and(eq(visit.tenant_id, tenantId), eq(visit.run_stop_id, stop!.id), eq(visit.crew_id, crewId), sql`${visit.departed_device_at} is null`, visitNotVoided));
          for (const v of open) await tx.insert(visit_correction).values({ tenant_id: tenantId, visit_id: v.id, field: 'voided', old_value: false, new_value: true, reason: 'Driver skipped the stop after arriving', by_crew: crewId });
        }
        await tx.insert(problem_report).values({ tenant_id: tenantId, client_uuid: a.client_uuid, storm_run_id: runId, site_id: st?.id ?? null, crew_id: crewId, kind: a.problem, note: a.note ?? null }).onConflictDoNothing({ target: problem_report.client_uuid });
        await setStop(tx, rs, stop!.id, a.problem === 'skip' ? 'skipped' : 'problem', ['open', 'enroute', 'onsite', 'problem']);
        // Push alone misses an owner who hasn't added the app to an iPhone home screen: this goes by email too, and by
        // text to the company phone once texting is live. One alert per report (issue 83). The note is the driver's
        // own words, made plain text by notifyOffice.
        after.push(() => notifyOffice(rs.tenant, {
          subject: `${PROBLEM_WORD[a.problem] ?? 'Problem'} at ${st?.label ?? 'a lot'}`,
          headline: `${rs.crew?.name ?? 'A driver'} reported ${(PROBLEM_WORD[a.problem] ?? a.problem).toLowerCase()} at ${st?.label ?? 'a lot'}.${a.note ? ` Their note: "${plainText(a.note)}"` : ''}`,
          link: `${baseUrl()}/storms/${stormId}`,
          key: `problem:${a.client_uuid}`,
          related: { storm_id: stormId },
        }));
        break;
      }
      case 'undo_last': {
        const [v] = await tx.select().from(visit).where(and(eq(visit.tenant_id, tenantId), eq(visit.client_uuid, a.visit_client_uuid), visitOnRun(runId)));
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
  if (result.status === 'ok') {
    for (const fn of after) await fn();
    if (rs.storm.status === 'closed' && CHANGES_BILLING.has(a.kind)) await queueRedraft(tenantId, stormId);
  }
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
  // The office turned this link off, so it should hear that work still came in on it.
  if (rs.deadAt && acks.some((a) => a.status === 'ok')) {
    await notifyOffice(rs.tenant, {
      headline: `${rs.crew?.name ?? 'A driver'}'s work arrived after their link was turned off. Please check it.`,
      link: `${baseUrl()}/storms/${rs.scope.stormId}`,
      key: `late_upload:${rs.scope.runId}`,
      related: { storm_id: rs.scope.stormId },
    });
  }
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
  if (!looksLikeImage(input.bytes)) {
    await removeBlob('photos', path);
    throw new HttpError(415, 'That file is not a photo', 'not_an_image');
  }
  const meta = await readImageMeta(input.bytes);
  const rows = await serviceDb().insert(visit_photo).values({
    tenant_id: tenantId, visit_id: visitId, client_uuid: input.client_uuid, phase: input.phase as 'before' | 'after' | 'issue', storage_path: path, sha256: sha256Hex(input.bytes),
    width: meta.width, height: meta.height, taken_device_at: input.taken_at ?? null, exif: meta.exif,
  }).onConflictDoNothing({ target: visit_photo.client_uuid }).returning({ id: visit_photo.id });
  if (!rows.length) return { status: 'duplicate' };
  await enqueue('photo.process', { tenantId, photoId: rows[0]!.id }, { dedupeKey: `photo:${rows[0]!.id}` });
  // A photo can land after the close drafted the storm's invoices, which then still say "no after photo" (issue 75).
  // Remake the drafts in review, half a minute later so a burst of photos remakes them once.
  if (input.phase === 'after') {
    const [v] = await serviceDb().select({ storm_id: visit.storm_id, status: storm.status }).from(visit).innerJoin(storm, eq(storm.id, visit.storm_id)).where(and(eq(visit.tenant_id, tenantId), eq(visit.id, visitId)));
    if (v && v.status === 'closed') await queueRedraft(tenantId, v.storm_id);
  }
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
  // Signed uploads go straight to storage, so the size cap is checked here, after the fact (issue 56).
  if (bytes.byteLength > MAX_PHOTO_BYTES) {
    await removeBlob('photos', path);
    throw new HttpError(413, 'File too large', 'too_large');
  }
  return recordPhoto(rs, visitId, path, { ...input, bytes });
}

/** The most a phone's JPEG copy of a HEIC photo can weigh: 1600 px at 0.82 is far under this. */
export const MAX_VIEW_BYTES = 4 * 1024 * 1024;

/**
 * The phone's JPEG copy of a HEIC visit photo (the server can't decode HEIC). It becomes the photo's thumbnail, which
 * the office, the customer page, texted links and the proof PDF fall back to. Only for a photo on this link's own
 * stops, only when the server couldn't read the original itself, and re-encoded so what's stored is really a JPEG.
 */
export async function saveViewCopy(rs: RunScope, clientUuid: string, bytes: Uint8Array): Promise<{ status: 'ok' | 'not_needed' }> {
  const [p] = await serviceDb().select({ path: visit_photo.storage_path, width: visit_photo.width, visit_client_uuid: visit.client_uuid }).from(visit_photo)
    .innerJoin(visit, eq(visit.id, visit_photo.visit_id)).where(and(eq(visit_photo.tenant_id, rs.scope.tenantId), eq(visit_photo.client_uuid, clientUuid)));
  if (!p || !(await rs.scope.visit(p.visit_client_uuid))) throw new HttpError(404, 'Photo not found');
  if (p.width !== null) return { status: 'not_needed' };
  if (bytes.byteLength > MAX_VIEW_BYTES) throw new HttpError(413, 'File too large', 'too_large');
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) throw new HttpError(415, 'Send a JPEG copy', 'not_jpeg');
  const sharp = (await import('sharp')).default;
  const jpeg = await sharp(bytes).resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer().catch(() => null);
  if (!jpeg) throw new HttpError(415, 'Send a JPEG copy', 'not_jpeg');
  await putBlob('photos', `${p.path}.thumb.jpg`, jpeg, 'image/jpeg', { upsert: true });
  return { status: 'ok' };
}

/**
 * A short-lived URL for a visit photo. The thumbnail when asked, and also for the full view when the original is a
 * format a browser may not show (HEIC: the server couldn't read its size), so nobody gets a broken image or a download.
 */
export async function visitPhotoUrl(p: { storage_path: string; width: number | null }, thumb: boolean) {
  return ((thumb || p.width === null) && (await signedUrl('photos', `${p.storage_path}.thumb.jpg`))) || signedUrl('photos', p.storage_path);
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
