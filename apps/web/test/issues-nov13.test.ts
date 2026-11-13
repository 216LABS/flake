import { afterAll, describe, expect, it } from 'vitest';
import { and, closeDb, customer, eq, message_log, run_stop, serviceDb } from '@flake/db';
import { processActions, resolveToken } from '@/lib/driver';
import { publishStorm } from '@/lib/storms';
import { decryptToken } from '@/lib/tokens';
import { ctxOf, createStorm, drain, makeWorld, stopActions } from './helpers';

afterAll(() => closeDb());

describe('issue 105: the per-visit service record email follows the customer\'s email choice', () => {
  it('goes to a commercial customer who kept emails on, and not to one who turned them off on the quote', async () => {
    const w = await makeWorld();
    // Customers 1 and 2 are commercial with an email address.
    await serviceDb().update(customer).set({ notify_email: false }).where(eq(customer.id, w.customerIds[1]!));
    await serviceDb().update(customer).set({ notify_email: true }).where(eq(customer.id, w.customerIds[2]!));
    const ctx = ctxOf(w);
    const out = await createStorm(ctx, { name: 'Records', routeIds: [w.routeId], crewAssignments: {}, siteIds: [w.siteIds[1]!, w.siteIds[2]!] });
    await publishStorm(ctx, out.storm.id);
    const run = out.runs[0]!;
    const rs = await resolveToken(decryptToken(run.link_token_enc!));
    const stops = await serviceDb().select().from(run_stop).where(eq(run_stop.storm_run_id, run.id));
    for (const [i, s] of stops.entries()) {
      const a = stopActions(s.id, new Date(Date.now() - 3600_000 + i * 1200_000), { depth: 3, gps: { lat: 41.48, lon: -81.8 }, minutes: 15, services: ['plow', 'salt'], salt: [{ unit: 'bag50lb', qty: 3 }] });
      await processActions(rs, a.actions as never);
    }
    await drain();
    const reports = await serviceDb().select().from(message_log).where(and(eq(message_log.tenant_id, w.tenantId), eq(message_log.template, 'completion_report')));
    const to = reports.map((r) => r.to_addr);
    const [off] = await serviceDb().select().from(customer).where(eq(customer.id, w.customerIds[1]!));
    const [on] = await serviceDb().select().from(customer).where(eq(customer.id, w.customerIds[2]!));
    expect(to).toContain(on!.email);
    expect(to).not.toContain(off!.email);
    // Salt reads as words on the record, not the unit code.
    expect(reports[0]!.body).toContain('Salt: 3 bags (50 lb)');
    expect(reports[0]!.body).not.toContain('bag50lb');
  });
});

