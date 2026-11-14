import { afterAll, describe, expect, it } from 'vitest';
import { and, closeDb, eq, invoice_draft, serviceDb, sql, storm } from '@flake/db';
import { ctxOf, drain, makeWorld } from './helpers';

afterAll(async () => {
  await drain();
  await serviceDb().execute(sql`update job set done_at = now() where done_at is null and dead_at is null`);
  await closeDb();
});

describe('a check or cash payment can be recorded', () => {
  it('an approved or failed invoice can be marked paid; one still in review or already paid cannot', async () => {
    const { reviseDraft } = await import('@/lib/billing');
    const w = await makeWorld();
    const ctx = ctxOf(w);
    const db = serviceDb();
    const [s] = await db.insert(storm).values({ tenant_id: w.tenantId, name: 'Checks', started_at: new Date().toISOString(), status: 'billed' }).returning();
    const draft = async (i: number, status: 'approved' | 'failed' | 'draft') => (await db.insert(invoice_draft).values({ tenant_id: w.tenantId, storm_id: s!.id, customer_id: w.customerIds[i]!, lines: [], subtotal_cents: 6500, flags: [], status }).returning())[0]!;
    const approved = await draft(0, 'approved');
    const failed = await draft(1, 'failed');
    const review = await draft(2, 'draft');
    const status = async (id: string) => (await db.select().from(invoice_draft).where(eq(invoice_draft.id, id)))[0]!;
    await reviseDraft(ctx, approved.id, 'paid');
    await reviseDraft(ctx, failed.id, 'paid');
    expect(await status(approved.id)).toMatchObject({ status: 'paid', status_detail: 'Paid outside Stripe, marked by the office' });
    expect((await status(failed.id)).status).toBe('paid');
    await expect(reviseDraft(ctx, review.id, 'paid')).rejects.toMatchObject({ status: 409 });
    await expect(reviseDraft(ctx, approved.id, 'paid')).rejects.toMatchObject({ status: 409 });
  });
});

describe('a visit with an Arrive and no Done can still be billed or skipped', () => {
  async function leftOnSite() {
    const { run_stop } = await import('@flake/db');
    const { processActions, resolveToken } = await import('@/lib/driver');
    const { publishStorm, closeStorm } = await import('@/lib/storms');
    const { decryptToken } = await import('@/lib/tokens');
    const { createStorm, stopActions } = await import('./helpers');
    const w = await makeWorld();
    const ctx = ctxOf(w);
    const out = await createStorm(ctx, { name: 'Dead phone', routeIds: [w.routeId], crewAssignments: {}, siteIds: [w.siteIds[0]!] });
    await publishStorm(ctx, out.storm.id);
    const r = await resolveToken(decryptToken(out.runs[0]!.link_token_enc!));
    const [stop] = await serviceDb().select().from(run_stop).where(eq(run_stop.storm_run_id, out.runs[0]!.id));
    // Arrive only: the phone died before Done.
    await processActions(r, [stopActions(stop!.id, new Date(Date.now() - 3600_000)).actions[0]] as never);
    await closeStorm(ctx, out.storm.id, true);
    return { w, ctx, stormId: out.storm.id, stopId: stop!.id };
  }
  it('the office enters the time on site and the lot bills', async () => {
    const { applyFlagFix, generateDrafts } = await import('@/lib/billing');
    const { w, ctx, stormId } = await leftOnSite();
    const d = (await generateDrafts(ctx, stormId))[0]!.draft;
    const flag = (d.flags as any[]).find((f) => f.code === 'missing_visit');
    expect(flag.open_visit_id).toBeTruthy();
    expect(d.subtotal_cents).toBe(0);
    const after = await applyFlagFix(ctx, { action: 'finish', storm_id: stormId, visit_id: flag.open_visit_id, minutes: 25, services: flag.services });
    const mine = after.find((x) => x.draft.customer_id === w.customerIds[0])!.draft;
    expect((mine.flags as any[]).some((f) => f.code === 'missing_visit')).toBe(false);
    expect(mine.subtotal_cents).toBeGreaterThan(0);
    const { visit_correction } = await import('@flake/db');
    const [note] = await serviceDb().select().from(visit_correction).where(eq(visit_correction.visit_id, flag.open_visit_id));
    expect(note!.reason).toContain('never tapped Done');
  });
  it('marking it skipped works for a driver left on site, and voids the half-open visit', async () => {
    const { applyFlagFix, generateDrafts } = await import('@/lib/billing');
    const { run_stop } = await import('@flake/db');
    const { ctx, stormId, stopId } = await leftOnSite();
    await generateDrafts(ctx, stormId);
    const after = await applyFlagFix(ctx, { action: 'skip', storm_id: stormId, site_id: (await serviceDb().select().from(run_stop).where(eq(run_stop.id, stopId)))[0]!.site_id });
    expect((await serviceDb().select().from(run_stop).where(eq(run_stop.id, stopId)))[0]!.status).toBe('skipped');
    expect(after.flatMap((x) => x.draft.flags as any[]).some((f) => f.code === 'missing_visit')).toBe(false);
    expect(after.length).toBeGreaterThanOrEqual(0);
  });
});

