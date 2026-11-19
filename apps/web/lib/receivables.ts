import { age, defaultDueOn, localDay, statement, type Bucket, type StatementEntry } from '@flake/core/receivables';
import { and, asService, contract, customer, eq, inArray, installment_invoice, invoice_draft, isNull, payment, site, sql, storm, type Tx } from '@flake/db';
import { HttpError } from './http';

/**
 * Receivables (issue 168). Decisions (Nov 19):
 * - Open means a storm bill approved, being charged, sent or failed, or a seasonal installment not paid. Installments
 *   age and get reminders like storm bills.
 * - Payments the office records (check, ACH, cash) sit in their own ledger. A part payment leaves the bill open with
 *   what's left; paying in full marks it paid. Voiding a payment entered by mistake puts the balance back.
 * - Overdue reminders are texts the office sends one at a time from this page (text-only, D16). Nothing goes out by
 *   itself.
 */

export interface ReceivableRow {
  kind: 'draft' | 'installment';
  id: string;
  customer_id: string;
  customer: string;
  label: string;
  storm_id: string | null;
  status: string;
  total_cents: number;
  paid_cents: number;
  balance_cents: number;
  due_on: string;
  days_late: number;
  bucket: Bucket;
}

const OPEN_DRAFT = ['approved', 'charged', 'sent', 'failed'] as const;
const OPEN_INSTALLMENT = ['manual', 'sent', 'failed'];

export async function openBills(tx: Tx, tz: string, today = localDay(new Date(), tz), customerId?: string): Promise<ReceivableRow[]> {
  const drafts = await tx.select({ d: invoice_draft, c: customer, s: storm }).from(invoice_draft)
    .innerJoin(customer, eq(customer.id, invoice_draft.customer_id)).innerJoin(storm, eq(storm.id, invoice_draft.storm_id))
    .where(and(inArray(invoice_draft.status, [...OPEN_DRAFT]), sql`${invoice_draft.subtotal_cents} > 0`, customerId ? eq(customer.id, customerId) : undefined));
  const inst = await tx.select({ i: installment_invoice, c: customer, s: site }).from(installment_invoice)
    .innerJoin(contract, eq(contract.id, installment_invoice.contract_id)).innerJoin(site, eq(site.id, contract.site_id)).innerJoin(customer, eq(customer.id, site.customer_id))
    .where(and(inArray(installment_invoice.status, OPEN_INSTALLMENT), customerId ? eq(customer.id, customerId) : undefined));
  const paid = await tx.select({ draft_id: payment.draft_id, installment_id: payment.installment_id, cents: sql<number>`sum(${payment.amount_cents})::int` }).from(payment).where(isNull(payment.voided_at)).groupBy(payment.draft_id, payment.installment_id);
  const paidFor = (k: 'draft_id' | 'installment_id', id: string) => paid.find((p) => p[k] === id)?.cents ?? 0;
  const rows: ReceivableRow[] = [];
  for (const { d, c, s } of drafts) {
    const billed = localDay(s.closed_at ?? s.started_at, tz);
    const dueOn = d.due_on ?? defaultDueOn('draft', billed, c.billing_mode);
    const a = age({ totalCents: d.subtotal_cents, paidCents: paidFor('draft_id', d.id), dueOn }, today);
    rows.push({ kind: 'draft', id: d.id, customer_id: c.id, customer: c.name, label: s.name, storm_id: s.id, status: d.status ?? 'approved', total_cents: d.subtotal_cents, paid_cents: paidFor('draft_id', d.id), balance_cents: a.balanceCents, due_on: dueOn, days_late: a.daysLate, bucket: a.bucket });
  }
  for (const { i, c, s } of inst) {
    const billed = localDay(i.created_at ?? new Date(), tz);
    const dueOn = i.due_on ?? defaultDueOn('installment', billed, c.billing_mode);
    const a = age({ totalCents: i.amount_cents, paidCents: paidFor('installment_id', i.id), dueOn }, today);
    rows.push({ kind: 'installment', id: i.id, customer_id: c.id, customer: c.name, label: `Seasonal installment ${i.seq}${i.period ? ` (${i.period})` : ''}, ${s.label}`, storm_id: null, status: i.status, total_cents: i.amount_cents, paid_cents: paidFor('installment_id', i.id), balance_cents: a.balanceCents, due_on: dueOn, days_late: a.daysLate, bucket: a.bucket });
  }
  return rows.filter((r) => r.balance_cents > 0).sort((a, b) => b.days_late - a.days_late || a.customer.localeCompare(b.customer));
}