describe('issue 109: a storm is billed at the price in force when it happened', () => {
  it('a re-signature after the storm does not reprice it; a storm after the re-signature uses the new price', async () => {
    const { contract, invoice_draft, storm, run_stop: rs } = await import('@flake/db');
    const { generateDrafts } = await import('@/lib/billing');
    const { closeStorm } = await import('@/lib/storms');
    const w = await makeWorld();
    const ctx = ctxOf(w);
    const siteId = w.siteIds[0]!; // per push $65
    const db = serviceDb();
    const [old] = await db.select().from(contract).where(eq(contract.site_id, siteId));
    await db.update(contract).set({ accepted_at: new Date(Date.now() - 30 * 86400_000).toISOString() }).where(eq(contract.id, old!.id));

    const runStorm = async (name: string) => {
      const out = await createStorm(ctx, { name, routeIds: [w.routeId], crewAssignments: {}, siteIds: [siteId] });
      await publishStorm(ctx, out.storm.id);
      const r = await resolveToken(decryptToken(out.runs[0]!.link_token_enc!));
      const [stop] = await db.select().from(rs).where(eq(rs.storm_run_id, out.runs[0]!.id));
      await processActions(r, stopActions(stop!.id, new Date(Date.now() - 3600_000), { depth: 3, gps: { lat: 41.48, lon: -81.8 }, minutes: 20 }).actions as never);
      await closeStorm(ctx, out.storm.id, true);
      return out.storm.id;
    };
    const before = await runStorm('Before re-sign');

    // The customer re-signs at $90: the old agreement is replaced (voided) and the new one accepted, as acceptQuote does.
    await db.update(contract).set({ status: 'void' }).where(eq(contract.id, old!.id));
    await db.insert(contract).values({ tenant_id: w.tenantId, site_id: siteId, season: old!.season, status: 'accepted', accepted_at: new Date().toISOString(), services: [{ service: 'plow', trigger_in: 2, pricing: { type: 'per_push', amount_cents: 9000 } }] });
    await db.update(storm).set({ started_at: new Date(Date.now() - 2 * 86400_000).toISOString() }).where(eq(storm.id, before));

    const priced = async (stormId: string) => {
      await generateDrafts(ctx, stormId);
      const rows = await db.select().from(invoice_draft).where(eq(invoice_draft.storm_id, stormId));
      return rows.find((r) => r.customer_id === w.customerIds[0])?.subtotal_cents;
    };
    expect(await priced(before)).toBe(6500);
    const after = await runStorm('After re-sign');
    expect(await priced(after)).toBe(9000);
  });

  it('a contract the office voided with no replacement still bills nothing', async () => {
    const { contract, invoice_draft } = await import('@flake/db');
    const { generateDrafts } = await import('@/lib/billing');
    const { closeStorm } = await import('@/lib/storms');
    const w = await makeWorld();
    const ctx = ctxOf(w);
    const siteId = w.siteIds[0]!;
    const db = serviceDb();
    await db.update(contract).set({ status: 'void', accepted_at: new Date(Date.now() - 30 * 86400_000).toISOString() }).where(eq(contract.site_id, siteId));
    const out = await createStorm(ctx, { name: 'Voided', routeIds: [w.routeId], crewAssignments: {}, siteIds: [siteId] });
    await publishStorm(ctx, out.storm.id);
    const r = await resolveToken(decryptToken(out.runs[0]!.link_token_enc!));
    const [stop] = await db.select().from(run_stop).where(eq(run_stop.storm_run_id, out.runs[0]!.id));
    await processActions(r, stopActions(stop!.id, new Date(Date.now() - 3600_000), { depth: 3, gps: { lat: 41.48, lon: -81.8 }, minutes: 20 }).actions as never);
    await closeStorm(ctx, out.storm.id, true);
    await generateDrafts(ctx, out.storm.id);
    const [d] = await db.select().from(invoice_draft).where(eq(invoice_draft.storm_id, out.storm.id));
    expect(d!.subtotal_cents).toBe(0);
    expect((d!.flags as any[]).map((f) => f.code)).toContain('no_contract');
  });
});

describe('issue 111: the office cannot skip a stop a driver is on, or one already done', () => {
  it('refuses both, and still skips an open stop', async () => {
    const { patchRunStop } = await import('@/lib/storms');
    const w = await makeWorld();
    const ctx = ctxOf(w);
    const out = await createStorm(ctx, { name: 'Skips', routeIds: [w.routeId], crewAssignments: {} });
    await publishStorm(ctx, out.storm.id);
    const r = await resolveToken(decryptToken(out.runs[0]!.link_token_enc!));
    const stops = (await serviceDb().select().from(run_stop).where(eq(run_stop.storm_run_id, out.runs[0]!.id))).sort((a, b) => a.seq - b.seq);
    const [done, onsite, open] = stops;
    await processActions(r, stopActions(done!.id, new Date(Date.now() - 3600_000), { depth: 3, gps: { lat: 41.48, lon: -81.8 }, minutes: 20 }).actions as never);
    const arriving = stopActions(onsite!.id, new Date(Date.now() - 600_000), { depth: 3, gps: { lat: 41.48, lon: -81.8 }, minutes: 20 }).actions.filter((a: any) => a.kind === 'arrive');
    await processActions(r, arriving as never);
    await expect(patchRunStop(ctx, onsite!.id, { status: 'skipped' })).rejects.toThrow(/on site/);
    await expect(patchRunStop(ctx, done!.id, { status: 'skipped' })).rejects.toThrow(/already done/);
    expect((await patchRunStop(ctx, open!.id, { status: 'skipped' })).status).toBe('skipped');
  });
});

