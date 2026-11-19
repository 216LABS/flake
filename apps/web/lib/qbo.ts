import { QBO_KEYS, qboKeyFor, suggestQboMatches, type QboKey } from '@flake/core/qbo';
import { and, contract, customer, eq, inArray, installment_invoice, integration, invoice_draft, isNotNull, qbo_item_map, serviceDb, site, storm, tenant } from '@flake/db';
import type { QboAuth } from '@flake/providers';
import { enqueue } from './jobs';
import { log } from './log';
import { getProviders } from './providers';
import { decryptToken, encryptToken } from './tokens';

/**
 * QuickBooks Online sync (issue 162). Decisions (Nov 19):
 * - A bill goes to QuickBooks when it is approved; a seasonal installment when it is billed.
 * - Flake owns the invoice, QuickBooks owns payments. A payment recorded in QuickBooks marks the Flake bill paid. A card
 *   or bank payment taken through Flake is posted to QuickBooks against that invoice. A bill the office marks paid by
 *   hand in Flake is not posted: that money was taken outside both, and the bookkeeper records it where it landed.
 * - An invoice changed or deleted in QuickBooks after the push is never overwritten: it is flagged for the owner.
 * - Voiding a pushed bill in Flake flags it so the owner voids it in QuickBooks too. Nothing is voided there silently.
 * Every job here is safe to run twice: Intuit's requestid returns the same invoice or payment on a retry.
 */

export const CHANGED_IN_QBO = 'Changed in QuickBooks';

/** A fresh access token for this company, or null when QuickBooks isn't connected. Refreshes when near expiry. */
export async function qboAuth(tenantId: string): Promise<QboAuth | null> {
  const db = serviceDb();
  const [row] = await db.select().from(integration).where(and(eq(integration.tenant_id, tenantId), eq(integration.provider, 'qbo'), eq(integration.status, 'connected')));
  if (!row?.token_enc || !row.refresh_enc || !row.realm_id) return null;
  if (row.expires_at && Date.parse(row.expires_at) - Date.now() > 5 * 60_000) return { access: decryptToken(row.token_enc), realmId: row.realm_id };
  const { accounting } = await getProviders();
  try {
    const t = await accounting.refresh(decryptToken(row.refresh_enc), row.realm_id);
    await db.update(integration).set({ token_enc: encryptToken(t.access), refresh_enc: encryptToken(t.refresh), expires_at: t.expiresAt, updated_at: new Date().toISOString() }).where(eq(integration.id, row.id));
    return { access: t.access, realmId: row.realm_id };
  } catch (err) {
    // A refresh token lasts 100 days, and a revoked app loses it at once. Either way the owner reconnects.
    log.error('quickbooks refresh failed', err, { tenantId });
    await db.update(integration).set({ status: 'error', status_detail: 'QuickBooks sign-in expired. Connect again in Settings, Accounting.', updated_at: new Date().toISOString() }).where(eq(integration.id, row.id));
    return null;
  }
}

export async function qboConnected(tenantId: string): Promise<boolean> {
  const [row] = await serviceDb().select({ id: integration.id }).from(integration).where(and(eq(integration.tenant_id, tenantId), eq(integration.provider, 'qbo'), eq(integration.status, 'connected')));
  return Boolean(row);
}

/** Queues the push of a bill (or installment) when this company has QuickBooks connected. */
export async function queueQboPush(tenantId: string, kind: 'draft' | 'installment', id: string) {
  if (!(await qboConnected(tenantId))) return;
  await enqueue('qbo.push', { tenantId, kind, id }, { dedupeKey: `qbo:${kind}:${id}` });
}

/** A bill paid through Flake goes to QuickBooks as a payment against its invoice. */
export async function queueQboPayment(tenantId: string, draftId: string) {
  if (!(await qboConnected(tenantId))) return;
  await enqueue('qbo.payment', { tenantId, draftId }, { dedupeKey: `qbo:pay:${draftId}` });
}

