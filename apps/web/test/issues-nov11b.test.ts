import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { and, closeDb, eq, invoice_draft, message_log, problem_report, route, run_stop, serviceDb, sql, storm, visit, visit_correction, visit_photo } from '@flake/db';
import { PATCH as patchRoute } from '@/app/api/routes/[id]/route';
import { finishPhotoUpload, looksLikeImage, MAX_PHOTO_BYTES, processActions, resolveToken, signPhotoUpload } from '@/lib/driver';
import { portalData } from '@/lib/portal';
import { checkRouteUpdate } from '@/lib/routes';
import { closeStorm, stormLive } from '@/lib/storms';
import { decryptToken } from '@/lib/tokens';
import { createStorm, ctxOf, drain, makeWorld, stopActions } from './helpers';

// Stops finished here queue notices that run a minute later. Clear them so they can't land in another file's job tests.
afterAll(async () => {
  await drain();
  await serviceDb().execute(sql`update job set done_at = now() where done_at is null and dead_at is null`);
  await closeDb();
});
void patchRoute;

async function storming() {
  const w = await makeWorld();
  const ctx = ctxOf(w);
  const out = await createStorm(ctx, { name: 'S', routeIds: [w.routeId], crewAssignments: {} });
  const run = out.runs[0]!;
  const token = decryptToken(run.link_token_enc!);
  const stops = (await serviceDb().select().from(run_stop).where(eq(run_stop.storm_run_id, run.id))).sort((a, b) => a.seq - b.seq);
  return { w, ctx, stormId: out.storm.id, run, token, stops };
}
const liveVisits = (stopId: string) => serviceDb().execute(sql`select v.id, v.departed_device_at from visit v where v.run_stop_id = ${stopId}
  and not exists (select 1 from visit_correction c where c.visit_id = v.id and c.field = 'voided' and c.new_value = 'true'::jsonb)`) as unknown as Promise<{ id: string; departed_device_at: string | null }[]>;

describe('issue 53: a closed storm takes finished work, not new work', () => {
  it('refuses an Arrive tapped after the close, and the stop stays as it was', async () => {
    const { ctx, stormId, token, stops } = await storming();
    await closeStorm(ctx, stormId, true);
    const rs = await resolveToken(token);
    const a = stopActions(stops[0]!.id, new Date(Date.now() + 3 * 60_000));
    const acks = await processActions(rs, a.actions as never);
    expect(acks[0]).toMatchObject({ status: 'rejected', reason: 'storm_closed' });
    expect(await serviceDb().select().from(visit).where(eq(visit.client_uuid, a.visit))).toHaveLength(0);
    const problem = await processActions(rs, [{ client_uuid: randomUUID(), at: new Date(Date.now() + 3 * 60_000).toISOString(), kind: 'problem', run_stop_id: stops[1]!.id, problem: 'blocked', note: null }]);
    expect(problem[0]).toMatchObject({ status: 'rejected', reason: 'storm_closed' });
    expect((await serviceDb().select().from(run_stop).where(eq(run_stop.id, stops[1]!.id)))[0]!.status).toBe('open');
  });
  it('still takes work done before the close that syncs after it, and Done on a visit started before', async () => {
    const { ctx, stormId, token, stops } = await storming();
    const rs0 = await resolveToken(token);
    // Arrived on the phone before the close, but Done tapped after it: the driver was already on the lot.
    const started = stopActions(stops[0]!.id, new Date(Date.now() - 30 * 60_000), { minutes: 40 });
    await processActions(rs0, [started.actions[0]] as never);
    // A whole visit done offline before the close.
    const offline = stopActions(stops[1]!.id, new Date(Date.now() - 50 * 60_000));
    await closeStorm(ctx, stormId, true);
    const rs = await resolveToken(token);
    const acks = await processActions(rs, [started.actions[1], ...offline.actions] as never);
    expect(acks.map((a) => a.status)).toEqual(['ok', 'ok', 'ok']);
    expect((await liveVisits(stops[0]!.id))[0]!.departed_device_at).toBeTruthy();
  });
  it('the phone is told the storm is closed', async () => {
    const { ctx, stormId, token } = await storming();
    await closeStorm(ctx, stormId, true);
    const { loadRun } = await import('@/lib/driver');
    expect((await loadRun(await resolveToken(token))).storm.status).toBe('closed');
  });
});

