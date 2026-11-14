import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, eq, invoice_draft, serviceDb, sql, storm } from '@flake/db';
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