async function itemMap(tenantId: string): Promise<Map<QboKey, string>> {
  const rows = await serviceDb().select().from(qbo_item_map).where(eq(qbo_item_map.tenant_id, tenantId));
  return new Map(rows.map((r) => [r.flake_key as QboKey, r.qbo_item_id]));
}

/** The local calendar date, YYYY-MM-DD, as QuickBooks wants it. */
const ymd = (iso: string | Date, tz: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: tz });

type Line = { service: string; description: string; quantity: number; unit_amount_cents: number; amount_cents: number };

/** qbo.push: one bill or installment to QuickBooks, or a clear reason it can't go yet. */
export async function pushToQbo(p: { tenantId: string; kind: 'draft' | 'installment'; id: string }) {
  const auth = await qboAuth(p.tenantId);
  if (!auth) return;
  const db = serviceDb();
  const { accounting } = await getProviders();
  const [t] = await db.select({ timezone: tenant.timezone }).from(tenant).where(eq(tenant.id, p.tenantId));
  const tz = t?.timezone ?? 'America/New_York';
  const items = await itemMap(p.tenantId);
  const table = p.kind === 'draft' ? invoice_draft : installment_invoice;
  const setState = (v: Partial<{ qbo_invoice_id: string; qbo_sync_token: string; qbo_synced_at: string; qbo_error: string | null }>) =>
    db.update(table).set(v).where(and(eq(table.id, p.id), eq(table.tenant_id, p.tenantId)));

  let cust: typeof customer.$inferSelect;
  let input: { docNumber: string; txnDate: string; dueDate: string; memo: string; lines: { key: QboKey; description: string; qty: number; rateCents: number; amountCents: number }[] };
  let already: string | null;
  let paidInFlake: { cents: number; ref: string } | null = null;
  if (p.kind === 'draft') {
    const [row] = await db.select({ d: invoice_draft, c: customer, s: storm }).from(invoice_draft).innerJoin(customer, eq(customer.id, invoice_draft.customer_id)).innerJoin(storm, eq(storm.id, invoice_draft.storm_id)).where(and(eq(invoice_draft.id, p.id), eq(invoice_draft.tenant_id, p.tenantId)));
    if (!row || !['approved', 'charged', 'sent', 'paid', 'failed'].includes(row.d.status ?? '')) return;
    cust = row.c;
    already = row.d.qbo_invoice_id;
    const when = row.s.closed_at ?? row.s.started_at;
    const onFile = row.c.billing_mode === 'card_on_file' || row.c.billing_mode === 'ach_on_file';
    input = {
      docNumber: `F-${row.d.id.slice(0, 8)}`,
      txnDate: ymd(when, tz),
      dueDate: ymd(new Date(Date.parse(when) + (onFile ? 0 : 30 * 86_400_000)), tz),
      memo: `Snow service: ${row.s.name}`,
      lines: (row.d.lines as Line[]).map((l) => ({ key: qboKeyFor(l.service), description: l.description, qty: l.quantity, rateCents: l.unit_amount_cents, amountCents: l.amount_cents })),
    };
    // Paid through Flake (Stripe) before it reached QuickBooks: post that payment too, so the books don't show it owing.
    if (row.d.status === 'paid' && row.d.stripe_payment_intent_id) paidInFlake = { cents: row.d.subtotal_cents, ref: 'Flake card' };
  } else {
    const [row] = await db.select({ i: installment_invoice, c: customer, k: contract, s: site }).from(installment_invoice).innerJoin(contract, eq(contract.id, installment_invoice.contract_id)).innerJoin(site, eq(site.id, contract.site_id)).innerJoin(customer, eq(customer.id, site.customer_id)).where(and(eq(installment_invoice.id, p.id), eq(installment_invoice.tenant_id, p.tenantId)));
    if (!row || ['pending', 'void'].includes(row.i.status)) return;
    cust = row.c;
    already = row.i.qbo_invoice_id;
    const when = row.i.created_at ?? new Date().toISOString();
    input = {
      docNumber: `F-I${row.i.id.slice(0, 7)}`,
      txnDate: ymd(when, tz),
      dueDate: ymd(new Date(Date.parse(when) + 30 * 86_400_000), tz),
      memo: `Seasonal snow service ${row.k.season ?? ''}, installment ${row.i.seq}${row.i.period ? ` (${row.i.period})` : ''}: ${row.s.label}`.replace(/\s+/g, ' '),
      lines: [{ key: 'seasonal', description: `Installment ${row.i.seq}: ${row.s.label}`, qty: 1, rateCents: row.i.amount_cents, amountCents: row.i.amount_cents }],
    };
  }

  try {
    if (already) {
      // Pushed before: never again, and never over an edit made in QuickBooks.
      const there = await accounting.getInvoice(auth, already);
      const total = input.lines.reduce((s, l) => s + l.amountCents, 0);
      if (!there) await setState({ qbo_error: `${CHANGED_IN_QBO}: this invoice was deleted there.` });
      else if (there.totalCents !== total) await setState({ qbo_error: `${CHANGED_IN_QBO}: it totals $${(there.totalCents / 100).toFixed(2)} there and $${(total / 100).toFixed(2)} here. Fix one so they agree.` });
      return;
    }
    if (!cust.qbo_customer_id) return void (await setState({ qbo_error: `Match ${cust.name} to a QuickBooks customer in Settings, Accounting.` }));
    const missing = [...new Set(input.lines.map((l) => l.key).filter((k) => !items.get(k)))];
    if (missing.length) return void (await setState({ qbo_error: `Pick a QuickBooks item for ${missing.join(', ')} in Settings, Accounting.` }));
    const made = await accounting.createInvoice(auth, { customerId: cust.qbo_customer_id, docNumber: input.docNumber, txnDate: input.txnDate, dueDate: input.dueDate, memo: input.memo, lines: input.lines.map((l) => ({ itemId: items.get(l.key)!, description: l.description, qty: l.qty, rateCents: l.rateCents, amountCents: l.amountCents })) }, `flake-${p.kind}-${p.id}`);
    await setState({ qbo_invoice_id: made.id, qbo_sync_token: made.syncToken, qbo_synced_at: new Date().toISOString(), qbo_error: null });
    if (paidInFlake) await accounting.createPayment(auth, { customerId: cust.qbo_customer_id, invoiceId: made.id, amountCents: paidInFlake.cents, txnDate: ymd(new Date(), tz), ref: paidInFlake.ref }, `flake-pay-${p.id}`);
  } catch (err) {
    log.error('quickbooks push failed', err, { tenantId: p.tenantId, kind: p.kind, id: p.id });
    await setState({ qbo_error: `QuickBooks didn't take it: ${(err as Error).message.slice(0, 300)}` });
    throw err;
  }
}