const PAID_DETAIL = 'Paid in full, recorded by the office';

/** Records a check, ACH or cash payment against one bill. Paying the rest marks it paid; more than owed is refused. */
export async function recordPayment(tx: Tx, tenantId: string, userId: string, p: { kind: 'draft' | 'installment'; id: string; amount_cents: number; method: 'check' | 'ach' | 'cash' | 'card' | 'other'; reference?: string | null; paid_on: string }) {
  const table = p.kind === 'draft' ? invoice_draft : installment_invoice;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`charge:${p.id}`}))`);
  let total: number;
  let customerId: string;
  let status: string;
  if (p.kind === 'draft') {
    const [d] = await tx.select().from(invoice_draft).where(eq(invoice_draft.id, p.id));
    if (!d) throw new HttpError(404, 'Bill not found');
    total = d.subtotal_cents; customerId = d.customer_id; status = d.status ?? 'draft';
    if (!OPEN_DRAFT.includes(status as (typeof OPEN_DRAFT)[number])) throw new HttpError(409, status === 'paid' ? 'This bill is already paid.' : 'Approve this bill before recording a payment on it.', 'not_open');
  } else {
    const [row] = await tx.select({ i: installment_invoice, customer_id: site.customer_id }).from(installment_invoice).innerJoin(contract, eq(contract.id, installment_invoice.contract_id)).innerJoin(site, eq(site.id, contract.site_id)).where(eq(installment_invoice.id, p.id));
    if (!row) throw new HttpError(404, 'Installment not found');
    total = row.i.amount_cents; customerId = row.customer_id; status = row.i.status;
    if (!OPEN_INSTALLMENT.includes(status)) throw new HttpError(409, status === 'paid' ? 'This installment is already paid.' : 'This installment is still being sent. Try again in a minute.', 'not_open');
  }
  const [{ cents }] = (await tx.select({ cents: sql<number>`coalesce(sum(${payment.amount_cents}), 0)::int` }).from(payment).where(and(p.kind === 'draft' ? eq(payment.draft_id, p.id) : eq(payment.installment_id, p.id), isNull(payment.voided_at)))) as [{ cents: number }];
  const left = total - cents;
  if (p.amount_cents > left) throw new HttpError(409, `That's more than the $${(left / 100).toFixed(2)} still owed on this bill.`, 'overpaid');
  const [row] = await tx.insert(payment).values({ tenant_id: tenantId, customer_id: customerId, draft_id: p.kind === 'draft' ? p.id : null, installment_id: p.kind === 'installment' ? p.id : null, amount_cents: p.amount_cents, method: p.method, reference: p.reference ?? null, paid_on: p.paid_on, created_by: userId }).returning();
  const full = p.amount_cents === left;
  if (full) {
    // A card invoice already emailed is still open at Stripe: say so, so it isn't paid twice.
    const detail = status === 'sent' && p.kind === 'draft' ? `${PAID_DETAIL}. The emailed card invoice is still open: void it in Stripe so it isn't paid twice.` : PAID_DETAIL;
    await asService(tx, tenantId, () => (p.kind === 'draft'
      ? tx.update(invoice_draft).set({ status: 'paid', status_detail: detail }).where(eq(invoice_draft.id, p.id))
      : tx.update(installment_invoice).set({ status: 'paid' }).where(eq(table.id, p.id))));
  }
  return { payment: row!, balance_cents: left - p.amount_cents, paid_in_full: full };
}

