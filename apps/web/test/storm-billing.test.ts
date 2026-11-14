import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb, and, customer, eq, invoice_draft, job, message_log, run_stop, serviceDb, site, sql, storm_run, stripe_event, tenant, trigger_alert, visit, visit_correction, withUser, storm } from '@flake/db';
import { MockEmail, signMockWebhook } from '@flake/providers';
import { POST as webhook } from '@/app/api/webhooks/stripe/route';
import { GET as cronJobs } from '@/app/api/cron/jobs/route';
import { applyFlagFix, approveDrafts as approve, chargeDraft, exportQbo, failDraft, generateDrafts, handleStripeEvent, billInstallments, retryDraft, visitsMissedByDrafts } from '@/lib/billing';
import { runJobs } from '@/lib/handlers';
import { notifyParty } from '@/lib/messaging';
import { processActions, resolveToken } from '@/lib/driver';
import { closeStorm, notifyCustomers, publishStorm, stormLive, patchRunStop, addPass } from '@/lib/storms';
import { decryptToken } from '@/lib/tokens';
import { consent, ctxOf, drain, makeWorld, req, stopActions, type World, createStorm } from './helpers';

async function completeStorm(w: World, opts: { skipLast?: boolean } = {}) {
  const ctx = ctxOf(w);
  const out = await createStorm(ctx, { name: 'Storm', routeIds: [w.routeId], crewAssignments: {} });
  await publishStorm(ctx, out.storm.id);
  const run = out.runs[0]!;
  const rs = await resolveToken(decryptToken(run.link_token_enc!));
  const stops = (await serviceDb().select().from(run_stop).where(eq(run_stop.storm_run_id, run.id))).sort((a, b) => a.seq - b.seq);
  const base = Date.parse('2026-01-20T10:00:00Z');
  for (const [i, s] of stops.entries()) {
    if (opts.skipLast && i === stops.length - 1) continue;
    const a = stopActions(s.id, new Date(base + i * 3600000), { depth: 3, gps: { lat: 41.48 + i * 0.001, lon: -81.8 }, minutes: 40 });
    await processActions(rs, a.actions as never);
  }
  await closeStorm(ctx, out.storm.id, false);
  return { stormId: out.storm.id, run, stops };
}

const drafts = (stormId: string) => serviceDb().select().from(invoice_draft).where(eq(invoice_draft.storm_id, stormId));

/**
 * These storms' visits are flagged (test GPS, no photos), and a flagged draft can't be approved (issue 7). The office
 * would waive the flags first; this does the same, then approves.
 */
async function approveDrafts(ctx: Parameters<typeof approve>[0], ids: string[]) {
  for (const id of ids) await serviceDb().execute(sql`update invoice_draft set flags = coalesce((select jsonb_agg(f || '{"waived": true}'::jsonb) from jsonb_array_elements(flags) f), '[]'::jsonb) where id = ${id} and status = 'draft'`);
  return approve(ctx, ids);
}

afterAll(() => closeDb());