describe('issue 54: two phones on one link cannot finish one stop twice', () => {
  it('the second Arrive is refused, its Done finds nothing, and one visit is billed', async () => {
    const { ctx, stormId, token, stops } = await storming();
    const rs = await resolveToken(token);
    const phoneA = stopActions(stops[0]!.id, new Date(Date.now() - 600_000));
    const phoneB = stopActions(stops[0]!.id, new Date(Date.now() - 590_000));
    const [a, b] = await Promise.all([processActions(rs, [phoneA.actions[0]] as never), processActions(rs, [phoneB.actions[0]] as never)]);
    expect([a[0]!.status, b[0]!.status].sort()).toEqual(['ok', 'rejected']);
    const loser = a[0]!.status === 'rejected' ? phoneA : phoneB;
    const winner = loser === phoneA ? phoneB : phoneA;
    expect([...a, ...b].find((x) => x.status === 'rejected')!.reason).toBe('stop_taken');
    expect((await processActions(rs, [loser.actions[1]] as never))[0]).toMatchObject({ status: 'rejected', reason: 'visit_missing' });
    expect((await processActions(rs, [winner.actions[1]] as never))[0]!.status).toBe('ok');
    expect(await liveVisits(stops[0]!.id)).toHaveLength(1);
    await closeStorm(ctx, stormId, true);
    const { generateDrafts } = await import('@/lib/billing');
    const drafts = await generateDrafts(ctx, stormId);
    const lines = drafts.flatMap((d) => d.draft.lines as { source_visit_ids: string[] }[]).filter((l) => l.source_visit_ids.length);
    expect(lines.flatMap((l) => l.source_visit_ids).filter((id) => id === (lines[0]?.source_visit_ids[0] ?? ''))).toHaveLength(1);
  });
  it("the same phone's retry and an Undo then Arrive again still work", async () => {
    const { token, stops } = await storming();
    const rs = await resolveToken(token);
    const first = stopActions(stops[0]!.id, new Date(Date.now() - 60_000));
    expect((await processActions(rs, [first.actions[0]] as never))[0]!.status).toBe('ok');
    // The response was lost and the phone sends the same visit again with a new action id.
    expect((await processActions(rs, [{ ...first.actions[0]!, client_uuid: randomUUID() }] as never))[0]!.status).toBe('ok');
    await processActions(rs, [{ client_uuid: randomUUID(), at: new Date().toISOString(), kind: 'undo_last', run_stop_id: stops[0]!.id, visit_client_uuid: first.visit }] as never);
    const again = stopActions(stops[0]!.id, new Date());
    expect((await processActions(rs, again.actions as never)).map((x) => x.status)).toEqual(['ok', 'ok']);
    expect(await liveVisits(stops[0]!.id)).toHaveLength(1);
  });
  it('a second pass is a new stop, so plowing again is not refused', async () => {
    const { ctx, stormId, token, stops } = await storming();
    const rs = await resolveToken(token);
    await processActions(rs, stopActions(stops[0]!.id, new Date(Date.now() - 600_000)).actions as never);
    const { addPass } = await import('@/lib/storms');
    const pass = await addPass(ctx, stormId);
    const rs2 = await resolveToken(decryptToken(pass.runs[0]!.link_token_enc!));
    const [s2] = await serviceDb().select().from(run_stop).where(and(eq(run_stop.storm_run_id, pass.runs[0]!.id), eq(run_stop.site_id, stops[0]!.site_id)));
    expect((await processActions(rs2, stopActions(s2!.id, new Date()).actions as never)).map((x) => x.status)).toEqual(['ok', 'ok']);
  });
});

describe('issue 57: Skip after Arrive closes out the visit', () => {
  it('voids the open visit, so nothing half-done is billed', async () => {
    const { ctx, stormId, token, stops } = await storming();
    const rs = await resolveToken(token);
    const a = stopActions(stops[0]!.id, new Date(Date.now() - 60_000));
    await processActions(rs, [a.actions[0]] as never);
    await processActions(rs, [{ client_uuid: randomUUID(), at: new Date().toISOString(), kind: 'problem', run_stop_id: stops[0]!.id, problem: 'skip', note: 'Gate locked' }]);
    expect(await liveVisits(stops[0]!.id)).toHaveLength(0);
    const [v] = await serviceDb().select().from(visit).where(eq(visit.client_uuid, a.visit));
    const [c] = await serviceDb().select().from(visit_correction).where(eq(visit_correction.visit_id, v!.id));
    expect(c).toMatchObject({ field: 'voided', reason: 'Driver skipped the stop after arriving' });
    expect((await serviceDb().select().from(run_stop).where(eq(run_stop.id, stops[0]!.id)))[0]!.status).toBe('skipped');
    await closeStorm(ctx, stormId, true);
    const { generateDrafts } = await import('@/lib/billing');
    const drafts = await generateDrafts(ctx, stormId);
    expect(drafts.flatMap((d) => (d.draft.lines as { source_visit_ids: string[] }[]).flatMap((l) => l.source_visit_ids))).not.toContain(v!.id);
  });
  it('a Problem that is not a skip leaves the visit open, so the driver can finish', async () => {
    const { token, stops } = await storming();
    const rs = await resolveToken(token);
    await processActions(rs, [stopActions(stops[0]!.id, new Date(Date.now() - 60_000)).actions[0]] as never);
    await processActions(rs, [{ client_uuid: randomUUID(), at: new Date().toISOString(), kind: 'problem', run_stop_id: stops[0]!.id, problem: 'blocked', note: null }]);
    expect(await liveVisits(stops[0]!.id)).toHaveLength(1);
    expect(await serviceDb().select().from(problem_report).where(eq(problem_report.site_id, stops[0]!.site_id))).toHaveLength(1);
  });
});