/** A payment entered by mistake: void it with a reason. A bill it had paid off is open again. */
export async function voidPayment(tx: Tx, tenantId: string, id: string, reason: string) {
  const [p] = await tx.select().from(payment).where(eq(payment.id, id));
  if (!p) throw new HttpError(404, 'Payment not found');
  if (p.voided_at) return { ok: true };
  await tx.update(payment).set({ voided_at: new Date().toISOString(), void_reason: reason }).where(eq(payment.id, id));
  if (p.draft_id) {
    const [d] = await tx.select({ status: invoice_draft.status, detail: invoice_draft.status_detail }).from(invoice_draft).where(eq(invoice_draft.id, p.draft_id));
    if (d?.status === 'paid' && d.detail?.startsWith(PAID_DETAIL)) await asService(tx, tenantId, () => tx.update(invoice_draft).set({ status: 'approved', status_detail: 'A payment was voided; the bill is open again.' }).where(eq(invoice_draft.id, p.draft_id!)));
  } else if (p.installment_id) {
    const [i] = await tx.select({ status: installment_invoice.status, stripe: installment_invoice.stripe_invoice_id }).from(installment_invoice).where(eq(installment_invoice.id, p.installment_id));
    if (i?.status === 'paid') await asService(tx, tenantId, () => tx.update(installment_invoice).set({ status: i.stripe ? 'sent' : 'manual' }).where(eq(installment_invoice.id, p.installment_id!)));
  }
  return { ok: true };
}

/** Every bill and payment for a customer, for a statement over any period. */
export async function customerStatement(tx: Tx, tz: string, customerId: string, from: string, to: string) {
  const entries: StatementEntry[] = [];
  const drafts = await tx.select({ d: invoice_draft, s: storm }).from(invoice_draft).innerJoin(storm, eq(storm.id, invoice_draft.storm_id)).where(and(eq(invoice_draft.customer_id, customerId), inArray(invoice_draft.status, ['approved', 'charged', 'sent', 'failed', 'paid'])));
  for (const { d, s } of drafts) {
    const day = localDay(s.closed_at ?? s.started_at, tz);
    entries.push({ day, kind: 'bill', ref: `F-${d.id.slice(0, 8)}`, description: s.name, cents: d.subtotal_cents });
    // Paid by card or in QuickBooks, with no ledger row: the payment shows on the bill's day so the balance is right.
    if (d.status === 'paid' && !d.status_detail?.startsWith(PAID_DETAIL)) entries.push({ day, kind: 'payment', ref: `F-${d.id.slice(0, 8)}`, description: d.status_detail === 'Paid in QuickBooks' ? 'Paid (recorded in QuickBooks)' : 'Paid by card', cents: d.subtotal_cents });
  }
  const inst = await tx.select({ i: installment_invoice, s: site }).from(installment_invoice).innerJoin(contract, eq(contract.id, installment_invoice.contract_id)).innerJoin(site, eq(site.id, contract.site_id)).where(and(eq(site.customer_id, customerId), inArray(installment_invoice.status, ['manual', 'sent', 'failed', 'paid'])));
  const ledger = await tx.select().from(payment).where(and(eq(payment.customer_id, customerId), isNull(payment.voided_at)));
  for (const { i, s } of inst) {
    const day = localDay(i.created_at ?? new Date(), tz);
    entries.push({ day, kind: 'bill', ref: `F-I${i.id.slice(0, 7)}`, description: `Seasonal installment ${i.seq}, ${s.label}`, cents: i.amount_cents });
    const recorded = ledger.filter((p) => p.installment_id === i.id).reduce((a, p) => a + p.amount_cents, 0);
    if (i.status === 'paid' && recorded < i.amount_cents) entries.push({ day, kind: 'payment', ref: `F-I${i.id.slice(0, 7)}`, description: 'Paid by card', cents: i.amount_cents - recorded });
  }
  for (const p of ledger) entries.push({ day: p.paid_on, kind: 'payment', ref: p.reference ? `${p.method} ${p.reference}` : p.method, description: `Payment, ${p.method}`, cents: p.amount_cents });
  return statement(entries, from, to);
}