describe('storm lifecycle', () => {
  let w: World;
  beforeAll(async () => {
    w = await makeWorld({ smsApproved: true });
  });

  it('refuses to publish a run with no driver', async () => {
    const out = await createStorm(ctxOf(w), { name: 'x', routeIds: [w.routeId], crewAssignments: {} });
    await serviceDb().execute(sql`update storm_run set crew_id = null where id = ${out.runs[0]!.id}`);
    await expect(publishStorm(ctxOf(w), out.storm.id)).rejects.toThrow(/no driver/);
  });

  it('snapshots routes: changing the master route later leaves the storm alone', async () => {
    const out = await createStorm(ctxOf(w), { name: 'x', routeIds: [w.routeId], crewAssignments: {}, siteIds: [w.siteIds[0]!, w.siteIds[1]!] });
    const stops = await serviceDb().select().from(run_stop).where(eq(run_stop.storm_run_id, out.runs[0]!.id));
    expect(stops).toHaveLength(2);
  });

  it('crew link goes by email always, and by SMS only with consent', async () => {
    const out = await createStorm(ctxOf(w), { name: 'Links', routeIds: [w.routeId], crewAssignments: {} });
    await publishStorm(ctxOf(w), out.storm.id);
    await drain();
    const rows = await serviceDb().select().from(message_log).where(and(eq(message_log.tenant_id, w.tenantId), eq(message_log.template, 'crew_link'), sql`related->>'storm_run_id' = ${out.runs[0]!.id}`));
    expect(rows.map((r) => r.channel)).toEqual(['email']);
    await consent(w.tenantId, '+12165550191');
    const out2 = await createStorm(ctxOf(w), { name: 'Links2', routeIds: [w.routeId], crewAssignments: {} });
    await publishStorm(ctxOf(w), out2.storm.id);
    await publishStorm(ctxOf(w), out2.storm.id);
    await drain();
    const rows2 = await serviceDb().select().from(message_log).where(and(eq(message_log.tenant_id, w.tenantId), eq(message_log.template, 'crew_link'), sql`related->>'storm_run_id' = ${out2.runs[0]!.id}`));
    expect(rows2.map((r) => r.channel).sort()).toEqual(['email', 'sms']);
  });

  it('Notify customers sends to each selected customer once, however often it is pressed', async () => {
    const out = await createStorm(ctxOf(w), { name: 'Notify', routeIds: [w.routeId], crewAssignments: {} });
    const input = { siteIds: [w.siteIds[0]!], template: 'late' as const, time: '8:00 AM' };
    await notifyCustomers(ctxOf(w), out.storm.id, input);
    await notifyCustomers(ctxOf(w), out.storm.id, input);
    await drain();
    await notifyCustomers(ctxOf(w), out.storm.id, input);
    await drain();
    const rows = await serviceDb().select().from(message_log).where(and(eq(message_log.tenant_id, w.tenantId), eq(message_log.template, 'late'), sql`related->>'storm_id' = ${out.storm.id}`));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.channel).toBe('email');
  });

  it('closing is blocked while a driver is on site, unless forced', async () => {
    const out = await createStorm(ctxOf(w), { name: 'Close', routeIds: [w.routeId], crewAssignments: {} });
    const rs = await resolveToken(decryptToken(out.runs[0]!.link_token_enc!));
    const [s] = await serviceDb().select().from(run_stop).where(and(eq(run_stop.storm_run_id, out.runs[0]!.id), eq(run_stop.seq, 1)));
    await processActions(rs, [{ client_uuid: randomUUID(), at: new Date().toISOString(), kind: 'arrive', run_stop_id: s!.id, visit_client_uuid: randomUUID(), gps: null }]);
    await expect(closeStorm(ctxOf(w), out.storm.id, false)).rejects.toThrow(/on site/);
    expect((await closeStorm(ctxOf(w), out.storm.id, true)).status).toBe('closed');
  });

  it('moving a stop notifies both drivers, and is blocked while on site', async () => {
    const out = await createStorm(ctxOf(w), { name: 'Move', routeIds: [w.routeId, w.route2Id], crewAssignments: {} });
    await publishStorm(ctxOf(w), out.storm.id);
    const r1 = out.runs.find((r) => r.route_id === w.routeId)!;
    const r2 = out.runs.find((r) => r.route_id === w.route2Id)!;
    const stops = (await serviceDb().select().from(run_stop).where(eq(run_stop.storm_run_id, r1.id))).sort((a, b) => a.seq - b.seq);
    const moved = await patchRunStop(ctxOf(w), stops[1]!.id, { storm_run_id: r2.id });
    expect(moved.storm_run_id).toBe(r2.id);
    expect(moved.previous_run_ids).toEqual([r1.id]);
    await drain();
    const msgs = await serviceDb().select().from(message_log).where(and(eq(message_log.tenant_id, w.tenantId), eq(message_log.template, 'route_changed')));
    expect(new Set(msgs.filter((m) => [r1.id, r2.id].includes((m.related as any).storm_run_id)).map((m) => (m.related as any).storm_run_id)).size).toBe(2);
    const rs = await resolveToken(decryptToken(r1.link_token_enc!));
    await processActions(rs, [{ client_uuid: randomUUID(), at: new Date().toISOString(), kind: 'arrive', run_stop_id: stops[0]!.id, visit_client_uuid: randomUUID(), gps: null }]);
    await expect(patchRunStop(ctxOf(w), stops[0]!.id, { storm_run_id: r2.id })).rejects.toThrow(/on site/);
  });

  it('Done sends one customer notice with a photo or business link, and a report for commercial sites', async () => {
    const { stops } = await completeStorm(w);
    await drain();
    const [site0Visit] = await serviceDb().select().from(visit).where(eq(visit.run_stop_id, stops[2]!.id));
    const rows = await serviceDb().select().from(message_log).where(and(eq(message_log.tenant_id, w.tenantId), sql`related->>'visit_id' = ${site0Visit!.id}`));
    expect(rows.map((r) => r.template).sort()).toEqual(['completion_report', 'done']);
    expect(rows.find((r) => r.template === 'completion_report')!.body).toContain('Arrived:');
  });

  it('a second pass marks its visits as re-plows', async () => {
    const out = await createStorm(ctxOf(w), { name: 'Pass', routeIds: [w.routeId], crewAssignments: {} });
    const p = await addPass(ctxOf(w), out.storm.id);
    expect(p.pass).toBe(2);
    const rs = await resolveToken(decryptToken(p.runs[0]!.link_token_enc!));
    const [s] = await serviceDb().select().from(run_stop).where(and(eq(run_stop.storm_run_id, p.runs[0]!.id), eq(run_stop.seq, 1)));
    const a = stopActions(s!.id, new Date());
    await processActions(rs, a.actions as never);
    const [v] = await serviceDb().select().from(visit).where(eq(visit.client_uuid, a.visit));
    expect(v!.is_replow).toBe(true);
  });

  it('the live board reads through RLS and counts correctly', async () => {
    const { stormId } = await completeStorm(w, { skipLast: true });
    const live = await stormLive({ ...ctxOf(w), timezone: 'America/New_York', role: 'owner' }, stormId);
    expect(live.counts).toMatchObject({ done: 4, open: 1, total: 5 });
    // A closed storm with nothing captured says so, instead of today's forecast or 0 (issue 45).
    expect(live.weather).toBeNull();
    expect(live.storm_weather).toMatchObject({ forecast_in: null, observed_in: null, note: 'No weather was captured for this storm.' });
    const stranger = await makeWorld();
    await expect(stormLive({ ...ctxOf(stranger), timezone: 'UTC', role: 'owner' }, stormId)).rejects.toThrow(/not found/i);
  });
});

