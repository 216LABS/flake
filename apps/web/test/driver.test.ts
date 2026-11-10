import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, crew_member, eq, serviceDb, sql, storm_run, run_stop, visit, visit_correction, visit_photo, driver_action, problem_report, and } from '@flake/db';
import sharp from 'sharp';
import { POST as actionsRoute } from '@/app/api/d/[token]/actions/route';
import { POST as photosRoute } from '@/app/api/d/[token]/photos/route';
import { GET as runRoute } from '@/app/api/d/[token]/run/route';
import { getBlob } from '@/lib/blob';
import { addPass, addStopToRun, assignRunDriver, closeStorm, patchRunStop, publishStorm, revokeRunLink } from '@/lib/storms';
import { decryptToken, sha256Hex } from '@/lib/tokens';
import { ctxOf, jsonReq, makeWorld, req, stopActions, type World, createStorm } from './helpers';

let w: World;
let stormId: string;
let runId: string;
let token: string;
let stops: (typeof run_stop.$inferSelect)[];
let run2Token: string;
let run2Id: string;
let otherTenantToken: string;

const params = (t: string) => ({ params: Promise.resolve({ token: t }) });
const post = async (t: string, actions: unknown[]) => actionsRoute(jsonReq(`/api/d/${t}/actions`, { actions }), params(t));

async function jpeg(): Promise<Buffer> {
  return sharp({ create: { width: 2600, height: 1950, channels: 3, background: '#88aacc' } }).withExif({ IFD0: { Make: 'FlakeTestCam', Model: 'T1' } }).jpeg({ quality: 90 }).toBuffer();
}

beforeAll(async () => {
  w = await makeWorld();
  const out = await createStorm(ctxOf(w), { name: 'Driver test', routeIds: [w.routeId, w.route2Id], crewAssignments: {} });
  stormId = out.storm.id;
  await publishStorm(ctxOf(w), stormId);
  const r = out.runs.find((x) => x.route_id === w.routeId)!;
  runId = r.id;
  token = decryptToken(r.link_token_enc!);
  const r2 = out.runs.find((x) => x.route_id === w.route2Id)!;
  run2Id = r2.id;
  run2Token = decryptToken(r2.link_token_enc!);
  stops = await serviceDb().select().from(run_stop).where(eq(run_stop.storm_run_id, runId));
  stops.sort((a, b) => a.seq - b.seq);
  const other = await makeWorld();
  const otherOut = await createStorm(ctxOf(other), { name: 'Other', routeIds: [other.routeId], crewAssignments: {} });
  otherTenantToken = decryptToken(otherOut.runs[0]!.link_token_enc!);
});
afterAll(() => closeDb());

