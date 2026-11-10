import { afterAll, describe, expect, it } from 'vitest';
import { and, closeDb, contract, customer, eq, installment_invoice, invoice_draft, route_stop, run_stop, serviceDb, sql, storm, storm_run, stripe_event, trigger_alert, withUser } from '@flake/db';
import { approveDrafts, billInstallments, generateDrafts, handleStripeEvent, reviseDraft } from '@/lib/billing';
import { linkEverIssued } from '@/lib/driver';
import { portalData } from '@/lib/portal';
import { acceptQuote, createQuote, resendQuote } from '@/lib/quotes';
import { addStockEntry, stockEntries } from '@/lib/reports';
import { requireFreeRouteName } from '@/lib/routes';
import { takeSitesOffWork } from '@/lib/sites';
import { closeStorm, createStorm as createStormStrict, reopenStorm } from '@/lib/storms';
import { changeRole } from '@/lib/team';
import { createStorm, ctxOf, makeWorld, uuid } from './helpers';

afterAll(() => closeDb());

const NOV = new Date('2026-11-15T15:00:00Z');
const DEC = new Date('2026-12-15T15:00:00Z');
const installments = (tenantId: string) => serviceDb().select().from(installment_invoice).where(eq(installment_invoice.tenant_id, tenantId)).orderBy(installment_invoice.seq);

async function closedStormWithDraft() {
  const w = await makeWorld();
  const ctx = ctxOf(w);
  const out = await createStorm(ctx, { name: 'S', routeIds: [w.routeId], crewAssignments: {} });
  await closeStorm(ctx, out.storm.id, true);
  const rows = await generateDrafts(ctx, out.storm.id);
  return { w, ctx, stormId: out.storm.id, rows };
}

describe('issue 7: a flagged draft cannot be approved', () => {
  it('is refused with a reason, and nothing is charged', async () => {
    const { ctx, rows } = await closedStormWithDraft();
    const flagged = rows.find((r) => (r.draft.flags as { severity: string }[]).some((f) => f.severity === 'review'))!;
    await expect(approveDrafts(ctx, [flagged.draft.id])).rejects.toMatchObject({ status: 409, code: 'flagged' });
    const [d] = await serviceDb().select().from(invoice_draft).where(eq(invoice_draft.id, flagged.draft.id));
    expect(d!.status).toBe('draft');
  });
});

describe('issue 20: an approved invoice can go back to review or be voided', () => {
  it('back to review reopens the storm, void ends it, and a charged one is refused', async () => {
    const { ctx, stormId, rows } = await closedStormWithDraft();
    const id = rows[0]!.draft.id;
    await serviceDb().update(invoice_draft).set({ status: 'approved', status_detail: 'Connect Stripe in Settings to collect this.' }).where(eq(invoice_draft.id, id));
    await serviceDb().update(storm).set({ status: 'billed' }).where(eq(storm.id, stormId));
    await reviseDraft(ctx, id, 'draft');
    expect((await serviceDb().select().from(invoice_draft).where(eq(invoice_draft.id, id)))[0]!.status).toBe('draft');
    expect((await serviceDb().select().from(storm).where(eq(storm.id, stormId)))[0]!.status).toBe('closed');
    await reviseDraft(ctx, id, 'void');
    expect((await serviceDb().select().from(invoice_draft).where(eq(invoice_draft.id, id)))[0]!.status).toBe('void');
    const other = rows[1]!.draft.id;
    await serviceDb().update(invoice_draft).set({ status: 'charged' }).where(eq(invoice_draft.id, other));
    await expect(reviseDraft(ctx, other, 'void')).rejects.toMatchObject({ status: 409 });
  });
  it('a viewer cannot', async () => {
    const { w, rows } = await closedStormWithDraft();
    await expect(reviseDraft({ userId: w.viewerId, tenantId: w.tenantId }, rows[0]!.draft.id, 'void')).rejects.toMatchObject({ code: '42501' });
  });
});

describe('issue 12: a Stripe event that failed to apply is applied on the retry', () => {
  it('a payment whose first delivery threw still marks the invoice paid', async () => {
    const { w, rows } = await closedStormWithDraft();
    const id = rows[0]!.draft.id;
    await serviceDb().update(invoice_draft).set({ status: 'charged' }).where(eq(invoice_draft.id, id));
    const evtId = `evt_${uuid()}`;
    // The first delivery recorded the id, then threw before applying anything.
    await serviceDb().insert(stripe_event).values({ id: evtId, type: 'payment_intent.succeeded' });
    const out = await handleStripeEvent({ id: evtId, type: 'payment_intent.succeeded', data: { object: { id: 'pi_x', metadata: { draft_id: id, tenant_id: w.tenantId } } } });
    expect(out).toBe('processed');
    expect((await serviceDb().select().from(invoice_draft).where(eq(invoice_draft.id, id)))[0]!.status).toBe('paid');
    // Once applied, a third delivery is a duplicate.
    expect(await handleStripeEvent({ id: evtId, type: 'payment_intent.succeeded', data: { object: { id: 'pi_x', metadata: { draft_id: id, tenant_id: w.tenantId } } } })).toBe('duplicate');
  });
});