describe('billing', () => {
  let w: World;
  let stormId: string;
  beforeAll(async () => {
    w = await makeWorld({ freeUntil: '2027-04-30' });
    ({ stormId } = await completeStorm(w));
  });

  it('prices all 5 types correctly from real driver actions', async () => {
    const rows = await generateDrafts(ctxOf(w), stormId);
    const total = (i: number) => rows.find((r) => r.draft.customer_id === w.customerIds[i])!.draft.subtotal_cents;
    expect(total(0)).toBe(6500); // per_push
    expect(total(1)).toBe(15000); // tier at 3"
    expect(total(2)).toBe(30000); // per_event
    expect(total(4)).toBe(9000); // 40 min rounds to 0.75 h x $120
    // Seasonal: nothing to charge this storm, so no $0 invoice to approve (issue 102).
    expect(rows.find((r) => r.draft.customer_id === w.customerIds[3])).toBeUndefined();
  });

  it('applies 1% clamped to the $0.50 minimum during the free season', async () => {
    const rows = await drafts(stormId);
    const fee = (i: number) => rows.find((r) => r.customer_id === w.customerIds[i])!.application_fee_cents;
    expect(fee(0)).toBe(65);
    expect(fee(2)).toBe(300);
  });

  it('flags missing visits, and the fixes are appended rather than edited', async () => {
    const x = await makeWorld();
    const { stormId: sid, stops } = await completeStorm(x, { skipLast: true });
    const rows = await generateDrafts(ctxOf(x), sid);
    const d = rows.find((r) => r.draft.customer_id === x.customerIds[4])!;
    expect((d.draft.flags as any[]).map((f) => f.code)).toContain('missing_visit');
    const fixed = await applyFlagFix(ctxOf(x), { action: 'skip', storm_id: sid, site_id: x.siteIds[4]! });
    // A skipped lot with no visit has nothing to bill, so its customer's draft is gone, not left at $0 (issue 90).
    expect(fixed.find((r) => r.draft.customer_id === x.customerIds[4])).toBeUndefined();
    const [stop] = await serviceDb().select().from(run_stop).where(eq(run_stop.id, stops[4]!.id));
    expect(stop!.status).toBe('skipped');

    const [v] = await serviceDb().select().from(visit).where(eq(visit.run_stop_id, stops[0]!.id));
    await applyFlagFix(ctxOf(x), { action: 'salt', storm_id: sid, visit_id: v!.id, unit: 'bag50lb', qty: 2 });
    const c = await serviceDb().select().from(visit_correction).where(eq(visit_correction.visit_id, v!.id));
    expect(c[0]!.field).toBe('salt');
    const [same] = await serviceDb().select().from(visit).where(eq(visit.id, v!.id));
    expect(same!.salt).toBeNull();
  });

  it('a waived flag stops blocking', async () => {
    const x = await makeWorld();
    const { stormId: sid } = await completeStorm(x, { skipLast: true });
    await generateDrafts(ctxOf(x), sid);
    const key = `missing_visit:${x.siteIds[4]}:`;
    const out = await applyFlagFix(ctxOf(x), { action: 'waive', storm_id: sid, flag_key: key });
    expect((out.find((r) => r.draft.customer_id === x.customerIds[4])!.draft.flags as any[])[0].waived).toBe(true);
  });

  it('approve is idempotent: a double click charges once', async () => {
    const rows = await drafts(stormId);
    const ids = rows.filter((r) => r.customer_id === w.customerIds[0]).map((r) => r.id);
    const [a, b] = await Promise.all([approveDrafts(ctxOf(w), ids), approveDrafts(ctxOf(w), ids)]);
    expect(a.approved + b.approved).toBe(1);
    expect((await approveDrafts(ctxOf(w), ids)).approved).toBe(0);
    const jobs = await serviceDb().select().from(job).where(eq(job.dedupe_key, `charge:${ids[0]}`));
    expect(jobs).toHaveLength(1);
    await drain();
    const [d] = await serviceDb().select().from(invoice_draft).where(eq(invoice_draft.id, ids[0]!));
    expect(d!.status).toBe('paid');
    expect(d!.stripe_payment_intent_id).toMatch(/^pi_mock_/);
    const before = await serviceDb().select().from(stripe_event).where(sql`id like 'evt_mock_%'`);
    await chargeDraft(w.tenantId, ids[0]!);
    expect(await serviceDb().select().from(stripe_event).where(sql`id like 'evt_mock_%'`)).toHaveLength(before.length);
  });

  it('a viewer cannot approve, and another tenant cannot touch these drafts', async () => {
    const rows = await drafts(stormId);
    const id = rows.find((r) => r.customer_id === w.customerIds[1])!.id;
    // Refused outright, which the API answers with 403. A viewer can read drafts but never write them.
    await expect(approveDrafts({ userId: w.viewerId, tenantId: w.tenantId }, [id])).rejects.toMatchObject({ code: '42501' });
    const stranger = await makeWorld();
    expect((await approveDrafts(ctxOf(stranger), [id])).approved).toBe(0);
    const [d] = await serviceDb().select().from(invoice_draft).where(eq(invoice_draft.id, id));
    expect(d!.status).toBe('draft');
    const seen = await withUser(stranger.userId, (tx) => tx.select().from(invoice_draft).where(eq(invoice_draft.id, id)));
    expect(seen).toHaveLength(0);
  });

  it('a failed card goes to failed, with a pay link emailed and the reason kept', async () => {
    await serviceDb().update(customer).set({ stripe_payment_method_id: 'pm_mock_0002' }).where(eq(customer.id, w.customerIds[1]!));
    const rows = await drafts(stormId);
    const id = rows.find((r) => r.customer_id === w.customerIds[1])!.id;
    await approveDrafts(ctxOf(w), [id]);
    await drain();
    const [d] = await serviceDb().select().from(invoice_draft).where(eq(invoice_draft.id, id));
    expect(d!.status).toBe('failed');
    expect(d!.status_detail).toMatch(/declined/);
    expect(d!.pay_link).toContain('/dev/pay/');
    const emails = await serviceDb().select().from(message_log).where(and(eq(message_log.tenant_id, w.tenantId), sql`related->>'draft_id' = ${id}`, eq(message_log.channel, 'email')));
    expect(emails).toHaveLength(1);
    expect(emails[0]!.body).toContain('/dev/pay/');
  });

  it('net-30 customers get a Stripe invoice with the fee', async () => {
    const rows = await drafts(stormId);
    const id = rows.find((r) => r.customer_id === w.customerIds[2])!.id;
    await approveDrafts(ctxOf(w), [id]);
    await drain();
    const [d] = await serviceDb().select().from(invoice_draft).where(eq(invoice_draft.id, id));
    expect(d!.status).toBe('sent');
    expect(d!.stripe_invoice_id).toMatch(/^in_mock_/);
    expect(d!.application_fee_cents).toBe(300);
  });

  it('a failed card can be retried with a fresh Stripe key once the customer fixes it, and a paid draft cannot', async () => {
    const rows = await drafts(stormId);
    const id = rows.find((r) => r.customer_id === w.customerIds[1])!.id;
    await serviceDb().update(customer).set({ stripe_payment_method_id: 'pm_mock_4242' }).where(eq(customer.id, w.customerIds[1]!));
    await retryDraft(ctxOf(w), id);
    await drain();
    const [d] = await serviceDb().select().from(invoice_draft).where(eq(invoice_draft.id, id));
    expect(d!.status).toBe('paid');
    await expect(retryDraft(ctxOf(w), id)).rejects.toThrow(/no longer be retried/);
  });

  it('connecting Stripe later lets a waiting draft go through', async () => {
    const x = await makeWorld({ connected: false });
    const { stormId: sid } = await completeStorm(x);
    await generateDrafts(ctxOf(x), sid);
    const id = (await drafts(sid)).find((r) => r.customer_id === x.customerIds[0])!.id;
    await approveDrafts(ctxOf(x), [id]);
    await drain();
    await serviceDb().update(tenant).set({ stripe_account_id: 'acct_mock_later', stripe_charges_enabled: true }).where(eq(tenant.id, x.tenantId));
    await retryDraft(ctxOf(x), id);
    await drain();
    expect((await serviceDb().select().from(invoice_draft).where(eq(invoice_draft.id, id)))[0]!.status).toBe('paid');
  });

  it('invoice lines say which site and when', async () => {
    const rows = await drafts(stormId);
    const d = rows.find((r) => r.customer_id === w.customerIds[0])!;
    expect((d.lines as any[])[0].description).toMatch(/^Site 0: Plow per push, Jan 20, 5:00 AM$/);
  });

  it('a card with nothing on file still gets paid through a link', async () => {
    await serviceDb().update(customer).set({ stripe_payment_method_id: null }).where(eq(customer.id, w.customerIds[4]!));
    const rows = await drafts(stormId);
    const id = rows.find((r) => r.customer_id === w.customerIds[4])!.id;
    await approveDrafts(ctxOf(w), [id]);
    await drain();
    const [d] = await serviceDb().select().from(invoice_draft).where(eq(invoice_draft.id, id));
    expect(d!.status).toBe('failed');
    expect(d!.status_detail).toMatch(/on file/);
  });

  it('a seasonal lot makes no $0 draft, and the storm is billed once the real drafts are handled (issue 102)', async () => {
    const rows = await drafts(stormId);
    expect(rows.find((r) => r.customer_id === w.customerIds[3])).toBeUndefined();
    const left = rows.filter((r) => r.status === 'draft').map((r) => r.id);
    if (left.length) await approveDrafts(ctxOf(w), left);
    await drain();
    const [s] = await serviceDb().select().from(storm).where(eq(storm.id, stormId));
    expect(s!.status).toBe('billed');
  });

  it('a tenant with no Stripe stays approved with a clear reason', async () => {
    const x = await makeWorld({ connected: false });
    const { stormId: sid } = await completeStorm(x);
    await generateDrafts(ctxOf(x), sid);
    const rows = await drafts(sid);
    const id = rows.find((r) => r.customer_id === x.customerIds[0])!.id;
    await approveDrafts(ctxOf(x), [id]);
    await drain();
    const [d] = await serviceDb().select().from(invoice_draft).where(eq(invoice_draft.id, id));
    expect(d!.status).toBe('approved');
    expect(d!.status_detail).toMatch(/Payments are not connected.*Mark paid.*connect Stripe/);
  });

  it('paid Pro pays 0.5%', async () => {
    const x = await makeWorld({ plan: 'pro' });
    const { stormId: sid } = await completeStorm(x);
    const rows = await generateDrafts(ctxOf(x), sid);
    expect(rows.find((r) => r.draft.customer_id === x.customerIds[2])!.draft.application_fee_cents).toBe(150);
  });

  it('exports QuickBooks rows and regenerating leaves approved drafts alone', async () => {
    const csv = await exportQbo({ ...ctxOf(w), timezone: 'America/New_York' }, stormId);
    expect(csv.split('\r\n')[0]).toContain('InvoiceNo');
    expect(csv).toContain('Customer 0');
    const again = await generateDrafts(ctxOf(w), stormId);
    expect(again.find((r) => r.draft.customer_id === w.customerIds[0])!.draft.status).toBe('paid');
  });

  it('creates seasonal installment invoices once per month run', async () => {
    const x = await makeWorld();
    const nov = new Date('2026-11-15T15:00:00Z');
    expect(await billInstallments(x.tenantId, nov)).toBe(1);
    // A second run in the same month, a retry say, bills nothing more (issue 6).
    expect(await billInstallments(x.tenantId, nov)).toBe(0);
    expect(await billInstallments(x.tenantId, new Date('2026-12-15T15:00:00Z'))).toBe(1);
    const rows = await serviceDb().execute(sql`select seq, amount_cents from installment_invoice where tenant_id = ${x.tenantId} order by seq`);
    expect(rows.map((r: any) => r.seq)).toEqual([1, 2]);
    expect(rows[0]!.amount_cents).toBe(60000);
  });
});