describe('driver API', () => {
  it('returns the run without a login, with no secrets in it', async () => {
    const res = await runRoute(req(`/api/d/${token}/run`), params(token));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stops).toHaveLength(5);
    expect(JSON.stringify(body)).not.toContain('link_token');
    expect(body.stops[0].site.label).toBe('Site 0');
  });

  it('a replayed batch lands exactly once', async () => {
    const { actions, visit: visitUuid } = stopActions(stops[0]!.id, new Date('2026-01-10T08:00:00Z'));
    const first = await (await post(token, actions)).json();
    expect(first.acks.map((a: any) => a.status)).toEqual(['ok', 'ok']);
    const second = await (await post(token, actions)).json();
    expect(second.acks.map((a: any) => a.status)).toEqual(['duplicate', 'duplicate']);
    const rows = await serviceDb().select().from(visit).where(eq(visit.client_uuid, visitUuid));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.departed_device_at).not.toBeNull();
    expect(rows[0]!.arrived_received_at).not.toBe(rows[0]!.arrived_device_at);
    const ledger = await serviceDb().select().from(driver_action).where(eq(driver_action.client_uuid, actions[0]!.client_uuid));
    expect(ledger).toHaveLength(1);
    const [stop] = await serviceDb().select().from(run_stop).where(eq(run_stop.id, stops[0]!.id));
    expect(stop!.status).toBe('done');
  });

  it('records GPS match against the site', async () => {
    const near = stopActions(stops[1]!.id, new Date('2026-01-10T09:00:00Z'), { gps: { lat: 41.481, lon: -81.8 } });
    await post(token, near.actions);
    const [v] = await serviceDb().select().from(visit).where(eq(visit.client_uuid, near.visit));
    expect(v!.gps_match).toBe(true);
    const far = stopActions(stops[2]!.id, new Date('2026-01-10T10:00:00Z'), { gps: { lat: 41.6, lon: -81.8 } });
    await post(token, far.actions);
    const [v2] = await serviceDb().select().from(visit).where(eq(visit.client_uuid, far.visit));
    expect(v2!.gps_match).toBe(false);
  });

  it('rejects another run, and another tenant, and writes nothing', async () => {
    const a = stopActions(stops[3]!.id, new Date('2026-01-10T11:00:00Z'));
    const sameTenant = await (await post(run2Token, a.actions)).json();
    expect(sameTenant.acks[0].status).toBe('rejected');
    expect(sameTenant.acks[0].reason).toBe('out_of_scope');
    const b = stopActions(stops[3]!.id, new Date('2026-01-10T11:00:00Z'));
    const otherTenant = await (await post(otherTenantToken, b.actions)).json();
    expect(otherTenant.acks[0].reason).toBe('out_of_scope');
    expect(await serviceDb().select().from(visit).where(eq(visit.client_uuid, a.visit))).toHaveLength(0);
    expect(await serviceDb().select().from(visit).where(eq(visit.client_uuid, b.visit))).toHaveLength(0);
  });

  it('validates input with zod: a bad batch is refused, and one bad action cannot block the good ones', async () => {
    expect((await actionsRoute(jsonReq(`/api/d/${token}/actions`, { nope: true }), params(token))).status).toBe(422);
    const badId = randomUUID();
    const good = { client_uuid: randomUUID(), at: new Date().toISOString(), kind: 'problem', run_stop_id: stops[3]!.id, problem: 'other', note: null };
    const out = await (await post(token, [{ client_uuid: badId, kind: 'teleport' }, good])).json();
    expect(out.acks).toEqual([{ client_uuid: badId, status: 'rejected', reason: 'invalid' }, { client_uuid: good.client_uuid, status: 'ok' }]);
  });

  it('a server error stops the batch unacknowledged, so the phone retries in order and loses nothing', async () => {
    const { processActions, resolveToken } = await import('@/lib/driver');
    const rs = await resolveToken(token);
    const a = stopActions(stops[3]!.id, new Date());
    const broken = { ...a.actions[0]!, at: '2026-13-45T99:99:99.000Z' };
    const acks = await processActions(rs, [{ ...broken, client_uuid: randomUUID() }, a.actions[1]]);
    expect(acks.filter((x) => x.status === 'ok')).toHaveLength(0);
  });

  it('a stale on-the-way tap synced long after the fact does not text the customer', async () => {
    const out = await createStorm(ctxOf(w), { name: 'Stale', routeIds: [w.routeId], crewAssignments: {} });
    const t = decryptToken(out.runs[0]!.link_token_enc!);
    const list = (await serviceDb().select().from(run_stop).where(eq(run_stop.storm_run_id, out.runs[0]!.id))).sort((x, y) => x.seq - y.seq);
    const queued = async (stopSite: string) => (await serviceDb().execute(sql`select 1 from job where dedupe_key = ${`notify:on_the_way:${out.storm.id}:${stopSite}`}`)).length;
    await post(t, [{ client_uuid: randomUUID(), at: new Date(Date.now() - 3600000).toISOString(), kind: 'enroute', run_stop_id: list[0]!.id }]);
    expect(await queued(list[0]!.site_id)).toBe(0);
    await post(t, [{ client_uuid: randomUUID(), at: new Date().toISOString(), kind: 'enroute', run_stop_id: list[1]!.id }]);
    expect(await queued(list[1]!.site_id)).toBe(1);
  });

  it('after a Problem, arriving again resumes the same visit and Done still lands', async () => {
    const out = await createStorm(ctxOf(w), { name: 'Resume', routeIds: [w.routeId], crewAssignments: {} });
    const t = decryptToken(out.runs[0]!.link_token_enc!);
    const [s] = await serviceDb().select().from(run_stop).where(and(eq(run_stop.storm_run_id, out.runs[0]!.id), eq(run_stop.seq, 1)));
    const a = stopActions(s!.id, new Date());
    await post(t, [a.actions[0]]);
    await post(t, [{ client_uuid: randomUUID(), at: new Date().toISOString(), kind: 'problem', run_stop_id: s!.id, problem: 'blocked', note: null }]);
    await post(t, [{ ...a.actions[0]!, client_uuid: randomUUID() }]);
    expect((await serviceDb().select().from(run_stop).where(eq(run_stop.id, s!.id)))[0]!.status).toBe('onsite');
    await post(t, [a.actions[1]]);
    const rows = await serviceDb().select().from(visit).where(eq(visit.client_uuid, a.visit));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.departed_device_at).not.toBeNull();
    expect((await serviceDb().select().from(run_stop).where(eq(run_stop.id, s!.id)))[0]!.status).toBe('done');
  });

  it('full-size photos can go straight to storage and are recorded once, with the server hashing the stored bytes', async () => {
    const { finishPhotoUpload, resolveToken, signPhotoUpload } = await import('@/lib/driver');
    const rs = await resolveToken(token);
    const a = stopActions(stops[3]!.id, new Date());
    await post(token, [a.actions[0]]);
    const input = { client_uuid: randomUUID(), visit_client_uuid: a.visit, phase: 'after' as const, content_type: 'image/jpeg' };
    await expect(finishPhotoUpload(rs, input)).rejects.toThrow('upload_missing');
    const signed = await signPhotoUpload(rs, input);
    if (signed.status !== 'upload') throw new Error('expected an upload');
    const bytes = await jpeg();
    const put = await fetch(signed.url, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg', 'x-upsert': 'true' }, body: new Uint8Array(bytes) });
    expect(put.ok, await put.clone().text()).toBe(true);
    expect((await finishPhotoUpload(rs, input)).status).toBe('ok');
    expect((await finishPhotoUpload(rs, input)).status).toBe('duplicate');
    expect((await signPhotoUpload(rs, input)).status).toBe('duplicate');
    const [row] = await serviceDb().select().from(visit_photo).where(eq(visit_photo.client_uuid, input.client_uuid));
    expect(row!.sha256).toBe(sha256Hex(bytes));
    expect((row!.exif as any).Make).toBe('FlakeTestCam');
  });

  it('another run cannot get an upload URL for this visit', async () => {
    const { resolveToken, signPhotoUpload } = await import('@/lib/driver');
    const a = stopActions(stops[3]!.id, new Date());
    await post(token, [a.actions[0]]);
    const other = await resolveToken(otherTenantToken);
    await expect(signPhotoUpload(other, { client_uuid: randomUUID(), visit_client_uuid: a.visit, phase: 'after', content_type: 'image/jpeg' })).rejects.toThrow('visit_not_synced');
  });

  it('keeps photos byte-identical with EXIF and resolution, once', async () => {
    const a = stopActions(stops[3]!.id, new Date());
    await post(token, [a.actions[0]]);
    const bytes = await jpeg();
    const client = randomUUID();
    const send = () => {
      const form = new FormData();
      form.set('file', new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }), 'x.jpg');
      form.set('client_uuid', client);
      form.set('visit_client_uuid', a.visit);
      form.set('phase', 'before');
      form.set('taken_at', new Date().toISOString());
      return photosRoute(req(`/api/d/${token}/photos`, { method: 'POST', body: form }), params(token));
    };
    expect((await (await send()).json()).status).toBe('ok');
    expect((await (await send()).json()).status).toBe('duplicate');
    const rows = await serviceDb().select().from(visit_photo).where(eq(visit_photo.client_uuid, client));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.width).toBeGreaterThanOrEqual(2048);
    expect((rows[0]!.exif as any).Make).toBe('FlakeTestCam');
    const stored = await getBlob('photos', rows[0]!.storage_path);
    expect(sha256Hex(stored!)).toBe(sha256Hex(bytes));
    expect(rows[0]!.storage_path.startsWith(`${w.tenantId}/`)).toBe(true);
  });

  it('a photo that beats its visit gets a retryable 409', async () => {
    const form = new FormData();
    form.set('file', new Blob([new Uint8Array(await jpeg())], { type: 'image/jpeg' }), 'x.jpg');
    form.set('client_uuid', randomUUID());
    form.set('visit_client_uuid', randomUUID());
    form.set('phase', 'after');
    const res = await photosRoute(req(`/api/d/${token}/photos`, { method: 'POST', body: form }), params(token));
    expect(res.status).toBe(409);
  });

  it('Undo last within 2 minutes voids through a correction and leaves the visit row alone', async () => {
    const at = new Date();
    const a = stopActions(stops[4]!.id, at, { minutes: 0 });
    await post(token, a.actions);
    const undo = { client_uuid: randomUUID(), at: new Date(at.getTime() + 60000).toISOString(), kind: 'undo_last', run_stop_id: stops[4]!.id, visit_client_uuid: a.visit };
    expect((await (await post(token, [undo])).json()).acks[0].status).toBe('ok');
    const [v] = await serviceDb().select().from(visit).where(eq(visit.client_uuid, a.visit));
    const c = await serviceDb().select().from(visit_correction).where(eq(visit_correction.visit_id, v!.id));
    expect(c[0]!.field).toBe('voided');
    expect(c[0]!.by_crew).toBe(w.crewId);
    expect(v!.departed_device_at).not.toBeNull();
    const [stop] = await serviceDb().select().from(run_stop).where(eq(run_stop.id, stops[4]!.id));
    expect(stop!.status).toBe('open');
  });

  it('Undo after 2 minutes is refused', async () => {
    const at = new Date('2026-01-10T12:00:00Z');
    const a = stopActions(stops[4]!.id, at, { minutes: 0 });
    await post(token, a.actions);
    const undo = { client_uuid: randomUUID(), at: new Date(at.getTime() + 180000).toISOString(), kind: 'undo_last', run_stop_id: stops[4]!.id, visit_client_uuid: a.visit };
    const out = await (await post(token, [undo])).json();
    expect(out.acks[0].status).toBe('rejected');
    expect(out.acks[0].reason).toBe('undo_window_passed');
  });

  it('files a problem report, and skip marks the stop skipped', async () => {
    const client = randomUUID();
    await post(run2Token, [{ client_uuid: client, at: new Date().toISOString(), kind: 'problem', run_stop_id: (await serviceDb().select().from(run_stop).where(eq(run_stop.storm_run_id, run2Id)))[0]!.id, problem: 'skip', note: null }]);
    expect(await serviceDb().select().from(problem_report).where(eq(problem_report.client_uuid, client))).toHaveLength(1);
  });

  it('a driver offline during a move can still sync that stop', async () => {
    const out = await createStorm(ctxOf(w), { name: 'Move test', routeIds: [w.routeId, w.route2Id], crewAssignments: {} });
    const r1 = out.runs.find((x) => x.route_id === w.routeId)!;
    const r2 = out.runs.find((x) => x.route_id === w.route2Id)!;
    const [s] = await serviceDb().select().from(run_stop).where(and(eq(run_stop.storm_run_id, r1.id), eq(run_stop.seq, 1)));
    await patchRunStop(ctxOf(w), s!.id, { storm_run_id: r2.id });
    const a = stopActions(s!.id, new Date());
    const t = decryptToken(r1.link_token_enc!);
    expect((await (await post(t, a.actions)).json()).acks[0].status).toBe('ok');
  });
});

