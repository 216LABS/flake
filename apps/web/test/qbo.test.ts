import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { closeDb, customer, eq, installment_invoice, integration, invoice_draft, serviceDb, sql, storm } from '@flake/db';
import { mockQbo, signMockQbo } from '@flake/providers';
import { createStorm, ctxOf, drain, makeWorld, req, type World } from './helpers';

afterAll(async () => {
  await drain();
  await serviceDb().execute(sql`update job set done_at = now() where done_at is null and dead_at is null`);
  await closeDb();
});

async function connect(w: World) {
  const { encryptToken } = await import('@/lib/tokens');
  const realm = `mock-${randomUUID().slice(0, 8)}`;
  await serviceDb().insert(integration).values({ tenant_id: w.tenantId, provider: 'qbo', realm_id: realm, token_enc: encryptToken('mock-access'), refresh_enc: encryptToken('mock-refresh'), expires_at: new Date(Date.now() + 3_600_000).toISOString(), status: 'connected', connected_by: w.userId });
  return realm;
}

/** Two closed-storm bills in review: one for a card customer, one for a net-30 customer. */
async function billsInReview(w: World) {
  const out = await createStorm(ctxOf(w), { name: 'QBO storm', routeIds: [w.routeId], crewAssignments: {} });
  await serviceDb().update(storm).set({ status: 'closed', closed_at: new Date('2026-12-02T15:00:00Z').toISOString() }).where(eq(storm.id, out.storm.id));
  const line = (cents: number) => [{ service: 'plow', description: 'Plow, Dec 2', quantity: 1, unit_amount_cents: cents, amount_cents: cents }, { service: 'salt', description: 'Salt, 2 bags', quantity: 2, unit_amount_cents: 1500, amount_cents: 3000 }];
  const [card] = await serviceDb().insert(invoice_draft).values({ tenant_id: w.tenantId, storm_id: out.storm.id, customer_id: w.customerIds[0]!, lines: line(6500), subtotal_cents: 9500 }).returning();
  const [net] = await serviceDb().insert(invoice_draft).values({ tenant_id: w.tenantId, storm_id: out.storm.id, customer_id: w.customerIds[2]!, lines: line(30000), subtotal_cents: 33000 }).returning();
  return { stormId: out.storm.id, card: card!, net: net! };
}

const draft = async (id: string) => (await serviceDb().select().from(invoice_draft).where(eq(invoice_draft.id, id)))[0]!;