describe('issue 6: seasonal installments, once per month', () => {
  it('an installment left half-done is finished on the retry, not skipped past', async () => {
    const w = await makeWorld();
    expect(await billInstallments(w.tenantId, NOV)).toBe(1);
    // As if the process died after recording installment 1 and before Stripe answered.
    await serviceDb().update(installment_invoice).set({ status: 'pending', stripe_invoice_id: null }).where(eq(installment_invoice.tenant_id, w.tenantId));
    await serviceDb().update(contract).set({ installments_billed: 0 }).where(eq(contract.site_id, w.siteIds[3]!));
    expect(await billInstallments(w.tenantId, NOV)).toBe(1);
    const rows = await installments(w.tenantId);
    expect(rows.map((r) => [r.seq, r.status, r.period])).toEqual([[1, 'sent', '2026-11']]);
    expect(await billInstallments(w.tenantId, NOV)).toBe(0);
  });
});

describe('issue 11: manual-billing customers stay off Stripe for installments', () => {
  it('records the installment without a Stripe invoice', async () => {
    const w = await makeWorld();
    await serviceDb().update(customer).set({ billing_mode: 'manual' }).where(eq(customer.id, w.customerIds[3]!));
    expect(await billInstallments(w.tenantId, NOV)).toBe(1);
    const [row] = await installments(w.tenantId);
    expect(row!.status).toBe('manual');
    expect(row!.stripe_invoice_id).toBeNull();
  });
});

describe('issue 10: re-signing a seasonal contract keeps its place in the schedule', () => {
  it('the new contract starts after the installments already billed', async () => {
    const w = await makeWorld();
    await billInstallments(w.tenantId, NOV);
    await billInstallments(w.tenantId, DEC);
    const q = await createQuote(ctxOf(w), { site_id: w.siteIds[3]!, season: '2026-27', services: [{ service: 'plow', trigger_in: 2, pricing: { type: 'seasonal', total_cents: 320000, installments: 5 } }], send: false });
    await acceptQuote(q.token, { name: 'Pat Resign', agree: true, consentSms: false, consentEmail: true, phone_e164: null }, null);
    const [k] = await serviceDb().select().from(contract).where(eq(contract.id, q.contract.id));
    expect(k!.installments_billed).toBe(2);
    // December already has its installment, from the old contract, so nothing more this month.
    expect(await billInstallments(w.tenantId, DEC)).toBe(0);
    expect(await billInstallments(w.tenantId, new Date('2027-01-15T15:00:00Z'))).toBe(1);
    expect((await installments(w.tenantId)).filter((r) => r.contract_id === q.contract.id).map((r) => r.seq)).toEqual([3]);
  });
});

describe('issue 14: a salt delivery counts once', () => {
  it('adding the same delivery twice keeps one entry', async () => {
    const w = await makeWorld();
    const entry = { id: `salt-order-${uuid()}`, kind: 'delivery' as const, at: new Date().toISOString(), tons: 12 };
    await addStockEntry(w.tenantId, entry);
    await addStockEntry(w.tenantId, entry);
    expect((await stockEntries(w.tenantId)).filter((e) => e.id === entry.id)).toHaveLength(1);
  });
});

describe('issue 24: a lot is live on one storm at a time', () => {
  it('a second storm on the same lots is refused, and can start without them', async () => {
    const w = await makeWorld();
    const ctx = ctxOf(w);
    await createStormStrict(ctx, { name: 'First', routeIds: [w.routeId], crewAssignments: {} });
    await expect(createStormStrict(ctx, { name: 'Second', routeIds: [w.routeId, w.route2Id], crewAssignments: {} })).rejects.toMatchObject({ status: 409, code: 'busy_sites' });
    const out = await createStormStrict(ctx, { name: 'Second', routeIds: [w.routeId, w.route2Id], crewAssignments: {}, skipBusy: true });
    expect(out.left_out).toBe(5);
    const stops = await serviceDb().select().from(run_stop).where(sql`${run_stop.storm_run_id} in (select id from storm_run where storm_id = ${out.storm.id})`);
    expect(stops.map((s) => s.site_id)).toEqual([w.siteIds[5]]);
  });
  it('a lot on two routes goes on the first one only (issue 26)', async () => {
    const w = await makeWorld();
    await serviceDb().insert(route_stop).values({ route_id: w.route2Id, site_id: w.siteIds[0]!, seq: 2, tenant_id: w.tenantId });
    const out = await createStormStrict(ctxOf(w), { name: 'Both', routeIds: [w.routeId, w.route2Id], crewAssignments: {} });
    const stops = await serviceDb().select().from(run_stop).where(and(eq(run_stop.site_id, w.siteIds[0]!), sql`${run_stop.storm_run_id} in (select id from storm_run where storm_id = ${out.storm.id})`));
    expect(stops).toHaveLength(1);
  });
});

