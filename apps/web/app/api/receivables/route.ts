import { localDay } from '@flake/core/receivables';
import { and, asService, customer, eq, installment_invoice, invoice_draft } from '@flake/db';
import { z } from 'zod';
import { asUser, requireApi } from '@/lib/auth';
import { baseUrl } from '@/lib/env';
import { HttpError, parseJson, route } from '@/lib/http';
import { notifyParty } from '@/lib/messaging';
import { portalToken } from '@/lib/portal';
import { openBills } from '@/lib/receivables';

/** Every open bill with what's left, its due date and how late it is (issue 168). */
export const GET = route(async () => {
  const ctx = await requireApi('viewer');
  return { items: await asUser(ctx, (tx) => openBills(tx, ctx.tenant.timezone)) };
});

const body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('due'), kind: z.enum(['draft', 'installment']), id: z.uuid(), due_on: z.iso.date().nullable() }),
  z.object({ action: z.literal('remind'), customer_id: z.uuid() }),
]);

/**
 * due: set or clear one bill's due date. remind: the office sends one overdue reminder by text, to a customer who said
 * yes to texts; otherwise the words come back for the office to send from its own phone (D16). Never automatic.
 */
export const POST = route(async (req) => {
  const ctx = await requireApi('dispatcher');
  const b = await parseJson(req, body);
  if (b.action === 'due') {
    const table = b.kind === 'draft' ? invoice_draft : installment_invoice;
    const done = await asUser(ctx, (tx) => asService(tx, ctx.tenantId, () => tx.update(table).set({ due_on: b.due_on }).where(and(eq(table.id, b.id), eq(table.tenant_id, ctx.tenantId))).returning({ id: table.id })));
    if (!done.length) throw new HttpError(404, 'Bill not found');
    return { ok: true };
  }
  const { c, late } = await asUser(ctx, async (tx) => {
    const [c] = await tx.select().from(customer).where(eq(customer.id, b.customer_id));
    if (!c) throw new HttpError(404, 'Customer not found');
    return { c, late: (await openBills(tx, ctx.tenant.timezone, undefined, c.id)).filter((r) => r.days_late > 0) };
  });
  if (!late.length) throw new HttpError(409, `${c.name} has nothing past due.`, 'nothing_due');
  const amount = (late.reduce((a, r) => a + r.balance_cents, 0) / 100).toFixed(2);
  const link = `${baseUrl()}/c/${await portalToken(c.id)}`;
  const phone = ctx.tenant.contact_phone ?? '';
  const text = `${ctx.tenant.name}: A reminder that $${amount} is past due for snow service. Details: ${link} Questions? ${phone}`.trim();
  const today = localDay(new Date(), ctx.tenant.timezone);
  const sent = c.phone_e164 && c.notify_sms !== false
    ? (await notifyParty(ctx.tenant as never, { phone: c.phone_e164 }, { template: 'overdue', vars: { amount, link, phone }, subject: '', key: `overdue:${c.id}:${today}`, related: { customer_id: c.id } })).sms
    : false;
  return { sent, to: sent ? c.phone_e164 : null, phone: c.phone_e164, text };
});
