import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { and, closeDb, eq, invoice_draft, message_log, run_stop, serviceDb, sql, storm, visit } from '@flake/db';
import { processActions, resolveToken, savePhoto } from '@/lib/driver';
import { plainText } from '@/lib/messaging';
import { createQuote, declineQuote } from '@/lib/quotes';
import { closeStorm } from '@/lib/storms';
import { decryptToken } from '@/lib/tokens';
import { createStorm, ctxOf, drain, makeWorld, stopActions } from './helpers';

afterAll(async () => {
  await drain();
  await serviceDb().execute(sql`update job set done_at = now() where done_at is null and dead_at is null`);
  await closeDb();
});

describe('issue 70: what someone typed reaches the office as plain text', () => {
  it('strips tags and control characters and caps the length', () => {
    expect(plainText('Nope <script>alert(1)</script><img src=x onerror=alert(2)> thanks')).toBe('Nope alert(1) thanks');
    expect(plainText('a\u0000b\nc')).toBe('a b c');
    expect(plainText('x'.repeat(400), 50)).toHaveLength(50);
  });
  it('a decline note with HTML gives the office a short subject and a clean body', async () => {
    const w = await makeWorld();
    const q = await createQuote(ctxOf(w), { site_id: w.siteIds[0]!, season: '2027-28', services: [{ service: 'plow', trigger_in: 2, pricing: { type: 'per_push', amount_cents: 7000 } }], send: false });
    await declineQuote(q.token, { reason: 'No thanks <script>alert(1)</script><img src=x onerror=alert(2)>' });
    await drain();
    const [m] = await serviceDb().select().from(message_log).where(and(eq(message_log.tenant_id, w.tenantId), eq(message_log.template, 'owner_alert'), eq(message_log.channel, 'email')));
    expect(m!.status).toBe('sent');
    expect(m!.body).toContain('Their note: "No thanks alert(1)"');
    expect(m!.body).not.toMatch(/<|onerror/);
    // The stored note stays exactly as typed; the site page escapes it.
    const [c] = (await serviceDb().execute(sql`select decline_reason from contract where id = ${q.contract.id}`)) as unknown as { decline_reason: string }[];
    expect(c!.decline_reason).toContain('<script>');
  });
});

describe('issue 71: a lot started before the close can still be finished after it', () => {
  it('Arrive again resumes the visit, and Done lands, while new lots stay refused', async () => {
    const w = await makeWorld();
    const ctx = ctxOf(w);
    const out = await createStorm(ctx, { name: 'S', routeIds: [w.routeId], crewAssignments: {} });
    const rs = await resolveToken(decryptToken(out.runs[0]!.link_token_enc!));
    const stops = (await serviceDb().select().from(run_stop).where(eq(run_stop.storm_run_id, out.runs[0]!.id))).sort((a, b) => a.seq - b.seq);
    const started = stopActions(stops[0]!.id, new Date(Date.now() - 20 * 60_000));
    await processActions(rs, [started.actions[0]] as never);
    // The driver moved on with a Problem and did the next lot.
    await processActions(rs, [{ client_uuid: randomUUID(), at: new Date(Date.now() - 15 * 60_000).toISOString(), kind: 'problem', run_stop_id: stops[0]!.id, problem: 'blocked', note: null }]);
    await processActions(rs, stopActions(stops[1]!.id, new Date(Date.now() - 10 * 60_000)).actions as never);
    await closeStorm(ctx, out.storm.id, true);
    const after = await resolveToken(decryptToken(out.runs[0]!.link_token_enc!));
    const later = Date.now() + 5 * 60_000;
    const resume = { ...started.actions[0]!, client_uuid: randomUUID(), at: new Date(later).toISOString() };
    const done = { ...started.actions[1]!, at: new Date(later + 60_000).toISOString() };
    expect((await processActions(after, [resume, done] as never)).map((a) => a.status)).toEqual(['ok', 'ok']);
    const [v] = await serviceDb().select().from(visit).where(eq(visit.client_uuid, started.visit));
    expect(v!.departed_device_at).toBeTruthy();
    expect((await serviceDb().select().from(run_stop).where(eq(run_stop.id, stops[0]!.id)))[0]!.status).toBe('done');
    // A lot never started is still refused.
    expect((await processActions(after, [stopActions(stops[2]!.id, new Date(later)).actions[0]] as never))[0]).toMatchObject({ status: 'rejected', reason: 'storm_closed' });
  });
});

describe("issue 75: an after photo that lands after the close clears the draft's photo flag", () => {
  it('the drafts in review are remade, and the board says when there is no after photo', async () => {
    const sharp = (await import('sharp')).default;
    const { closeStormAndDraft, stormLive } = await import('@/lib/storms');
    const w = await makeWorld();
    const ctx = ctxOf(w);
    const out = await createStorm(ctx, { name: 'S', routeIds: [w.routeId], crewAssignments: {} });
    const rs = await resolveToken(decryptToken(out.runs[0]!.link_token_enc!));
    const stops = (await serviceDb().select().from(run_stop).where(eq(run_stop.storm_run_id, out.runs[0]!.id))).sort((a, b) => a.seq - b.seq);
    const a = stopActions(stops[0]!.id, new Date(Date.now() - 30 * 60_000));
    await processActions(rs, a.actions as never);
    const jpg = new Uint8Array(await sharp({ create: { width: 32, height: 24, channels: 3, background: '#789' } }).jpeg().toBuffer());
    // A before photo only: the board says there's no after photo, as billing will.
    await savePhoto(rs, { client_uuid: randomUUID(), visit_client_uuid: a.visit, phase: 'before', bytes: jpg, contentType: 'image/jpeg' });
    const board = await stormLive({ ...ctx, timezone: 'America/New_York', role: 'owner' }, out.storm.id);
    expect(board.runs[0]!.stops.find((s) => s.id === stops[0]!.id)).toMatchObject({ photos: 1, after_photos: 0 });
    // The office closes before the after photo has uploaded: drafts are made with the flag.
    await closeStormAndDraft(ctx, out.storm.id, true);
    const flagged = async () => (await serviceDb().select().from(invoice_draft).where(eq(invoice_draft.storm_id, out.storm.id)))
      .flatMap((d) => (d.flags as { code: string; visit_id?: string }[]).filter((f) => f.code === 'no_after_photo'));
    const [v] = await serviceDb().select().from(visit).where(eq(visit.client_uuid, a.visit));
    const mine = async () => (await flagged()).filter((f) => f.visit_id === v!.id);
    expect(await mine()).toHaveLength(1);
    // Now it lands.
    await savePhoto(rs, { client_uuid: randomUUID(), visit_client_uuid: a.visit, phase: 'after', bytes: jpg, contentType: 'image/jpeg' });
    await drain();
    expect(await mine()).toHaveLength(0);
    expect((await serviceDb().select().from(storm).where(eq(storm.id, out.storm.id)))[0]!.status).toBe('closed');
  });
});