/** qbo.payment: a bill paid through Flake (Stripe) is posted against its QuickBooks invoice. */
export async function postPaymentToQbo(p: { tenantId: string; draftId: string }) {
  const auth = await qboAuth(p.tenantId);
  if (!auth) return;
  const db = serviceDb();
  const [row] = await db.select({ d: invoice_draft, c: customer, tz: tenant.timezone }).from(invoice_draft).innerJoin(customer, eq(customer.id, invoice_draft.customer_id)).innerJoin(tenant, eq(tenant.id, invoice_draft.tenant_id)).where(and(eq(invoice_draft.id, p.draftId), eq(invoice_draft.tenant_id, p.tenantId)));
  if (!row || row.d.status !== 'paid') return;
  // Not in QuickBooks yet: the push posts the payment along with the invoice.
  if (!row.d.qbo_invoice_id || !row.c.qbo_customer_id) return void (await queueQboPush(p.tenantId, 'draft', p.draftId));
  const { accounting } = await getProviders();
  const there = await accounting.getInvoice(auth, row.d.qbo_invoice_id);
  if (!there || there.balanceCents <= 0) return;
  await accounting.createPayment(auth, { customerId: row.c.qbo_customer_id, invoiceId: row.d.qbo_invoice_id, amountCents: Math.min(there.balanceCents, row.d.subtotal_cents), txnDate: ymd(new Date(), row.tz), ref: 'Flake card' }, `flake-pay-${p.draftId}`);
}