describe('issue 162: QuickBooks Online sync', () => {
  it('matches customers, pushes approved bills once, takes payments both ways, and flags edits made in QuickBooks', async () => {
    const auth = await import('@/lib/auth');
    const { approveDrafts, reviseDraft } = await import('@/lib/billing');
    const { pollQboPayments, qboOverview } = await import('@/lib/qbo');
    const w = await makeWorld();
    const realm = await connect(w);
    const co = mockQbo(realm);
    // One QuickBooks customer matches by name, one by email; the third is made new.
    await serviceDb().update(customer).set({ name: 'Lakewood Medical Center' }).where(eq(customer.id, w.customerIds[0]!));
    co.customers.push({ id: '50', name: 'Hilltop Offices LLC', email: 'billing-hill@example.com' });
    // Billed by hand (no Stripe invoice), so a check recorded in QuickBooks is the payment.
    await serviceDb().update(customer).set({ email: 'billing-hill@example.com', billing_mode: 'manual' }).where(eq(customer.id, w.customerIds[2]!));

    const view = await qboOverview(w.tenantId);
    expect(JSON.stringify(view)).not.toMatch(/mock-access|mock-refresh|token_enc|refresh_enc/);
    const sug = new Map(view.customers.map((c) => [c.id, c.suggested]));
    expect(sug.get(w.customerIds[0]!)).toEqual({ qboId: '2', by: 'name' });
    expect(sug.get(w.customerIds[2]!)).toEqual({ qboId: '50', by: 'email' });

    // Approve before anything is matched: the bills wait with a reason, nothing goes to QuickBooks.
    const { card, net } = await billsInReview(w);
    await approveDrafts(ctxOf(w), [card.id, net.id]);
    await drain();
    expect((await draft(net.id)).qbo_error).toMatch(/Match Customer 2 to a QuickBooks customer/);
    expect(co.invoices.size).toBe(0);

    const spy = vi.spyOn(auth, 'requireApi').mockResolvedValue({ userId: w.userId, tenantId: w.tenantId, role: 'owner' } as never);
    const { POST: match } = await import('@/app/api/integrations/qbo/match/route');
    const { POST: itemsPost } = await import('@/app/api/integrations/qbo/items/route');
    const post = (h: typeof match, url: string, body: unknown) => h(req(url, { method: 'POST', body: JSON.stringify(body) }), {} as never);
    expect((await post(match, '/api/integrations/qbo/match', { matches: [{ customer_id: w.customerIds[0]!, qbo: '2' }, { customer_id: w.customerIds[2]!, qbo: '50' }, { customer_id: w.customerIds[1]!, qbo: 'new' }] })).status).toBe(200);
    expect(co.customers.some((c) => c.name === 'Customer 1')).toBe(true);
    await drain();
    // Matched, but no items picked yet.
    expect((await draft(net.id)).qbo_error).toMatch(/Pick a QuickBooks item for plow, salt/);
    expect((await post(itemsPost, '/api/integrations/qbo/items', { map: { plow: '10', salt: '11', seasonal: '14', other: '15' } })).status).toBe(200);
    await drain();
    spy.mockRestore();

    const n = await draft(net.id);
    expect(n.qbo_error).toBeNull();
    expect(n.qbo_invoice_id).toBeTruthy();
    const inv = co.invoices.get(n.qbo_invoice_id!)!;
    expect(inv.input).toMatchObject({ customerId: '50', docNumber: `F-${net.id.slice(0, 8)}`, txnDate: '2026-12-02', dueDate: '2027-01-01', memo: 'Snow service: QBO storm' });
    expect(inv.input.lines.map((l) => [l.itemId, l.amountCents])).toEqual([['10', 30000], ['11', 3000]]);
    expect(inv.totalCents).toBe(33000);

    // The card customer was charged through Flake: the payment is in QuickBooks too, nothing owing there.
    const c = await draft(card.id);
    expect(c.status).toBe('paid');
    expect(co.invoices.get(c.qbo_invoice_id!)!.balanceCents).toBe(0);

    // Pushing again, or a retried job, never makes a second invoice.
    const before = co.invoices.size;
    const { pushToQbo } = await import('@/lib/qbo');
    await pushToQbo({ tenantId: w.tenantId, kind: 'draft', id: net.id });
    await serviceDb().update(invoice_draft).set({ qbo_invoice_id: null }).where(eq(invoice_draft.id, net.id));
    await pushToQbo({ tenantId: w.tenantId, kind: 'draft', id: net.id });
    expect(co.invoices.size).toBe(before);

    // A check recorded in QuickBooks: the next poll marks the Flake bill paid.
    const { MockAccounting } = await import('@flake/providers');
    await new MockAccounting('http://x').createPayment({ access: 'x', realmId: realm }, { customerId: '50', invoiceId: n.qbo_invoice_id!, amountCents: 13000, txnDate: '2026-12-10', ref: 'chk' }, 'part');
    await pollQboPayments(w.tenantId);
    expect(await draft(net.id)).toMatchObject({ status: 'approved', status_detail: 'Part paid in QuickBooks: $200.00 left.' });
    await new MockAccounting('http://x').createPayment({ access: 'x', realmId: realm }, { customerId: '50', invoiceId: n.qbo_invoice_id!, amountCents: 20000, txnDate: '2026-12-11', ref: 'chk2' }, 'rest');
    await pollQboPayments(w.tenantId);
    expect(await draft(net.id)).toMatchObject({ status: 'paid', status_detail: 'Paid in QuickBooks' });

    // Paid there while a Stripe invoice is still open here: flagged, not marked paid twice.
    await serviceDb().update(customer).set({ qbo_customer_id: '50' }).where(eq(customer.id, w.customerIds[3]!));
    const [open] = await serviceDb().insert(invoice_draft).values({ tenant_id: w.tenantId, storm_id: n.storm_id, customer_id: w.customerIds[3]!, lines: [{ service: 'plow', description: 'Plow', quantity: 1, unit_amount_cents: 1000, amount_cents: 1000 }], subtotal_cents: 1000, status: 'approved' }).returning();
    await pushToQbo({ tenantId: w.tenantId, kind: 'draft', id: open!.id });
    await serviceDb().update(invoice_draft).set({ status: 'sent' }).where(eq(invoice_draft.id, open!.id));
    const o = await draft(open!.id);
    await new MockAccounting('http://x').createPayment({ access: 'x', realmId: realm }, { customerId: '50', invoiceId: o.qbo_invoice_id!, amountCents: 1000, txnDate: '2026-12-11', ref: 'chk3' }, 'open');
    await pollQboPayments(w.tenantId);
    expect(await draft(open!.id)).toMatchObject({ status: 'sent', qbo_error: expect.stringMatching(/still open here/) });

    // Edited in QuickBooks after the push: flagged here, never overwritten.
    const [third] = await serviceDb().insert(invoice_draft).values({ tenant_id: w.tenantId, storm_id: n.storm_id, customer_id: w.customerIds[1]!, lines: [{ service: 'plow', description: 'Plow', quantity: 1, unit_amount_cents: 30000, amount_cents: 30000 }], subtotal_cents: 30000, status: 'approved' }).returning();
    await pushToQbo({ tenantId: w.tenantId, kind: 'draft', id: third!.id });
    const t3 = await draft(third!.id);
    co.invoices.get(t3.qbo_invoice_id!)!.totalCents = 25000;
    await pollQboPayments(w.tenantId);
    expect((await draft(third!.id)).qbo_error).toMatch(/Changed in QuickBooks: it totals \$250.00 there and \$300.00 here/);
    expect(co.invoices.get(t3.qbo_invoice_id!)!.totalCents).toBe(25000);

    // Voiding a pushed bill asks for the same in QuickBooks; nothing is voided there by itself.
    await serviceDb().update(invoice_draft).set({ qbo_error: null }).where(eq(invoice_draft.id, third!.id));
    await reviseDraft(ctxOf(w), third!.id, 'void');
    expect((await draft(third!.id)).qbo_error).toBe(`Voided in Flake: void invoice F-${third!.id.slice(0, 8)} in QuickBooks too.`);
  });

  it('a seasonal installment goes to QuickBooks for that month, and disconnecting stops all syncing', async () => {
    const { billInstallments } = await import('@/lib/billing');
    const w = await makeWorld({ connected: false });
    const realm = await connect(w);
    const co = mockQbo(realm);
    await serviceDb().update(customer).set({ qbo_customer_id: '1' }).where(eq(customer.tenant_id, w.tenantId));
    const { qbo_item_map } = await import('@flake/db');
    await serviceDb().insert(qbo_item_map).values({ tenant_id: w.tenantId, flake_key: 'seasonal', qbo_item_id: '14' });
    expect(await billInstallments(w.tenantId, new Date('2026-11-15T15:00:00Z'))).toBe(1);
    await drain();
    const [inst] = await serviceDb().select().from(installment_invoice).where(eq(installment_invoice.tenant_id, w.tenantId));
    expect(inst!.qbo_invoice_id).toBeTruthy();
    const there = co.invoices.get(inst!.qbo_invoice_id!)!;
    expect(there.totalCents).toBe(inst!.amount_cents);
    expect(there.input.lines[0]).toMatchObject({ itemId: '14', amountCents: inst!.amount_cents });
    expect(there.input.memo).toContain('installment 1 (2026-11)');

    // Paid in QuickBooks: the installment shows paid.
    await new (await import('@flake/providers')).MockAccounting('http://x').createPayment({ access: 'x', realmId: realm }, { customerId: '1', invoiceId: inst!.qbo_invoice_id!, amountCents: inst!.amount_cents, txnDate: '2026-11-20', ref: 'x' }, `pay-${inst!.id}`);
    const { pollQboPayments } = await import('@/lib/qbo');
    await pollQboPayments(w.tenantId);
    expect((await serviceDb().select().from(installment_invoice).where(eq(installment_invoice.id, inst!.id)))[0]!.status).toBe('paid');

    // Disconnect: tokens and matches are gone, and the next installment isn't pushed.
    const auth = await import('@/lib/auth');
    const spy = vi.spyOn(auth, 'requireApi').mockResolvedValue({ userId: w.userId, tenantId: w.tenantId, role: 'owner' } as never);
    const { DELETE } = await import('@/app/api/integrations/qbo/route');
    expect((await DELETE(req('/api/integrations/qbo', { method: 'DELETE' }), {} as never)).status).toBe(200);
    spy.mockRestore();
    const [conn] = await serviceDb().select().from(integration).where(eq(integration.tenant_id, w.tenantId));
    expect(conn).toMatchObject({ status: 'disconnected', token_enc: null, refresh_enc: null });
    const size = co.invoices.size;
    expect(await billInstallments(w.tenantId, new Date('2026-12-15T15:00:00Z'))).toBe(1);
    await drain();
    expect(co.invoices.size).toBe(size);
  });

  it('only a signed webhook is read, and only owners connect or match', async () => {
    const w = await makeWorld();
    const realm = await connect(w);
    const { POST } = await import('@/app/api/webhooks/qbo/route');
    const body = JSON.stringify({ eventNotifications: [{ realmId: realm, dataChangeEvent: { entities: [{ name: 'Payment', id: '1', operation: 'Create' }] } }] });
    expect((await POST(req('/api/webhooks/qbo', { method: 'POST', body, headers: { 'intuit-signature': 'bad' } }), {} as never)).status).toBe(401);
    expect((await POST(req('/api/webhooks/qbo', { method: 'POST', body, headers: { 'intuit-signature': signMockQbo(body) } }), {} as never)).status).toBe(200);
    const jobs = await serviceDb().execute(sql`select 1 from job where kind = 'qbo.poll' and payload->>'tenantId' = ${w.tenantId}`);
    expect(jobs.length).toBe(1);

    // A viewer or dispatcher can't connect or change matches.
    const auth = await import('@/lib/auth');
    const real = auth.requireApi;
    const spy = vi.spyOn(auth, 'requireApi').mockImplementation(async (min) => {
      if (min === 'owner') throw Object.assign(new (await import('@/lib/http')).HttpError(403, 'Your role cannot do this'));
      return { userId: w.viewerId, tenantId: w.tenantId, role: 'viewer' } as never;
    });
    const { GET: connectGet } = await import('@/app/api/integrations/qbo/connect/route');
    expect((await connectGet(req('/api/integrations/qbo/connect'), {} as never)).status).toBe(403);
    const { POST: match } = await import('@/app/api/integrations/qbo/match/route');
    expect((await match(req('/x', { method: 'POST', body: JSON.stringify({ matches: [{ customer_id: w.customerIds[0]!, qbo: '1' }] }) }), {} as never)).status).toBe(403);
    spy.mockRestore();
    expect(real).toBeTypeOf('function');
    // Browsers can never read the connection row, even their own company's.
    const { withUser } = await import('@flake/db');
    await expect(withUser(w.userId, (tx) => tx.select().from(integration))).rejects.toThrow();
  });
});