describe('issue 33: a driver the office cleared stays cleared', () => {
  it('null means no driver; a route left out uses its usual driver', async () => {
    const w = await makeWorld();
    const out = await createStorm(ctxOf(w), { name: 'Who', routeIds: [w.routeId, w.route2Id], crewAssignments: { [w.routeId]: null } });
    const runs = await serviceDb().select().from(storm_run).where(eq(storm_run.storm_id, out.storm.id));
    expect(runs.find((r) => r.route_id === w.routeId)!.crew_id).toBeNull();
    expect(runs.find((r) => r.route_id === w.route2Id)!.crew_id).toBe(w.crew2Id);
  });
});

describe('issue 34: reopening a closed storm', () => {
  it('works until anything is approved, and never once billed', async () => {
    const { ctx, stormId, rows } = await closedStormWithDraft();
    const open = await reopenStorm(ctx, stormId);
    expect(open.status).toBe('active');
    expect(await serviceDb().select().from(invoice_draft).where(eq(invoice_draft.storm_id, stormId))).toHaveLength(0);
    await closeStorm(ctx, stormId, true);
    await generateDrafts(ctx, stormId);
    await serviceDb().update(invoice_draft).set({ status: 'approved' }).where(eq(invoice_draft.storm_id, stormId));
    await expect(reopenStorm(ctx, stormId)).rejects.toMatchObject({ status: 409, code: 'approved' });
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe('issue 5: an alert for lots a storm covers leaves the dashboard', () => {
  it('starting a storm marks it dispatched', async () => {
    const w = await makeWorld();
    const [a] = await serviceDb().insert(trigger_alert).values({ tenant_id: w.tenantId, kind: 'forecast', site_ids: w.siteIds.slice(0, 2), detail: { headline: 'Two sites at trigger' } }).returning();
    await createStorm(ctxOf(w), { name: 'Covers', routeIds: [w.routeId], crewAssignments: {} });
    expect((await serviceDb().select().from(trigger_alert).where(eq(trigger_alert.id, a!.id)))[0]!.status).toBe('dispatched');
  });
});

describe('issue 25: retiring a lot takes it off routes and running storms', () => {
  it('drops its route stop and skips its open stop', async () => {
    const w = await makeWorld();
    const out = await createStorm(ctxOf(w), { name: 'Retire', routeIds: [w.routeId], crewAssignments: {} });
    await withUser(w.userId, (tx) => takeSitesOffWork(tx, [w.siteIds[1]!]));
    expect(await serviceDb().select().from(route_stop).where(eq(route_stop.site_id, w.siteIds[1]!))).toHaveLength(0);
    const [stop] = await serviceDb().select().from(run_stop).where(and(eq(run_stop.site_id, w.siteIds[1]!), eq(run_stop.storm_run_id, out.runs[0]!.id)));
    expect(stop!.status).toBe('skipped');
  });
});

describe('issue 9: route names are distinct', () => {
  it('a second route with the same name is refused, ignoring case', async () => {
    const w = await makeWorld();
    await expect(withUser(w.userId, (tx) => requireFreeRouteName(tx, 'route a'))).rejects.toMatchObject({ status: 409, code: 'name_taken' });
    await expect(withUser(w.userId, (tx) => requireFreeRouteName(tx, 'Route A', w.routeId))).resolves.toBeUndefined();
  });
});

describe('issues 22 and 37: a waiting quote can be opened again', () => {
  it('resending makes a new link and kills the old one; the records page links the new one', async () => {
    const w = await makeWorld();
    const q = await createQuote(ctxOf(w), { site_id: w.siteIds[0]!, season: '2027-28', services: [{ service: 'plow', trigger_in: 2, pricing: { type: 'per_push', amount_cents: 7000 } }], send: true });
    const again = await resendQuote(ctxOf(w), q.contract.id);
    await expect(acceptQuote(q.token, { name: 'Old link', agree: true, consentSms: false, consentEmail: true, phone_e164: null }, null)).rejects.toMatchObject({ status: 404 });
    const portal = await portalData(w.customerIds[0]!, w.tenantId);
    expect(portal!.sites[0]!.quote?.url).toBe(again.url);
  });
});

describe('issue 38: a made-up route link is a 404', () => {
  it('only links that were handed out load the app', async () => {
    expect(await linkEverIssued('not-a-real-link')).toBe(false);
  });
});

describe('issue 39: team roles', () => {
  it('a role change that leaves no owner is refused', async () => {
    const w = await makeWorld();
    await expect(changeRole(w.tenantId, w.userId, 'dispatcher', w.userId)).rejects.toMatchObject({ status: 409, code: 'last_owner' });
    await changeRole(w.tenantId, w.viewerId, 'dispatcher', w.userId);
  });
});
