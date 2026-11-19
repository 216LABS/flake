import { and, customer, eq, inArray, invoice_draft, serviceDb, storm, tenant } from '@flake/db';
import { logoBytes } from './logo';
import { phone } from './client';
import { isUuid } from './http';

/** "FL-3F9A2C1B": short enough to write on a check, and the same every time the bill is printed. */
export const invoiceNumber = (draftId: string) => `FL-${draftId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

const TERMS: Record<string, string> = { card_on_file: 'Charged to the card on file', ach_on_file: 'Paid from the bank account on file', invoice_net30: 'Due within 30 days', manual: 'Due on receipt' };

/**
 * A bill past review, as a PDF (issue 146). With customerId, only that customer's bill: the records page link can't
 * open anyone else's.
 */
export async function invoicePdf(tenantId: string, draftId: string, customerId?: string): Promise<{ pdf: Buffer; filename: string } | null> {
  if (!isUuid(draftId)) return null;
  const db = serviceDb();
  const [row] = await db.select({ d: invoice_draft, c: customer, t: tenant, s: storm }).from(invoice_draft)
    .innerJoin(customer, eq(customer.id, invoice_draft.customer_id)).innerJoin(tenant, eq(tenant.id, invoice_draft.tenant_id)).innerJoin(storm, eq(storm.id, invoice_draft.storm_id))
    .where(and(eq(invoice_draft.id, draftId), eq(invoice_draft.tenant_id, tenantId), inArray(invoice_draft.status, ['approved', 'charged', 'sent', 'paid', 'failed']), customerId ? eq(invoice_draft.customer_id, customerId) : undefined));
  if (!row) return null;
  const a = row.t.address as { line1?: string; city?: string; state?: string; zip?: string } | null;
  const address = a?.line1 ? `${a.line1}, ${[a.city, [a.state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')}` : null;
  const number = invoiceNumber(row.d.id);
  const paid = row.d.status === 'paid' || row.d.status === 'charged';
  const { renderInvoicePdf } = await import('@flake/providers/pdf');
  const pdf = await renderInvoicePdf({
    company: { name: row.t.name, address, phone: row.t.contact_phone ? phone(row.t.contact_phone) : null, email: row.t.contact_email, logo: await logoBytes(row.t) },
    customer: { name: row.c.name }, number, issuedAt: row.d.created_at!, timezone: row.t.timezone, storm: row.s.name,
    lines: (row.d.lines as { description: string; quantity: number; amount_cents: number }[]).map((l) => ({ description: l.description, quantity: l.quantity, amount_cents: l.amount_cents })),
    totalCents: row.d.subtotal_cents, terms: paid ? 'Paid. Thank you.' : (TERMS[row.c.billing_mode] ?? 'Due on receipt'),
    payInstructions: paid ? null : row.t.pay_instructions, payLink: paid ? null : row.d.pay_link,
  });
  return { pdf, filename: `invoice-${number}.pdf` };
}
