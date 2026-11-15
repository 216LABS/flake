import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { and, app_setting, closeDb, contract, customer, eq, installment_invoice, invoice_draft, job, route_stop, run_stop, serviceDb, site, sql, visit, withUser } from '@flake/db';
import { createStorm, ctxOf, drain, jsonReq, makeWorld, stopActions } from './helpers';

afterAll(async () => {
  await drain();
  await serviceDb().execute(sql`update job set done_at = now() where done_at is null and dead_at is null`);
  await closeDb();
});

/** A storm on Route A, published, with its run, stops in order, and the driver link resolved. */
async function stormWorld() {
  const { publishStorm } = await import('@/lib/storms');
  const { resolveToken } = await import('@/lib/driver');
  const { decryptToken } = await import('@/lib/tokens');
  const w = await makeWorld();
  const ctx = ctxOf(w);
  const out = await createStorm(ctx, { name: `Nov 15 ${randomUUID().slice(0, 4)}`, routeIds: [w.routeId], crewAssignments: {} });
  await publishStorm(ctx, out.storm.id);
  const run = out.runs.find((r) => r.route_id === w.routeId)!;
  const token = decryptToken(run.link_token_enc!);
  const stops = (await serviceDb().select().from(run_stop).where(eq(run_stop.storm_run_id, run.id))).sort((a, b) => a.seq - b.seq);
  return { w, ctx, stormId: out.storm.id, runId: run.id, token, stops, rs: () => resolveToken(token) };
}

describe('driver work that lands after the close (issue 159)', () => {
  it('a late Done and a late Undo queue a remake of the drafts in review, and an approved bill names the undone lot', async () => {
    const { closeStorm } = await import('@/lib/storms');
    const { generateDrafts, visitsUndoneOnBills } = await import('@/lib/billing');
    const { processActions } = await import('@/lib/driver');
    const s = await stormWorld();
    const db = serviceDb();
    const t0 = new Date(Date.now() - 40 * 60_000);
    // Push lot done before the close. Hourly lot (index 4) arrived before the close; its Done is still on the phone.
    const push = stopActions(s.stops[0]!.id, t0);
    expect((await processActions(await s.rs(), push.actions)).map((a) => a.status)).toEqual(['ok', 'ok']);
    const hourly = stopActions(s.stops[4]!.id, new Date(Date.now() - 20 * 60_000), { minutes: 10 });
    await processActions(await s.rs(), [hourly.actions[0]]);
    await closeStorm(s.ctx, s.stormId, true);
    await generateDrafts(s.ctx, s.stormId);
    await db.execute(sql`update job set done_at = now() where kind = 'billing.redraft' and payload->>'stormId' = ${s.stormId}`);
    // The queued Done, tapped before the close, arrives now.
    expect((await processActions(await s.rs(), [hourly.actions[1]]))[0]!.status).toBe('ok');
    const queued = await db.select().from(job).where(and(eq(job.kind, 'billing.redraft'), sql`${job.payload}->>'stormId' = ${s.stormId}`, sql`${job.done_at} is null`));
    expect(queued.length).toBe(1);
    await drain();
    const lines = (await db.select().from(invoice_draft).where(eq(invoice_draft.storm_id, s.stormId))).flatMap((d) => d.lines as { source_visit_ids: string[] }[]);
    const hourlyVisit = (await db.select().from(visit).where(eq(visit.client_uuid, hourly.visit)))[0]!;
    expect(lines.some((l) => l.source_visit_ids.includes(hourlyVisit.id))).toBe(true);

    // Approve the push lot's bill, then the driver's Undo on it (inside its window by the phone's clock) arrives.
    const pushDraft = (await db.select().from(invoice_draft).where(and(eq(invoice_draft.storm_id, s.stormId), eq(invoice_draft.customer_id, s.w.customerIds[0]!))))[0]!;
    // Approved as the owner would after waiving its photo flag.
    await db.update(invoice_draft).set({ status: 'approved' }).where(eq(invoice_draft.id, pushDraft.id));
    const undoAt = new Date(Date.parse(push.actions[1]!.at as string) + 60_000).toISOString();
    expect((await processActions(await s.rs(), [{ client_uuid: randomUUID(), at: undoAt, kind: 'undo_last', run_stop_id: s.stops[0]!.id, visit_client_uuid: push.visit }]))[0]!.status).toBe('ok');
    expect((await visitsUndoneOnBills(s.ctx, s.stormId)).map((u) => u.site)).toEqual(['Site 0']);
  });
});

