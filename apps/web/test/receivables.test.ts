import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, contract, customer, eq, installment_invoice, invoice_draft, payment, serviceDb, site, sql, storm, withUser } from '@flake/db';
import { createStorm, ctxOf, drain, makeWorld } from './helpers';

afterAll(async () => {
  await drain();
  await serviceDb().execute(sql`update job set done_at = now() where done_at is null and dead_at is null`);
  await closeDb();
});

const TZ = 'America/New_York';

describe('issue 168: receivables', () => {
  it('ages open bills, takes part and full payments, refuses overpaying, voids, and the statement adds up', async () => {
    const { openBills, recordPayment, voidPayment, customerStatement } = await import('@/lib/receivables');
    const w = await makeWorld();
    const out = await createStorm(ctxOf(w), { name: 'Dec 2 storm', routeIds: [w.routeId], crewAssignments: {} });
    await serviceDb().update(storm).set({ status: 'closed', closed_at: '2026-12-02T15:00:00Z' }).where(eq(storm.id, out.storm.id));
    // Customer 2 is net 30: due Jan 1. Customer 0 pays on receipt: due Dec 2.
    const lines = [{ service: 'plow', description: 'Plow', quantity: 1, unit_amount_cents: 33000, amount_cents: 33000 }];
    const [net] = await serviceDb().insert(invoice_draft).values({ tenant_id: w.tenantId, storm_id: out.storm.id, customer_id: w.customerIds[2]!, lines, subtotal_cents: 33000, status: 'approved' }).returning();
    const [card] = await serviceDb().insert(invoice_draft).values({ tenant_id: w.tenantId, storm_id: out.storm.id, customer_id: w.customerIds[0]!, lines, subtotal_cents: 33000, status: 'failed' }).returning();
    await serviceDb().insert(invoice_draft).values({ tenant_id: w.tenantId, storm_id: out.storm.id, customer_id: w.customerIds[1]!, lines, subtotal_cents: 33000, status: 'draft' });
    const [k] = await serviceDb().select({ id: contract.id }).from(contract).innerJoin(site, eq(site.id, contract.site_id)).where(eq(site.customer_id, w.customerIds[3]!));
    const [inst] = await serviceDb().insert(installment_invoice).values({ tenant_id: w.tenantId, contract_id: k!.id, seq: 1, amount_cents: 60000, status: 'manual', period: '2026-11', created_at: '2026-11-15T15:00:00Z' }).returning();

    const bills = (today: string) => withUser(w.userId, (tx) => openBills(tx, TZ, today));
    const jan15 = await bills('2027-01-15');
    // A draft still in review isn't owed yet.
    expect(jan15.map((r) => r.id).sort()).toEqual([net!.id, card!.id, inst!.id].sort());
    expect(jan15.find((r) => r.id === net!.id)).toMatchObject({ due_on: '2027-01-01', days_late: 14, bucket: '1-30' });
    expect(jan15.find((r) => r.id === card!.id)).toMatchObject({ due_on: '2026-12-02', days_late: 44, bucket: '31-60' });
    expect(jan15.find((r) => r.id === inst!.id)).toMatchObject({ due_on: '2026-12-15', days_late: 31, bucket: '31-60' });

    const pay = (amount: number, ref: string, id = net!.id, kind: 'draft' | 'installment' = 'draft') => withUser(w.userId, (tx) => recordPayment(tx, w.tenantId, w.userId, { kind, id, amount_cents: amount, method: 'check', reference: ref, paid_on: '2027-01-10' }));
    // A part payment leaves it open.
    expect((await pay(13000, '101')).balance_cents).toBe(20000);
    expect((await serviceDb().select().from(invoice_draft).where(eq(invoice_draft.id, net!.id)))[0]!.status).toBe('approved');
    expect((await bills('2027-01-15')).find((r) => r.id === net!.id)).toMatchObject({ paid_cents: 13000, balance_cents: 20000 });
    // More than is left is refused.
    await expect(pay(20001, '102')).rejects.toMatchObject({ code: 'overpaid' });
    // The rest pays it off.
    const last = await pay(20000, '102');
    expect(last.paid_in_full).toBe(true);
    expect((await serviceDb().select().from(invoice_draft).where(eq(invoice_draft.id, net!.id)))[0]!.status).toBe('paid');
    expect((await bills('2027-01-15')).some((r) => r.id === net!.id)).toBe(false);
    // Voiding the payment that paid it off opens it again.
    await withUser(w.userId, (tx) => voidPayment(tx, w.tenantId, last.payment.id, 'entered twice'));
    expect((await serviceDb().select().from(invoice_draft).where(eq(invoice_draft.id, net!.id)))[0]!.status).toBe('approved');
    expect((await bills('2027-01-15')).find((r) => r.id === net!.id)!.balance_cents).toBe(20000);
    // The installment, in full.
    await pay(60000, '103', inst!.id, 'installment');
    expect((await serviceDb().select().from(installment_invoice).where(eq(installment_invoice.id, inst!.id)))[0]!.status).toBe('paid');

    // Customer 2's statement for January: opening $330 (December's bill), the $130 check, closing $200.
    const s = await withUser(w.userId, (tx) => customerStatement(tx, TZ, w.customerIds[2]!, '2027-01-01', '2027-01-31'));
    expect(s.opening).toBe(33000);
    expect(s.lines.map((l) => [l.kind, l.cents])).toEqual([['payment', 13000]]);
    expect(s.closing).toBe(20000);

    // A viewer can't record a payment; another company can't touch these bills.
    await expect(withUser(w.viewerId, (tx) => recordPayment(tx, w.tenantId, w.viewerId, { kind: 'draft', id: card!.id, amount_cents: 100, method: 'cash', paid_on: '2027-01-10' }))).rejects.toThrow();
    const other = await makeWorld();
    await expect(withUser(other.userId, (tx) => recordPayment(tx, other.tenantId, other.userId, { kind: 'draft', id: card!.id, amount_cents: 100, method: 'cash', paid_on: '2027-01-10' }))).rejects.toMatchObject({ status: 404 });
    expect((await serviceDb().select().from(payment).where(eq(payment.draft_id, card!.id))).length).toBe(0);
    expect((await serviceDb().select().from(customer).where(eq(customer.id, w.customerIds[2]!))).length).toBe(1);
  });
});