describe('issue 109: a proof packet shows the agreement in force for its period', () => {
  it('a December packet keeps December\'s terms after a January re-signature', async () => {
    const { contract } = await import('@flake/db');
    const { assembleProof } = await import('@/lib/proof');
    const w = await makeWorld();
    const siteId = w.siteIds[0]!;
    const db = serviceDb();
    const [old] = await db.select().from(contract).where(eq(contract.site_id, siteId));
    await db.update(contract).set({ status: 'void', accepted_at: '2026-11-01T12:00:00Z', accepted_name: 'December Signer' }).where(eq(contract.id, old!.id));
    await db.insert(contract).values({ tenant_id: w.tenantId, site_id: siteId, season: old!.season, status: 'accepted', accepted_at: '2027-01-10T12:00:00Z', accepted_name: 'January Signer', services: [{ service: 'plow', trigger_in: 2, pricing: { type: 'per_push', amount_cents: 9000 } }] });
    const dec = await assembleProof(w.tenantId, siteId, '2026-12-09T05:00:00Z', '2026-12-13T05:00:00Z');
    expect(dec.contract?.accepted_name).toBe('December Signer');
    const feb = await assembleProof(w.tenantId, siteId, '2027-02-01T05:00:00Z', '2027-02-05T05:00:00Z');
    expect(feb.contract?.accepted_name).toBe('January Signer');
  });
});

describe('issue 113: a new quote for a lot replaces the one still waiting, so the old price can\'t be signed', () => {
  it('voids the waiting quote, refuses its link with a plain reason, and an earlier decline cannot be signed after a re-quote', async () => {
    const { contract } = await import('@flake/db');
    const { acceptQuote, createQuote, declineQuote, getQuote } = await import('@/lib/quotes');
    const w = await makeWorld();
    const ctx = ctxOf(w);
    const siteId = w.siteIds[1]!;
    const quote = (cents: number) => createQuote(ctx, { site_id: siteId, season: '2027-28', services: [{ service: 'plow', trigger_in: 2, pricing: { type: 'per_push', amount_cents: cents } }], send: false });
    const cheap = await quote(6500);
    const real = await quote(9000);
    const statusOf = async (id: string) => (await serviceDb().select({ s: contract.status }).from(contract).where(eq(contract.id, id)))[0]!.s;
    expect(await statusOf(cheap.contract.id)).toBe('void');
    await expect(getQuote(cheap.token)).rejects.toMatchObject({ status: 410, code: 'quote_replaced' });
    await expect(acceptQuote(cheap.token, { name: 'Pat', consentSms: false, consentEmail: true } as never, null)).rejects.toMatchObject({ code: 'quote_replaced' });
    // The customer declines the new one, the office sends a third: the declined one can't be signed now either.
    await declineQuote(real.token, { reason: '' } as never);
    const third = await quote(8000);
    await expect(acceptQuote(real.token, { name: 'Pat', consentSms: false, consentEmail: true } as never, null)).rejects.toMatchObject({ code: 'quote_replaced' });
    expect(await statusOf(real.contract.id)).toBe('declined');
    expect((await acceptQuote(third.token, { name: 'Pat', consentSms: false, consentEmail: true } as never, null)).already).toBe(false);
    const accepted = await serviceDb().select().from(contract).where(and(eq(contract.site_id, siteId), eq(contract.season, '2027-28'), eq(contract.status, 'accepted')));
    expect(accepted.map((c) => (c.services as any[])[0].pricing.amount_cents)).toEqual([8000]);
  });

  it('a signed agreement still opens after a newer quote is sent, and a different season is left alone', async () => {
    const { acceptQuote, createQuote, getQuote } = await import('@/lib/quotes');
    const w = await makeWorld();
    const ctx = ctxOf(w);
    const siteId = w.siteIds[1]!;
    const q = (season: string) => createQuote(ctx, { site_id: siteId, season, services: [{ service: 'plow', trigger_in: 2, pricing: { type: 'per_push', amount_cents: 7000 } }], send: false });
    const signed = await q('2027-28');
    await acceptQuote(signed.token, { name: 'Pat', consentSms: false, consentEmail: true } as never, null);
    const nextSeason = await q('2028-29');
    await q('2027-28');
    expect((await getQuote(signed.token)).contract.status).toBe('accepted');
    expect((await getQuote(nextSeason.token)).contract.status).toBe('draft');
  });
});