describe('reopening a storm keeps the bills the owner voided (issue 147)', () => {
  it('a voided bill stays voided across reopen and close, and Unvoid brings it back to review', async () => {
    const { closeStorm, reopenStorm } = await import('@/lib/storms');
    const { generateDrafts, reviseDraft } = await import('@/lib/billing');
    const { processActions } = await import('@/lib/driver');
    const s = await stormWorld();
    const db = serviceDb();
    await processActions(await s.rs(), [...stopActions(s.stops[0]!.id, new Date(Date.now() - 30 * 60_000)).actions, ...stopActions(s.stops[2]!.id, new Date(Date.now() - 25 * 60_000)).actions]);
    await closeStorm(s.ctx, s.stormId, true);
    await generateDrafts(s.ctx, s.stormId);
    const [voided] = await db.select().from(invoice_draft).where(and(eq(invoice_draft.storm_id, s.stormId), eq(invoice_draft.customer_id, s.w.customerIds[2]!)));
    await reviseDraft(s.ctx, voided!.id, 'void');
    await reopenStorm(s.ctx, s.stormId);
    await expect(reviseDraft(s.ctx, voided!.id, 'draft')).rejects.toMatchObject({ code: 'storm_active' });
    await closeStorm(s.ctx, s.stormId, true);
    await generateDrafts(s.ctx, s.stormId);
    const [after] = await db.select().from(invoice_draft).where(eq(invoice_draft.id, voided!.id));
    expect(after!.status).toBe('void');
    await reviseDraft(s.ctx, voided!.id, 'draft');
    expect((await db.select().from(invoice_draft).where(eq(invoice_draft.id, voided!.id)))[0]!.status).toBe('draft');
  });
});

describe('the driver who arrived can finish after the office swaps drivers (issue 154), and a new phone picks up the open stop (issue 143)', () => {
  it('Done from the first driver is accepted, and a fresh load of the link returns the open visit for the current driver', async () => {
    const { assignRunDriver } = await import('@/lib/storms');
    const { loadRun, processActions } = await import('@/lib/driver');
    const s = await stormWorld();
    const a = stopActions(s.stops[1]!.id, new Date(Date.now() - 10 * 60_000));
    await processActions(await s.rs(), [a.actions[0]]);
    // A phone opening the link fresh sees its own open visit on the on-site stop.
    const fresh = await loadRun(await s.rs());
    expect(fresh.stops.find((x) => x.id === s.stops[1]!.id)!.open_visit).toMatchObject({ client_uuid: a.visit });
    await assignRunDriver(s.ctx, s.runId, s.w.crew2Id);
    // The new driver's phone doesn't pick up someone else's visit.
    expect((await loadRun(await s.rs())).stops.find((x) => x.id === s.stops[1]!.id)!.open_visit).toBeNull();
    // The first driver, still on the same link, finishes the lot.
    expect((await processActions(await s.rs(), [a.actions[1]]))[0]).toMatchObject({ status: 'ok' });
    const [v] = await serviceDb().select().from(visit).where(eq(visit.client_uuid, a.visit));
    expect(v!.departed_device_at).not.toBeNull();
    expect((await serviceDb().select().from(run_stop).where(eq(run_stop.id, s.stops[1]!.id)))[0]!.status).toBe('done');
  });
});

describe('what a driver action can write (issue 155)', () => {
  it('unknown services and salt units are dropped, an absurd quantity is held, and an SVG upload is refused', async () => {
    const { cleanDone } = await import('@/lib/driver');
    const { driverPhotoUpload } = await import('@flake/contracts');
    expect(cleanDone(['plow', 'haul', '<img src=x>', 'plow'], [{ unit: 'bag50lb', qty: 3 }, { unit: 'zzz', qty: 9 }, { unit: 'ton', qty: 9999 }])).toEqual({ services: ['plow', 'haul'], salt: [{ unit: 'bag50lb', qty: 3 }] });
    const base = { client_uuid: randomUUID(), visit_client_uuid: randomUUID(), phase: 'after' };
    expect(driverPhotoUpload.safeParse({ ...base, content_type: 'image/svg+xml' }).success).toBe(false);
    expect(driverPhotoUpload.safeParse({ ...base, content_type: 'image/heic' }).success).toBe(true);
  });
});