describe('issue 56: only real photos, under the cap, on every upload path', () => {
  it('recognises photo formats by their bytes', async () => {
    const jpg = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#888' } }).jpeg().toBuffer();
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#888' } }).png().toBuffer();
    expect(looksLikeImage(jpg)).toBe(true);
    expect(looksLikeImage(png)).toBe(true);
    const heic = new Uint8Array(32);
    heic.set(new TextEncoder().encode('ftypheic'), 4);
    expect(looksLikeImage(heic)).toBe(true);
    expect(looksLikeImage(new TextEncoder().encode('just some notes, renamed photo.jpg'))).toBe(false);
  });
  it('a signed upload that is not a photo, or is over 30 MB, is removed and refused', async () => {
    const { token, stops } = await storming();
    const rs = await resolveToken(token);
    const a = stopActions(stops[0]!.id, new Date());
    await processActions(rs, [a.actions[0]] as never);
    const put = async (body: Uint8Array) => {
      const input = { client_uuid: randomUUID(), visit_client_uuid: a.visit, phase: 'after' as const, content_type: 'image/jpeg' };
      const signed = await signPhotoUpload(rs, input);
      if (signed.status !== 'upload') throw new Error('expected an upload');
      const res = await fetch(signed.url, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg', 'x-upsert': 'true' }, body: Buffer.from(body) });
      expect(res.ok, await res.clone().text()).toBe(true);
      return input;
    };
    const text = await put(new TextEncoder().encode('not a photo at all'));
    await expect(finishPhotoUpload(rs, text)).rejects.toMatchObject({ status: 415 });
    const big = new Uint8Array(MAX_PHOTO_BYTES + 1024);
    big.set([0xff, 0xd8, 0xff], 0);
    const huge = await put(big);
    await expect(finishPhotoUpload(rs, huge)).rejects.toMatchObject({ status: 413 });
    const [v] = await serviceDb().select().from(visit).where(eq(visit.client_uuid, a.visit));
    expect(await serviceDb().select().from(visit_photo).where(eq(visit_photo.visit_id, v!.id))).toHaveLength(0);
    // The refused file is gone from storage too, so a retry finds nothing to record.
    await expect(finishPhotoUpload(rs, text)).rejects.toThrow('upload_missing');
  }, 60_000);
});

describe('issue 58: the route link is there before Publish', () => {
  it('owners and dispatchers get it without anything being sent; viewers never do', async () => {
    const { w, ctx, stormId } = await storming();
    const live = await stormLive({ ...ctx, timezone: 'America/New_York', role: 'owner' }, stormId);
    expect(live.runs[0]!.published_at).toBeNull();
    expect(live.runs[0]!.link).toMatch(/\/d\//);
    await drain();
    expect(await serviceDb().select().from(message_log).where(and(eq(message_log.tenant_id, w.tenantId), eq(message_log.template, 'crew_link')))).toHaveLength(0);
    const viewer = await stormLive({ userId: w.viewerId, tenantId: w.tenantId, timezone: 'America/New_York', role: 'viewer' }, stormId);
    expect(viewer.runs[0]!.link).toBeNull();
  });
});

describe('issue 52: an archived route can be restored', () => {
  it('restores, unless a route with its name was made since', async () => {
    const w = await makeWorld();
    await serviceDb().update(route).set({ archived_at: new Date().toISOString() }).where(eq(route.id, w.route2Id));
    const { withUser } = await import('@flake/db');
    await withUser(w.userId, (tx) => checkRouteUpdate(tx, w.route2Id, { archived: false }));
    await serviceDb().insert(route).values({ tenant_id: w.tenantId, name: 'route b' });
    await expect(withUser(w.userId, (tx) => checkRouteUpdate(tx, w.route2Id, { archived: false }))).rejects.toMatchObject({ status: 409, code: 'name_taken' });
    // Archiving never needs a free name.
    await withUser(w.userId, (tx) => checkRouteUpdate(tx, w.routeId, { archived: true }));
  });
});

describe('issue 60: a Due invoice shows what it is for', () => {
  it('lists line items, and marks invoices owed with or without a pay link', async () => {
    const { w, ctx, stormId, token, stops } = await storming();
    const rs = await resolveToken(token);
    await processActions(rs, stopActions(stops[0]!.id, new Date(Date.now() - 600_000)).actions as never);
    await closeStorm(ctx, stormId, true);
    const { generateDrafts } = await import('@/lib/billing');
    await generateDrafts(ctx, stormId);
    await serviceDb().update(invoice_draft).set({ status: 'sent', pay_link: null }).where(eq(invoice_draft.storm_id, stormId));
    const p = await portalData(w.customerIds[0]!, w.tenantId);
    const inv = p!.invoices[0]!;
    expect(inv).toMatchObject({ due: true, pay_link: null });
    expect(inv.lines.length).toBeGreaterThan(0);
    expect(inv.lines[0]!.description).toMatch(/Site 0/);
    expect(inv.lines.reduce((n, l) => n + l.amount_cents, 0)).toBe(inv.total_cents);
    void storm;
  });
});