/**
 * qbo.poll: payments recorded in QuickBooks come back. An invoice with nothing left owing marks the Flake bill or
 * installment paid; part paid says how much is left. Runs from Intuit's webhook and once a night as a safety net.
 */
export async function pollQboPayments(tenantId?: string) {
  const db = serviceDb();
  const tenants = tenantId ? [tenantId] : (await db.select({ id: integration.tenant_id }).from(integration).where(and(eq(integration.provider, 'qbo'), eq(integration.status, 'connected')))).map((r) => r.id);
  const { accounting } = await getProviders();
  let paid = 0;
  for (const tid of tenants) {
    const auth = await qboAuth(tid);
    if (!auth) continue;
    const drafts = await db.select().from(invoice_draft).where(and(eq(invoice_draft.tenant_id, tid), isNotNull(invoice_draft.qbo_invoice_id), inArray(invoice_draft.status, ['approved', 'charged', 'sent', 'failed'])));
    for (const d of drafts) {
      const there = await accounting.getInvoice(auth, d.qbo_invoice_id!);
      if (!there) { await db.update(invoice_draft).set({ qbo_error: `${CHANGED_IN_QBO}: this invoice was deleted there.` }).where(eq(invoice_draft.id, d.id)); continue; }
      if (there.totalCents !== d.subtotal_cents) { await db.update(invoice_draft).set({ qbo_error: `${CHANGED_IN_QBO}: it totals $${(there.totalCents / 100).toFixed(2)} there and $${(d.subtotal_cents / 100).toFixed(2)} here. Fix one so they agree.` }).where(eq(invoice_draft.id, d.id)); continue; }
      const collecting = d.status === 'sent' || d.status === 'charged';
      if (there.balanceCents <= 0 && collecting) {
        // A Stripe invoice or charge is still open for this bill here: marking it paid would leave the customer able to
        // pay twice. The office checks and closes one of them.
        await db.update(invoice_draft).set({ qbo_error: 'Paid in QuickBooks while the emailed invoice or card charge is still open here. Close one so it is not paid twice.' }).where(eq(invoice_draft.id, d.id));
      } else if (there.balanceCents <= 0) {
        const took = await db.update(invoice_draft).set({ status: 'paid', status_detail: 'Paid in QuickBooks' }).where(and(eq(invoice_draft.id, d.id), inArray(invoice_draft.status, ['approved', 'failed']))).returning({ id: invoice_draft.id });
        paid += took.length;
      } else if (there.balanceCents < there.totalCents && !collecting) {
        await db.update(invoice_draft).set({ status_detail: `Part paid in QuickBooks: $${(there.balanceCents / 100).toFixed(2)} left.` }).where(eq(invoice_draft.id, d.id));
      }
    }
    const inst = await db.select().from(installment_invoice).where(and(eq(installment_invoice.tenant_id, tid), isNotNull(installment_invoice.qbo_invoice_id), inArray(installment_invoice.status, ['manual', 'sent', 'failed'])));
    for (const i of inst) {
      const there = await accounting.getInvoice(auth, i.qbo_invoice_id!);
      if (there && there.balanceCents <= 0 && there.totalCents > 0) {
        await db.update(installment_invoice).set({ status: 'paid' }).where(eq(installment_invoice.id, i.id));
        paid++;
      }
    }
  }
  return { paid };
}