describe('issue 116: the customer is told "payment received" only once the money arrived', () => {
  it('a bank debit sends no receipt while it is processing, one when it clears; a pay link paid after a declined card sends one too', async () => {
    const { customer, invoice_draft, sql } = await import('@flake/db');
    const { approveDrafts, generateDrafts, handleStripeEvent } = await import('@/lib/billing');
    const { closeStorm } = await import('@/lib/storms');
    const w = await makeWorld();
    const ctx = ctxOf(w);
    const db = serviceDb();
    const [bankSite, cardSite] = [w.siteIds[0]!, w.siteIds[1]!];
    await db.update(customer).set({ billing_mode: 'ach_on_file', stripe_payment_method_id: 'pm_mock_bank', stripe_customer_id: 'cus_mock_bank', email: 'bank@example.com' }).where(eq(customer.id, w.customerIds[0]!));
    await db.update(customer).set({ billing_mode: 'card_on_file', stripe_payment_method_id: 'pm_mock_0002', stripe_customer_id: 'cus_mock_card', email: 'card@example.com' }).where(eq(customer.id, w.customerIds[1]!));
    const out = await createStorm(ctx, { name: 'Receipts', routeIds: [w.routeId], crewAssignments: {}, siteIds: [bankSite, cardSite] });
    await publishStorm(ctx, out.storm.id);
    const r = await resolveToken(decryptToken(out.runs[0]!.link_token_enc!));
    const stops = await db.select().from(run_stop).where(eq(run_stop.storm_run_id, out.runs[0]!.id));
    for (const [i, s] of stops.entries()) await processActions(r, stopActions(s.id, new Date(Date.now() - 3600_000 + i * 1200_000), { depth: 3, gps: { lat: 41.48, lon: -81.8 }, minutes: 15 }).actions as never);
    await closeStorm(ctx, out.storm.id, true);
    await generateDrafts(ctx, out.storm.id);
    const rows = await db.select().from(invoice_draft).where(eq(invoice_draft.storm_id, out.storm.id));
    const bank = rows.find((d) => d.customer_id === w.customerIds[0])!;
    const card = rows.find((d) => d.customer_id === w.customerIds[1])!;
    await db.execute(sql`update invoice_draft set flags = coalesce((select jsonb_agg(f || '{"waived": true}'::jsonb) from jsonb_array_elements(flags) f), '[]'::jsonb) where storm_id = ${out.storm.id}`);
    await approveDrafts(ctx, [bank.id, card.id]);
    await drain();
    const receipts = async (to: string) => (await db.select().from(message_log).where(and(eq(message_log.tenant_id, w.tenantId), eq(message_log.template, 'receipt'), eq(message_log.to_addr, to))));
    const statusOf = async (id: string) => (await db.select().from(invoice_draft).where(eq(invoice_draft.id, id)))[0]!;

    expect(await statusOf(bank.id)).toMatchObject({ status: 'charged', status_detail: 'Bank payment processing' });
    expect(await receipts('bank@example.com')).toHaveLength(0);
    const cleared = (n: number, id: string) => handleStripeEvent({ id: `evt_${id}_${n}`, type: 'payment_intent.succeeded', data: { object: { id: `pi_${id}`, metadata: { draft_id: id, tenant_id: w.tenantId } } } });
    await cleared(1, bank.id);
    await cleared(2, bank.id);
    await drain();
    expect((await statusOf(bank.id)).status).toBe('paid');
    const got = await receipts('bank@example.com');
    expect(got).toHaveLength(1);
    expect(got[0]!.body).toContain('Payment received. Receipts');

    expect((await statusOf(card.id)).status).toBe('failed');
    expect(await receipts('card@example.com')).toHaveLength(0);
    await cleared(1, card.id);
    await drain();
    expect((await statusOf(card.id)).status).toBe('paid');
    expect(await receipts('card@example.com')).toHaveLength(1);
  });
});