describe('changing routes mid-storm', () => {
  it('a finished stop stays with the truck that did it, even from an old tab', async () => {
    const out = await createStorm(ctxOf(w), { name: 'Done move', routeIds: [w.routeId, w.route2Id], crewAssignments: {} });
    const r1 = out.runs.find((x) => x.route_id === w.routeId)!;
    const r2 = out.runs.find((x) => x.route_id === w.route2Id)!;
    const [s] = await serviceDb().select().from(run_stop).where(and(eq(run_stop.storm_run_id, r1.id), eq(run_stop.seq, 1)));
    await serviceDb().update(run_stop).set({ status: 'done' }).where(eq(run_stop.id, s!.id));
    await expect(patchRunStop(ctxOf(w), s!.id, { storm_run_id: r2.id })).rejects.toMatchObject({ status: 409, code: 'done' });
    const [after] = await serviceDb().select().from(run_stop).where(eq(run_stop.id, s!.id));
    expect(after!.storm_run_id).toBe(r1.id);
  });

  it('two people adding the same lot at once add it once', async () => {
    const out = await createStorm(ctxOf(w), { name: 'Double add', routeIds: [w.routeId], crewAssignments: {} });
    const extra = w.siteIds[w.siteIds.length - 1]!;
    const tries = await Promise.allSettled([addStopToRun(ctxOf(w), out.runs[0]!.id, extra), addStopToRun(ctxOf(w), out.runs[0]!.id, extra)]);
    expect(tries.filter((t) => t.status === 'fulfilled')).toHaveLength(1);
    expect(tries.find((t) => t.status === 'rejected')).toMatchObject({ reason: { status: 409 } });
    expect(await serviceDb().select().from(run_stop).where(and(eq(run_stop.storm_run_id, out.runs[0]!.id), eq(run_stop.site_id, extra)))).toHaveLength(1);
  });
});