/** What Settings, Accounting shows: the connection, customers with suggested matches, the item map, sync problems. */
export async function qboOverview(tenantId: string) {
  const db = serviceDb();
  const { accounting } = await getProviders();
  const [conn] = await db.select({ status: integration.status, status_detail: integration.status_detail, realm_id: integration.realm_id, created_at: integration.created_at }).from(integration).where(and(eq(integration.tenant_id, tenantId), eq(integration.provider, 'qbo')));
  const base = { configured: accounting.configured, mock: accounting.isMock, connection: conn ?? null };
  if (!conn || conn.status !== 'connected') return { ...base, customers: [], qboCustomers: [], items: [], map: {}, problems: [] };
  const auth = await qboAuth(tenantId);
  if (!auth) return { ...base, connection: { ...conn, status: 'error' as const }, customers: [], qboCustomers: [], items: [], map: {}, problems: [] };
  const [qboCustomers, items] = await Promise.all([accounting.listCustomers(auth), accounting.listItems(auth)]);
  const mine = await db.select({ id: customer.id, name: customer.name, email: customer.email, qbo_customer_id: customer.qbo_customer_id }).from(customer).where(and(eq(customer.tenant_id, tenantId))).orderBy(customer.name);
  const suggested = suggestQboMatches(mine.filter((c) => !c.qbo_customer_id), qboCustomers);
  const map = Object.fromEntries((await db.select().from(qbo_item_map).where(eq(qbo_item_map.tenant_id, tenantId))).map((r) => [r.flake_key, r.qbo_item_id]));
  const draftProblems = await db.select({ id: invoice_draft.id, storm_id: invoice_draft.storm_id, customer: customer.name, error: invoice_draft.qbo_error }).from(invoice_draft).innerJoin(customer, eq(customer.id, invoice_draft.customer_id)).where(and(eq(invoice_draft.tenant_id, tenantId), isNotNull(invoice_draft.qbo_error)));
  const instProblems = await db.select({ id: installment_invoice.id, customer: customer.name, error: installment_invoice.qbo_error }).from(installment_invoice).innerJoin(contract, eq(contract.id, installment_invoice.contract_id)).innerJoin(site, eq(site.id, contract.site_id)).innerJoin(customer, eq(customer.id, site.customer_id)).where(and(eq(installment_invoice.tenant_id, tenantId), isNotNull(installment_invoice.qbo_error)));
  return {
    ...base,
    qboCustomers: qboCustomers.map((c) => ({ id: c.id, name: c.name })),
    customers: mine.map((c) => ({ ...c, suggested: suggested.get(c.id) ?? null })),
    items,
    map,
    problems: [...draftProblems.map((d) => ({ kind: 'draft' as const, ...d })), ...instProblems.map((i) => ({ kind: 'installment' as const, storm_id: null, ...i }))],
  };
}

/** After matching or mapping items, bills that were waiting on that go again. */
export async function retryQboWaiting(tenantId: string) {
  const db = serviceDb();
  const drafts = await db.select({ id: invoice_draft.id }).from(invoice_draft).where(and(eq(invoice_draft.tenant_id, tenantId), isNotNull(invoice_draft.qbo_error), inArray(invoice_draft.status, ['approved', 'charged', 'sent', 'paid', 'failed'])));
  const inst = await db.select({ id: installment_invoice.id }).from(installment_invoice).where(and(eq(installment_invoice.tenant_id, tenantId), isNotNull(installment_invoice.qbo_error)));
  const stamp = Date.now();
  for (const d of drafts) await enqueue('qbo.push', { tenantId, kind: 'draft', id: d.id }, { dedupeKey: `qbo:draft:${d.id}:${stamp}` });
  for (const i of inst) await enqueue('qbo.push', { tenantId, kind: 'installment', id: i.id }, { dedupeKey: `qbo:installment:${i.id}:${stamp}` });
  return drafts.length + inst.length;
}

export { QBO_KEYS };