describe('issue 117: refunds and dispute outcomes from Stripe show on the invoice', () => {
  it('a partial then full refund is written on the paid invoice, a won dispute clears, a lost one says so', async () => {
    const { invoice_draft, storm } = await import('@flake/db');
    const { handleStripeEvent } = await import('@/lib/billing');
    const w = await makeWorld();
    const db = serviceDb();
    const [s] = await db.insert(storm).values({ tenant_id: w.tenantId, name: 'Refunds', started_at: new Date().toISOString(), status: 'billed' }).returning();
    const draft = async (pi: string, inv: string | null, who: number) => (await db.insert(invoice_draft).values({ tenant_id: w.tenantId, storm_id: s!.id, customer_id: w.customerIds[who]!, lines: [], subtotal_cents: 6500, flags: [], status: 'paid', stripe_payment_intent_id: pi, stripe_invoice_id: inv }).returning())[0]!;
    const card = await draft(`pi_card_${w.tenantId}`, null, 0);
    const net30 = await draft(`pi_inv_${w.tenantId}`, `in_${w.tenantId}`, 1);
    const detail = async (id: string) => (await db.select().from(invoice_draft).where(eq(invoice_draft.id, id)))[0]!;
    let n = 0;
    const send = (type: string, object: Record<string, unknown>) => handleStripeEvent({ id: `evt_${w.tenantId}_${n++}`, type, data: { object } } as never);

    await send('charge.refunded', { payment_intent: card.stripe_payment_intent_id, amount: 6500, amount_refunded: 2000, refunded: false });
    expect((await detail(card.id)).status_detail).toBe('Refunded $20.00 of $65.00 in Stripe');
    await send('charge.refunded', { payment_intent: card.stripe_payment_intent_id, amount: 6500, amount_refunded: 6500, refunded: true });
    expect(await detail(card.id)).toMatchObject({ status: 'paid', status_detail: 'Refunded $65.00 in Stripe' });
    // A Stripe invoice's charge names the invoice; its payment intent isn't stored on a net-30 bill.
    await send('charge.refunded', { payment_intent: 'pi_unknown', invoice: net30.stripe_invoice_id, amount: 6500, amount_refunded: 6500, refunded: true });
    expect((await detail(net30.id)).status_detail).toBe('Refunded $65.00 in Stripe');

    await send('charge.dispute.created', { payment_intent: card.stripe_payment_intent_id });
    expect((await detail(card.id)).disputed).toBe(true);
    await send('charge.dispute.closed', { payment_intent: card.stripe_payment_intent_id, status: 'won' });
    expect((await detail(card.id)).disputed).toBe(false);
    await send('charge.dispute.created', { payment_intent: net30.stripe_payment_intent_id });
    await send('charge.dispute.closed', { payment_intent: net30.stripe_payment_intent_id, status: 'lost' });
    expect(await detail(net30.id)).toMatchObject({ disputed: true, status_detail: 'Dispute lost: the customer kept the payment' });
  });
});