describe('payroll hours over midnight (issue 140)', () => {
  it('an overnight shift counts whole in the period it started, and not at all in the next', async () => {
    const { crewHours, period } = await import('@/lib/reports');
    const { processActions } = await import('@/lib/driver');
    const s = await stormWorld();
    const tz = 'America/New_York';
    // 11:50 PM to 12:20 AM, New York time, three days ago.
    const day = new Date(Date.now() - 3 * 86_400_000).toLocaleDateString('en-CA', { timeZone: tz });
    const start = new Date(`${day}T23:50:00-05:00`);
    const acts = [0, 1, 2].flatMap((i) => stopActions(s.stops[i]!.id, new Date(start.getTime() + i * 10 * 60_000), { minutes: 10 }).actions);
    await processActions(await s.rs(), acts);
    const next = new Date(Date.parse(`${day}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const rows = (from: string, to: string) => withUser(s.w.userId, (tx) => crewHours(tx, period(from, to, tz), tz));
    const first = (await rows(day, day)).filter((r) => r.crew === 'Crew One');
    expect(first.map((r) => [r.hours, r.stops])).toEqual([[0.5, 3]]);
    expect((await rows(next, next)).filter((r) => r.crew === 'Crew One')).toEqual([]);
  });
});

describe('a mid-season seasonal re-sign says what it will bill (issue 156)', () => {
  it('the quote text, and the job, both spread the rest over the installments left', async () => {
    const { seasonalPlan } = await import('@/lib/scope');
    const { seasonalRemaining } = await import('@flake/core/pricing');
    expect(seasonalPlan({ total_cents: 300000, installments: 5 }, '2026-27', new Date(), { cents: 150000, count: 3 }))
      .toBe('$3,000.00 for the season. $1,500.00 already billed under your earlier agreement; the remaining $1,500.00 in 2 monthly installments of $750.00');
    expect(seasonalRemaining(300000, 5, { cents: 250000, count: 5 })).toEqual([50000]);
    expect(seasonalRemaining(200000, 5, { cents: 250000, count: 5 })).toEqual([]);
    expect(seasonalPlan({ total_cents: 200000, installments: 5 }, undefined, new Date(), { cents: 250000, count: 5 })).toMatch(/nothing more is billed/);

    const { priorBilled } = await import('@/lib/quotes');
    const w = await makeWorld();
    const db = serviceDb();
    const [old] = await db.select().from(contract).where(eq(contract.site_id, w.siteIds[3]!));
    await db.update(contract).set({ installments_billed: 3, accepted_at: new Date(Date.now() - 90 * 86_400_000).toISOString(), created_at: new Date(Date.now() - 90 * 86_400_000).toISOString() }).where(eq(contract.id, old!.id));
    for (const seq of [1, 2, 3]) await db.insert(installment_invoice).values({ tenant_id: w.tenantId, contract_id: old!.id, seq, amount_cents: 60000, status: 'manual', period: `2026-0${seq}` });
    const [fresh] = await db.insert(contract).values({ tenant_id: w.tenantId, site_id: w.siteIds[3]!, season: old!.season, status: 'sent', services: [{ service: 'plow', pricing: { type: 'seasonal', total_cents: 300000, installments: 5 } }] }).returning();
    expect(await priorBilled(fresh!)).toEqual({ cents: 180000, count: 3 });
  });
});

describe('archive and restore a customer (issue 150), and restore a lot onto its route (issue 152)', () => {
  it('restoring brings back the lots archiving retired, back on their routes, and a stale request form gets a plain answer', async () => {
    const { PATCH } = await import('@/app/api/customers/[id]/route');
    const auth = await import('@/lib/auth');
    const w = await makeWorld({ plan: 'pro' });
    const db = serviceDb();
    const spy = (await import('vitest')).vi.spyOn(auth, 'requireApi').mockResolvedValue({ userId: w.userId, tenantId: w.tenantId, role: 'owner' } as never);
    const patch = (body: unknown) => PATCH(jsonReq(`/api/customers/${w.customerIds[0]}`, body, 'PATCH'), { params: Promise.resolve({ id: w.customerIds[0]! }) });
    expect((await patch({ archived: true })).status).toBe(200);
    expect((await db.select().from(site).where(eq(site.id, w.siteIds[0]!)))[0]!.active).toBe(false);
    expect(await db.select().from(route_stop).where(eq(route_stop.site_id, w.siteIds[0]!))).toEqual([]);
    // Saving the archived customer again doesn't forget which lots to bring back.
    expect((await patch({ archived: true })).status).toBe(200);
    expect((await patch({ archived: false })).status).toBe(200);
    expect((await db.select().from(site).where(eq(site.id, w.siteIds[0]!)))[0]!.active).toBe(true);
    expect((await db.select().from(route_stop).where(eq(route_stop.site_id, w.siteIds[0]!))).map((r) => r.route_id)).toEqual([w.routeId]);
    expect(await db.select().from(app_setting).where(eq(app_setting.key, `retired_with:${w.customerIds[0]}`))).toEqual([]);
    spy.mockRestore();

    // A records page opened before the lot was retired still shows the form; sending it says who to call.
    const { POST } = await import('@/app/api/c/[token]/request/route');
    const portal = await import('@/lib/portal');
    const spy2 = (await import('vitest')).vi.spyOn(portal, 'resolvePortal').mockResolvedValue({ tenantId: w.tenantId, customerId: w.customerIds[1]! } as never);
    await db.update(site).set({ active: false }).where(eq(site.id, w.siteIds[1]!));
    const res = await POST(jsonReq('/api/c/x/request', { site_id: w.siteIds[1] }), { params: Promise.resolve({ token: 'x' }) });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/isn't scheduling service at Site 1 right now/);
    spy2.mockRestore();
  });
});

describe('a stale tab can\'t undo a newer edit (issue 144)', () => {
  it('a change based on an old value is refused, and one based on the current value goes through', async () => {
    const { PATCH } = await import('@/app/api/customers/[id]/route');
    const auth = await import('@/lib/auth');
    const w = await makeWorld();
    const spy = (await import('vitest')).vi.spyOn(auth, 'requireApi').mockResolvedValue({ userId: w.userId, tenantId: w.tenantId, role: 'owner' } as never);
    const patch = (body: unknown) => PATCH(jsonReq(`/api/customers/${w.customerIds[0]}`, body, 'PATCH'), { params: Promise.resolve({ id: w.customerIds[0]! }) });
    expect((await patch({ name: 'Renamed', expected: { name: 'Customer 0' } })).status).toBe(200);
    const stale = await patch({ name: 'Old tab', expected: { name: 'Customer 0' } });
    expect(stale.status).toBe(409);
    expect((await stale.json()).code).toBe('stale_edit');
    expect((await patch({ contact_name: 'Pat', expected: { contact_name: null } })).status).toBe(200);
    const [c] = await serviceDb().select().from(customer).where(eq(customer.id, w.customerIds[0]!));
    expect([c!.name, c!.contact_name]).toEqual(['Renamed', 'Pat']);
    spy.mockRestore();
  });
});

describe('customer messages (issue 148)', () => {
  it('a Done with no photo has no "Photo:" link, and Running late needs a time', async () => {
    const { renderTemplate } = await import('@flake/core/messages');
    const { stormNotify } = await import('@flake/contracts');
    expect(renderTemplate('done_no_photo', { company: 'Co', site: 'Lot', time: '10:09 AM' })).toBe('Co: Lot cleared at 10:09 AM.');
    const ids = [randomUUID()];
    expect(stormNotify.safeParse({ siteIds: ids, template: 'late', time: ' ' }).success).toBe(false);
    expect(stormNotify.safeParse({ siteIds: ids, template: 'late', time: '2:30 PM' }).success).toBe(true);
    expect(stormNotify.safeParse({ siteIds: ids, template: 'on_the_way' }).success).toBe(true);
  });
});

describe('small wording and safety fixes (issues 142, 145, 152)', () => {
  it('sign-in only returns to local paths, names ending in s take an apostrophe, bad report dates are named', async () => {
    const { safeNext } = await import('@/lib/next-path');
    expect(safeNext('/billing?storm=abc')).toBe('/billing?storm=abc');
    for (const bad of ['//evil.example', '/\\evil.example', 'https://evil.example', '/login?next=/x', '', null]) expect(safeNext(bad)).toBe('/dashboard');
    const { possessive } = await import('@/lib/client');
    expect(possessive('QA & Sons')).toBe("QA & Sons'");
    expect(possessive("Flip's Plowing")).toBe("Flip's Plowing's");
    const { period } = await import('@/lib/reports');
    expect(period('bad', '2026-02-30', 'America/New_York').invalid).toEqual(['From "bad"', 'To "2026-02-30"']);
    expect(period('2026-02-01', '2026-02-28', 'America/New_York').invalid).toEqual([]);
  });

  it('a quote saved without sending reports emailed: false', async () => {
    const { createQuote } = await import('@/lib/quotes');
    const [SEASON] = (await import('@flake/contracts')).quotableSeasons();
    const w = await makeWorld();
    const out = await createQuote(ctxOf(w), { site_id: w.siteIds[5]!, season: SEASON, services: [{ service: 'plow', trigger_in: 2, pricing: { type: 'per_push', amount_cents: 5000 } }], send: false } as never);
    expect(out.emailed).toBe(false);
  });

  it('the contract in force this winter, in words', async () => {
    const { contractStanding } = await import('@/lib/scope');
    const now = new Date('2026-11-14T15:00:00Z');
    const tz = 'America/New_York';
    const c = (season: string) => ({ season, site_id: 's' });
    expect(contractStanding([c('2027-28'), c('2025-26')], now, tz)).toMatchObject({ text: '2025-26 carried over: no 2026-27 contract. 2027-28 signed.', tone: 'amber', inForce: '2025-26' });
    expect(contractStanding([c('2026-27')], now, tz)).toMatchObject({ text: 'Signed 2026-27.', tone: 'green' });
    expect(contractStanding([c('2027-28')], now, tz)).toMatchObject({ text: 'No 2026-27 contract. 2027-28 signed.', inForce: null });
    expect(contractStanding([], now, tz)).toBeNull();
  });
});