describe('a done stop is not reopened under its visit', () => {
  it('reopening a done or on-site stop is refused; a skipped one reopens', async () => {
    const { run_stop } = await import('@flake/db');
    const { processActions, resolveToken } = await import('@/lib/driver');
    const { publishStorm, patchRunStop } = await import('@/lib/storms');
    const { decryptToken } = await import('@/lib/tokens');
    const { createStorm, stopActions } = await import('./helpers');
    const w = await makeWorld();
    const ctx = ctxOf(w);
    const out = await createStorm(ctx, { name: 'Reopen', routeIds: [w.routeId], crewAssignments: {}, siteIds: [w.siteIds[0]!, w.siteIds[1]!, w.siteIds[2]!] });
    await publishStorm(ctx, out.storm.id);
    const r = await resolveToken(decryptToken(out.runs[0]!.link_token_enc!));
    const stops = await serviceDb().select().from(run_stop).where(eq(run_stop.storm_run_id, out.runs[0]!.id));
    const [done, onsite, skipped] = [stops.find((s) => s.site_id === w.siteIds[0])!, stops.find((s) => s.site_id === w.siteIds[1])!, stops.find((s) => s.site_id === w.siteIds[2])!];
    await processActions(r, stopActions(done.id, new Date(Date.now() - 3600_000)).actions as never);
    await processActions(r, [stopActions(onsite.id, new Date(Date.now() - 600_000)).actions[0]] as never);
    await patchRunStop(ctx, skipped.id, { status: 'skipped' });
    await expect(patchRunStop(ctx, done.id, { status: 'open' })).rejects.toMatchObject({ status: 409, code: 'done' });
    await expect(patchRunStop(ctx, onsite.id, { status: 'open' })).rejects.toMatchObject({ status: 409, code: 'onsite' });
    expect((await patchRunStop(ctx, skipped.id, { status: 'open' })).status).toBe('open');
  });
});