describe('issue 85: every lot nobody reached is skipped in one go', () => {
  it('Mark all skipped clears their $0 drafts and keeps the real ones', async () => {
    const { applyFlagFix, generateDrafts } = await import('@/lib/billing');
    const w = await makeWorld();
    const ctx = ctxOf(w);
    const out = await createStorm(ctx, { name: 'S', routeIds: [w.routeId], crewAssignments: {} });
    const rs = await resolveToken(decryptToken(out.runs[0]!.link_token_enc!));
    const stops = (await serviceDb().select().from(run_stop).where(eq(run_stop.storm_run_id, out.runs[0]!.id))).sort((a, b) => a.seq - b.seq);
    await processActions(rs, stopActions(stops[0]!.id, new Date(Date.now() - 30 * 60_000)).actions as never);
    await closeStorm(ctx, out.storm.id, true);
    const before = await generateDrafts(ctx, out.storm.id);
    const missing = before.flatMap((d) => (d.draft.flags as { code: string; site_id: string }[]).filter((f) => f.code === 'missing_visit').map((f) => f.site_id));
    expect(missing.length).toBeGreaterThan(1);
    const after = await applyFlagFix(ctx, { action: 'skip_all', storm_id: out.storm.id, site_ids: missing });
    expect(after.flatMap((d) => (d.draft.flags as { code: string }[]).map((f) => f.code))).not.toContain('missing_visit');
    expect(after.some((d) => d.draft.customer_id === w.customerIds[0])).toBe(true);
    // Skipped lots leave no $0 draft behind for Approve all clean to pick up (issue 90).
    expect(after.filter((d) => d.draft.subtotal_cents === 0 && d.draft.status === 'draft')).toEqual([]);
    const skipped = await serviceDb().select().from(run_stop).where(eq(run_stop.storm_run_id, out.runs[0]!.id));
    expect(skipped.filter((s) => missing.includes(s.site_id)).every((s) => s.status === 'skipped')).toBe(true);
  });
});

describe('issue 77: re-plan with no truck position starts from the last lot finished', () => {
  it('says so, and orders the rest from there', async () => {
    const { planRun } = await import('@/lib/storms');
    const w = await makeWorld();
    const ctx = ctxOf(w);
    const out = await createStorm(ctx, { name: 'S', routeIds: [w.routeId], crewAssignments: {} });
    const rs = await resolveToken(decryptToken(out.runs[0]!.link_token_enc!));
    const stops = (await serviceDb().select().from(run_stop).where(eq(run_stop.storm_run_id, out.runs[0]!.id))).sort((a, b) => a.seq - b.seq);
    // Nothing done yet and no GPS: nothing to start from.
    expect((await planRun({ ...ctx, timezone: 'America/New_York' }, out.runs[0]!.id)).from).toBeNull();
    await processActions(rs, stopActions(stops[0]!.id, new Date(Date.now() - 30 * 60_000), { gps: null }).actions as never);
    const plan = await planRun({ ...ctx, timezone: 'America/New_York' }, out.runs[0]!.id);
    expect(plan).toMatchObject({ from: 'last_done', from_label: 'Site 0' });
    expect(plan.suggested!.stops.map((s) => s.id)).not.toContain(stops[0]!.id);
  });
});

describe('issue 83: a driver problem reaches the office by email, not only push', () => {
  it('one alert per report, with the note as plain text', async () => {
    const w = await makeWorld();
    const ctx = ctxOf(w);
    const out = await createStorm(ctx, { name: 'S', routeIds: [w.routeId], crewAssignments: {} });
    const rs = await resolveToken(decryptToken(out.runs[0]!.link_token_enc!));
    const stops = (await serviceDb().select().from(run_stop).where(eq(run_stop.storm_run_id, out.runs[0]!.id))).sort((a, b) => a.seq - b.seq);
    const report = { client_uuid: randomUUID(), at: new Date().toISOString(), kind: 'problem', run_stop_id: stops[1]!.id, problem: 'blocked', note: 'Car in the <b>drive</b>' };
    await processActions(rs, [report] as never);
    await processActions(rs, [report] as never);
    await drain();
    const mail = await serviceDb().select().from(message_log).where(and(eq(message_log.tenant_id, w.tenantId), eq(message_log.template, 'owner_alert'), eq(message_log.channel, 'email')));
    expect(mail).toHaveLength(1);
    expect(mail[0]!.body).toContain('Crew One reported blocked at Site 1. Their note: "Car in the drive"');
  });
});