describe('edge cases around storms', () => {
  it('refuses a storm with nothing to plow, and leaves no storm behind', async () => {
    const w = await makeWorld();
    const before = (await serviceDb().select().from(storm).where(eq(storm.tenant_id, w.tenantId))).length;
    await expect(createStorm(ctxOf(w), { name: 'Empty', routeIds: [], crewAssignments: {} })).rejects.toThrow(/nothing to plow/);
    await expect(createStorm(ctxOf(w), { name: 'Empty', routeIds: [w.routeId], crewAssignments: {}, siteIds: [randomUUID()] })).rejects.toThrow(/nothing to plow/);
    expect((await serviceDb().select().from(storm).where(eq(storm.tenant_id, w.tenantId))).length).toBe(before);
  });

  it('retired sites stay out of new storms', async () => {
    const w = await makeWorld();
    await serviceDb().update(site).set({ active: false }).where(eq(site.id, w.siteIds[0]!));
    const out = await createStorm(ctxOf(w), { name: 'x', routeIds: [w.routeId], crewAssignments: {} });
    const stops = await serviceDb().select().from(run_stop).where(eq(run_stop.storm_run_id, out.runs[0]!.id));
    expect(stops.map((s) => s.site_id)).not.toContain(w.siteIds[0]);
    expect(stops).toHaveLength(4);
  });

  it('a quick Undo stops the done notice and the completion report', async () => {
    const w = await makeWorld();
    const out = await createStorm(ctxOf(w), { name: 'Undo', routeIds: [w.routeId], crewAssignments: {} });
    const rs = await resolveToken(decryptToken(out.runs[0]!.link_token_enc!));
    const [s] = await serviceDb().select().from(run_stop).where(and(eq(run_stop.storm_run_id, out.runs[0]!.id), eq(run_stop.seq, 2)));
    const at = new Date();
    const a = stopActions(s!.id, at, { minutes: 0 });
    await processActions(rs, [...a.actions, { client_uuid: randomUUID(), at: new Date(at.getTime() + 5000).toISOString(), kind: 'undo_last', run_stop_id: s!.id, visit_client_uuid: a.visit }]);
    await drain();
    const [v] = await serviceDb().select().from(visit).where(eq(visit.client_uuid, a.visit));
    expect(await serviceDb().select().from(message_log).where(and(eq(message_log.tenant_id, w.tenantId), sql`related->>'visit_id' = ${v!.id}`))).toEqual([]);
  });

  it('names a visit that synced after billing, and stops once it is picked up', async () => {
    const w = await makeWorld();
    const { stormId, run, stops } = await completeStorm(w, { skipLast: true });
    await generateDrafts(ctxOf(w), stormId);
    expect(await visitsMissedByDrafts(ctxOf(w), stormId)).toEqual([]);
    const rs = await resolveToken(decryptToken(run.link_token_enc!));
    await processActions(rs, stopActions(stops[4]!.id, new Date('2026-01-20T15:00:00Z'), { gps: { lat: 41.484, lon: -81.8 } }).actions as never);
    const missed = await visitsMissedByDrafts(ctxOf(w), stormId);
    expect(missed.map((m) => m.site)).toEqual(['Site 4']);
    expect(missed[0]!.in_review).toBe(true);
    await generateDrafts(ctxOf(w), stormId);
    expect(await visitsMissedByDrafts(ctxOf(w), stormId)).toEqual([]);
  });

  it('an alert starts one storm', async () => {
    const w = await makeWorld();
    const [alert] = await serviceDb().insert(trigger_alert).values({ tenant_id: w.tenantId, kind: 'forecast', site_ids: w.siteIds, detail: { headline: 'x' } }).returning();
    const input = { name: 'a', routeIds: [w.routeId], crewAssignments: {}, triggerAlertId: alert!.id };
    const both = await Promise.allSettled([createStorm(ctxOf(w), input), createStorm(ctxOf(w), input)]);
    expect(both.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    await expect(createStorm(ctxOf(w), input)).rejects.toThrow(/already handled/);
    expect(await serviceDb().select().from(storm).where(eq(storm.trigger_alert_id, alert!.id))).toHaveLength(1);
  });

  it('Plow again tapped twice makes one new pass, and a closed storm gets none', async () => {
    const w = await makeWorld();
    const out = await createStorm(ctxOf(w), { name: 'Passes', routeIds: [w.routeId], crewAssignments: {} });
    const both = await Promise.allSettled([addPass(ctxOf(w), out.storm.id), addPass(ctxOf(w), out.storm.id)]);
    const passes = (await serviceDb().select().from(storm_run).where(eq(storm_run.storm_id, out.storm.id))).map((r) => r.pass).sort();
    expect(passes).toEqual([1, 2]);
    expect(both.every((x) => x.status === 'fulfilled' && x.value.pass === 2)).toBe(true);
    await closeStorm(ctxOf(w), out.storm.id, true);
    await expect(addPass(ctxOf(w), out.storm.id)).rejects.toMatchObject({ status: 409 });
  });

  it('closing a storm again, or from an old tab, leaves a billed storm billed and its links closed', async () => {
    const w = await makeWorld();
    const { stormId } = await completeStorm(w);
    await serviceDb().update(storm).set({ status: 'billed' }).where(eq(storm.id, stormId));
    const [before] = await serviceDb().select().from(storm).where(eq(storm.id, stormId));
    const again = await closeStorm(ctxOf(w), stormId, false);
    expect(again.status).toBe('billed');
    const [after] = await serviceDb().select().from(storm).where(eq(storm.id, stormId));
    expect(after!.closed_at).toBe(before!.closed_at);
  });

  it('Retry pressed twice charges the card once', async () => {
    const x = await makeWorld({ connected: false });
    const { stormId: sid } = await completeStorm(x);
    await generateDrafts(ctxOf(x), sid);
    const id = (await drafts(sid)).find((r) => r.customer_id === x.customerIds[0])!.id;
    await approveDrafts(ctxOf(x), [id]);
    await drain();
    await serviceDb().update(tenant).set({ stripe_account_id: 'acct_mock_twice', stripe_charges_enabled: true }).where(eq(tenant.id, x.tenantId));
    const charges = async () => (await serviceDb().select().from(stripe_event).where(eq(stripe_event.type, 'payment_intent.succeeded'))).length;
    const n = await charges();
    await Promise.all([chargeDraft(x.tenantId, id, 1), chargeDraft(x.tenantId, id, 2), chargeDraft(x.tenantId, id, 3)]);
    expect((await charges()) - n).toBe(1);
    expect((await serviceDb().select().from(invoice_draft).where(eq(invoice_draft.id, id)))[0]!.status).toBe('paid');
  });

  it('a late failure from Stripe leaves a voided or paid invoice alone and texts no pay link', async () => {
    const x = await makeWorld();
    const { stormId: sid } = await completeStorm(x);
    await generateDrafts(ctxOf(x), sid);
    const [d1, d2] = (await drafts(sid)).map((r) => r.id);
    await serviceDb().update(invoice_draft).set({ status: 'void' }).where(eq(invoice_draft.id, d1!));
    await serviceDb().update(invoice_draft).set({ status: 'paid' }).where(eq(invoice_draft.id, d2!));
    await failDraft(x.tenantId, d1!, 'late');
    await failDraft(x.tenantId, d2!, 'late');
    const rows = await serviceDb().select().from(invoice_draft).where(sql`${invoice_draft.id} in (${d1}, ${d2})`);
    expect(rows.map((r) => r.status).sort()).toEqual(['paid', 'void']);
    expect(await serviceDb().select().from(message_log).where(sql`related->>'draft_id' in (${d1}, ${d2})`)).toHaveLength(0);
  });
});

describe('an email outage loses nothing', () => {
  it('a failed card still gets its pay link once email comes back, and sends it once', async () => {
    const w = await makeWorld();
    await serviceDb().update(customer).set({ stripe_payment_method_id: 'pm_mock_0002' }).where(eq(customer.id, w.customerIds[0]!));
    const { stormId } = await completeStorm(w);
    await generateDrafts(ctxOf(w), stormId);
    const id = (await drafts(stormId)).find((r) => r.customer_id === w.customerIds[0])!.id;
    await approveDrafts(ctxOf(w), [id]);
    const outage = vi.spyOn(MockEmail.prototype, 'send').mockRejectedValue(new Error('Resend 500: down'));
    await runJobs(100); // One round, as real backoff would do it. drain() would use up every retry at once.
    const [during] = await serviceDb().select().from(invoice_draft).where(eq(invoice_draft.id, id));
    expect(during!.status).toBe('failed');
    const sent = () => serviceDb().select().from(message_log).where(and(eq(message_log.tenant_id, w.tenantId), sql`related->>'draft_id' = ${id}`, eq(message_log.channel, 'email')));
    expect((await sent())[0]!.status).toBe('failed');
    outage.mockRestore();
    await drain();
    const rows = await sent();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('sent');
    expect(rows[0]!.body).toContain('/dev/pay/');
  });
});

describe('invoice text quiet hours', () => {
  it('holds an invoice text until 8 AM local, sends the email now, and leaves service notices alone', async () => {
    const w = await makeWorld({ smsApproved: true });
    await consent(w.tenantId, '+12165550191');
    const [t] = await serviceDb().select().from(tenant).where(eq(tenant.id, w.tenantId));
    const key = randomUUID();
    const threeAm = new Date('2026-01-15T08:00:00Z');
    const sent = await notifyParty(t!, { phone: '+12165550191', email: 'a@flake.test' }, { template: 'invoice', vars: { storm: 's', amount: '1.00', link: 'l' }, subject: 'x', key, now: threeAm });
    expect(sent).toEqual({ sms: false, email: true });
    const [held] = await serviceDb().select().from(job).where(eq(job.dedupe_key, `invoice_sms:${w.tenantId}:${key}`));
    expect(held!.run_at!.startsWith('2026-01-15')).toBe(true);
    expect(new Date(held!.run_at!).toISOString()).toBe('2026-01-15T13:00:00.000Z');
    const late = await notifyParty(t!, { phone: '+12165550191' }, { template: 'late', vars: { site: 's', time: '5' }, subject: 'x', key: randomUUID(), now: threeAm });
    expect(late.sms).toBe(true);
  });
});

describe('webhooks', () => {
  let w: World;
  beforeAll(async () => {
    w = await makeWorld();
  });
  const signed = (event: object) => {
    const raw = JSON.stringify(event);
    return req('/api/webhooks/stripe', { method: 'POST', headers: { 'stripe-signature': signMockWebhook(raw) }, body: raw });
  };

  it('rejects a bad signature', async () => {
    const res = await webhook(req('/api/webhooks/stripe', { method: 'POST', headers: { 'stripe-signature': 't=1,v1=00' }, body: '{}' }), {});
    expect(res.status).toBe(400);
  });

  it('dedupes on the event id', async () => {
    const event = { id: `evt_${randomUUID()}`, type: 'account.updated', account: 'x', data: { object: { id: 'acct_nobody', charges_enabled: true } } };
    expect((await (await webhook(signed(event), {})).json()).result).toBe('processed');
    expect((await (await webhook(signed(event), {})).json()).result).toBe('duplicate');
  });

  it('account.updated turns on charges for that tenant only', async () => {
    const acct = `acct_${randomUUID()}`;
    await serviceDb().update(tenant).set({ stripe_account_id: acct, stripe_charges_enabled: false }).where(eq(tenant.id, w.tenantId));
    await webhook(signed({ id: `evt_${randomUUID()}`, type: 'account.updated', data: { object: { id: acct, charges_enabled: true } } }), {});
    const [t] = await serviceDb().select().from(tenant).where(eq(tenant.id, w.tenantId));
    expect(t!.stripe_charges_enabled).toBe(true);
  });

  it('setup_intent.succeeded stores the payment method on the right customer', async () => {
    await webhook(signed({ id: `evt_${randomUUID()}`, type: 'setup_intent.succeeded', data: { object: { payment_method: 'pm_new', customer: 'cus_new', metadata: { tenant_id: w.tenantId, customer_id: w.customerIds[0] } } } }), {});
    const [c] = await serviceDb().select().from(customer).where(eq(customer.id, w.customerIds[0]!));
    expect(c!.stripe_payment_method_id).toBe('pm_new');
  });

  it('metadata naming another tenant cannot move a draft', async () => {
    const { stormId } = await completeStorm(w);
    await generateDrafts(ctxOf(w), stormId);
    const [d] = await drafts(stormId);
    const stranger = await makeWorld();
    await handleStripeEvent({ id: `evt_${randomUUID()}`, type: 'invoice.paid', data: { object: { metadata: { draft_id: d!.id, tenant_id: stranger.tenantId } } } });
    const [same] = await serviceDb().select().from(invoice_draft).where(eq(invoice_draft.id, d!.id));
    expect(same!.status).toBe('draft');
    await handleStripeEvent({ id: `evt_${randomUUID()}`, type: 'invoice.paid', data: { object: { metadata: { draft_id: d!.id, tenant_id: w.tenantId } } } });
    const [paid] = await serviceDb().select().from(invoice_draft).where(eq(invoice_draft.id, d!.id));
    expect(paid!.status).toBe('paid');
  });

  it('a dispute marks the draft', async () => {
    const { stormId } = await completeStorm(w);
    await generateDrafts(ctxOf(w), stormId);
    const [d] = await drafts(stormId);
    await serviceDb().update(invoice_draft).set({ stripe_payment_intent_id: `pi_${d!.id}` }).where(eq(invoice_draft.id, d!.id));
    await handleStripeEvent({ id: `evt_${randomUUID()}`, type: 'charge.dispute.created', data: { object: { payment_intent: `pi_${d!.id}` } } });
    const [same] = await serviceDb().select().from(invoice_draft).where(eq(invoice_draft.id, d!.id));
    expect(same!.disputed).toBe(true);
  });

  it('subscription events set the plan', async () => {
    await handleStripeEvent({ id: `evt_${randomUUID()}`, type: 'customer.subscription.created', data: { object: { status: 'active', metadata: { tenant_id: w.tenantId } } } });
    expect((await serviceDb().select().from(tenant).where(eq(tenant.id, w.tenantId)))[0]!.plan).toBe('pro');
    await handleStripeEvent({ id: `evt_${randomUUID()}`, type: 'customer.subscription.deleted', data: { object: { status: 'canceled', metadata: { tenant_id: w.tenantId } } } });
    expect((await serviceDb().select().from(tenant).where(eq(tenant.id, w.tenantId)))[0]!.plan).toBe('free');
  });

  it('cron routes refuse a missing secret', async () => {
    expect((await cronJobs(req('/api/cron/jobs'), {})).status).toBe(401);
  });
});