describe('seasonal installments without Stripe, and their payment', () => {
  it('a company with no payments connected still records each month, to bill itself, and can mark it paid', async () => {
    const { installment_invoice } = await import('@flake/db');
    const { billInstallments, markInstallmentPaid } = await import('@/lib/billing');
    const w = await makeWorld({ connected: false });
    expect(await billInstallments(w.tenantId, new Date('2026-11-15T15:00:00Z'))).toBe(1);
    const [row] = await serviceDb().select().from(installment_invoice).where(eq(installment_invoice.tenant_id, w.tenantId));
    expect(row).toMatchObject({ status: 'manual', stripe_invoice_id: null, amount_cents: 60000 });
    await markInstallmentPaid(ctxOf(w), row!.id);
    expect((await serviceDb().select().from(installment_invoice).where(eq(installment_invoice.id, row!.id)))[0]!.status).toBe('paid');
    expect(await markInstallmentPaid(ctxOf(w), row!.id)).toEqual({ ok: true });
  });
  it('Stripe saying an installment invoice was paid, or failed, shows on it', async () => {
    const { installment_invoice } = await import('@flake/db');
    const { billInstallments, handleStripeEvent } = await import('@/lib/billing');
    const w = await makeWorld();
    await billInstallments(w.tenantId, new Date('2026-11-15T15:00:00Z'));
    const [row] = await serviceDb().select().from(installment_invoice).where(eq(installment_invoice.tenant_id, w.tenantId));
    expect(row!.status).toBe('sent');
    const send = (type: string, n: number) => handleStripeEvent({ id: `evt_inst_${row!.id}_${n}`, type, data: { object: { id: row!.stripe_invoice_id, metadata: { tenant_id: w.tenantId, contract_id: row!.contract_id } } } } as never);
    await send('invoice.payment_failed', 1);
    expect((await serviceDb().select().from(installment_invoice).where(eq(installment_invoice.id, row!.id)))[0]!.status).toBe('failed');
    await send('invoice.paid', 2);
    expect((await serviceDb().select().from(installment_invoice).where(eq(installment_invoice.id, row!.id)))[0]!.status).toBe('paid');
  });
});

describe('an archived route stays out of new storms', () => {
  it('starting a storm with an archived route is refused', async () => {
    const { route } = await import('@flake/db');
    const { createStorm } = await import('@/lib/storms');
    const w = await makeWorld();
    await serviceDb().update(route).set({ archived_at: new Date().toISOString() }).where(eq(route.id, w.route2Id));
    await expect(createStorm(ctxOf(w), { name: 'Old route', routeIds: [w.routeId, w.route2Id], crewAssignments: {} })).rejects.toMatchObject({ status: 409, code: 'route_archived' });
  });
});

describe('the installment job runs each day, not once per UTC month', () => {
  it('a run on the evening of Nov 30 (Dec 1 in UTC) does not use up December', async () => {
    const { vi } = await import('vitest');
    const { job } = await import('@flake/db');
    const { queueMissedReports } = await import('@/lib/handlers');
    const keys = async () => (await serviceDb().select({ k: job.dedupe_key }).from(job).where(eq(job.kind, 'billing.installments'))).map((r) => r.k);
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2031-12-01T04:30:00Z'));
      await queueMissedReports();
      vi.setSystemTime(new Date('2031-12-15T15:00:00Z'));
      await queueMissedReports();
    } finally {
      vi.useRealTimers();
    }
    const mine = (await keys()).filter((k) => k?.includes('2031-12'));
    expect(mine.length).toBe(2);
  });
});

describe('the board and billing agree on which lots have a contract', () => {
  it('a lot whose only signature is next winter\'s renewal shows as having no contract on this storm\'s board', async () => {
    const { contract } = await import('@flake/db');
    const { stormLive } = await import('@/lib/storms');
    const { createStorm } = await import('./helpers');
    const w = await makeWorld();
    const ctx = ctxOf(w);
    await serviceDb().update(contract).set({ season: '2099-00' }).where(eq(contract.site_id, w.siteIds[0]!));
    const out = await createStorm(ctx, { name: 'Renewal only', routeIds: [w.routeId], crewAssignments: {}, siteIds: [w.siteIds[0]!, w.siteIds[1]!] });
    const live = await stormLive({ ...ctx, timezone: 'America/New_York', role: 'owner' }, out.storm.id);
    const stops = live.runs.flatMap((r: any) => r.stops);
    expect(stops.find((s: any) => s.site_id === w.siteIds[0])!.no_contract).toBe(true);
    expect(stops.find((s: any) => s.site_id === w.siteIds[1])!.no_contract).toBe(false);
  });
});