describe('someone who left the crew', () => {
  it('is never put on a new storm, a new pass or a reassigned run', async () => {
    const x = await makeWorld();
    await serviceDb().update(crew_member).set({ active: false }).where(eq(crew_member.id, x.crewId));
    const out = await createStorm(ctxOf(x), { name: 'Gone', routeIds: [x.routeId], crewAssignments: { [x.routeId]: x.crewId } });
    expect(out.runs[0]!.crew_id).toBeNull();
    await expect(assignRunDriver(ctxOf(x), out.runs[0]!.id, x.crewId)).rejects.toMatchObject({ status: 422 });
    await assignRunDriver(ctxOf(x), out.runs[0]!.id, x.crew2Id);
    await serviceDb().update(crew_member).set({ active: false }).where(eq(crew_member.id, x.crew2Id));
    const next = await addPass(ctxOf(x), out.storm.id);
    expect(next.runs.every((r) => r.crew_id === null)).toBe(true);
  });
});

describe('dead links', () => {
  it('unknown tokens get 410', async () => {
    const res = await runRoute(req('/api/d/not-a-real-token/run'), params('not-a-real-token'));
    expect(res.status).toBe(410);
    expect((await res.json()).code).toBe('link_dead');
  });
  it('a rotated link dies at once', async () => {
    const out = await createStorm(ctxOf(w), { name: 'Revoke', routeIds: [w.routeId], crewAssignments: {} });
    const old = decryptToken(out.runs[0]!.link_token_enc!);
    expect((await runRoute(req(`/api/d/${old}/run`), params(old))).status).toBe(200);
    const fresh = await revokeRunLink(ctxOf(w), out.runs[0]!.id);
    expect((await runRoute(req(`/api/d/${old}/run`), params(old))).status).toBe(410);
    const next = decryptToken(fresh.link_token_enc!);
    expect((await runRoute(req(`/api/d/${next}/run`), params(next))).status).toBe(200);
  });
  it('links expire 24 h after the storm closes', async () => {
    const out = await createStorm(ctxOf(w), { name: 'Expire', routeIds: [w.routeId], crewAssignments: {} });
    const t = decryptToken(out.runs[0]!.link_token_enc!);
    await closeStorm(ctxOf(w), out.storm.id, false);
    const [r] = await serviceDb().select().from(storm_run).where(eq(storm_run.id, out.runs[0]!.id));
    expect(Date.parse(r!.link_expires_at) - Date.now()).toBeLessThan(24.1 * 3600000);
    await serviceDb().execute(sql`update storm_run set link_expires_at = now() - interval '1 minute' where id = ${out.runs[0]!.id}`);
    expect((await runRoute(req(`/api/d/${t}/run`), params(t))).status).toBe(410);
  });
});