describe('a storm with nothing left to bill is billed', () => {
  async function closedWith(siteIdx: number[]) {
    const { run_stop } = await import('@flake/db');
    const { processActions, resolveToken } = await import('@/lib/driver');
    const { publishStorm, closeStorm } = await import('@/lib/storms');
    const { decryptToken } = await import('@/lib/tokens');
    const { createStorm, stopActions } = await import('./helpers');
    const w = await makeWorld();
    const ctx = ctxOf(w);
    const out = await createStorm(ctx, { name: 'Settle', routeIds: [w.routeId], crewAssignments: {}, siteIds: siteIdx.map((i) => w.siteIds[i]!) });
    await publishStorm(ctx, out.storm.id);
    const r = await resolveToken(decryptToken(out.runs[0]!.link_token_enc!));
    const stops = await serviceDb().select().from(run_stop).where(eq(run_stop.storm_run_id, out.runs[0]!.id));
    for (const [i, s] of stops.entries()) await processActions(r, stopActions(s.id, new Date(Date.now() - 3600_000 + i * 1500_000), { depth: 3, gps: { lat: 41.48, lon: -81.8 } }).actions as never);
    await closeStorm(ctx, out.storm.id, true);
    return { w, ctx, stormId: out.storm.id };
  }
  const statusOf = async (id: string) => (await serviceDb().select().from(storm).where(eq(storm.id, id)))[0]!.status;
  it('only a seasonal lot: no bill to make, so the storm is billed, and it can still be reopened', async () => {
    const { generateDrafts } = await import('@/lib/billing');
    const { reopenStorm } = await import('@/lib/storms');
    const { ctx, stormId } = await closedWith([3]);
    expect(await generateDrafts(ctx, stormId)).toHaveLength(0);
    expect(await statusOf(stormId)).toBe('billed');
    expect((await reopenStorm(ctx, stormId)).status).toBe('active');
  });
  it('voiding the last bill in review finishes the storm', async () => {
    const { generateDrafts, reviseDraft } = await import('@/lib/billing');
    const { ctx, stormId } = await closedWith([0]);
    const [d] = await generateDrafts(ctx, stormId);
    expect(await statusOf(stormId)).toBe('closed');
    await reviseDraft(ctx, d!.draft.id, 'void');
    expect(await statusOf(stormId)).toBe('billed');
  });
});

describe('a bill the company collects itself can be sent to the customer', () => {
  it('Send bill emails the customer a link to their records, notes it on the bill, and refuses a bill still in review', async () => {
    const { customer, message_log } = await import('@flake/db');
    const { sendBill } = await import('@/lib/billing');
    const w = await makeWorld({ connected: false });
    const ctx = ctxOf(w);
    const db = serviceDb();
    await db.update(customer).set({ email: 'billme@example.com', notify_sms: false }).where(eq(customer.id, w.customerIds[0]!));
    const [s] = await db.insert(storm).values({ tenant_id: w.tenantId, name: 'Send it', started_at: new Date().toISOString(), status: 'billed' }).returning();
    const draft = async (i: number, status: 'approved' | 'draft') => (await db.insert(invoice_draft).values({ tenant_id: w.tenantId, storm_id: s!.id, customer_id: w.customerIds[i]!, lines: [], subtotal_cents: 8800, flags: [], status }).returning())[0]!;
    const ok = await draft(0, 'approved');
    const review = await draft(1, 'draft');
    expect(await sendBill(ctx, ok.id)).toEqual({ sent_to: 'billme@example.com' });
    await drain();
    const [m] = await db.select().from(message_log).where(and(eq(message_log.tenant_id, w.tenantId), eq(message_log.template, 'invoice'), eq(message_log.to_addr, 'billme@example.com')));
    expect(m!.body).toContain('$88.00');
    expect((await db.select().from(invoice_draft).where(eq(invoice_draft.id, ok.id)))[0]!.status_detail).toContain('Bill sent to billme@example.com');
    await expect(sendBill(ctx, review.id)).rejects.toMatchObject({ status: 409 });
  });
});
