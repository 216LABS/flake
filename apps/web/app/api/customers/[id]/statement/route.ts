import { csvText } from '@flake/core/qbo';
import { localDay } from '@flake/core/receivables';
import { customer, eq } from '@flake/db';
import { asUser, requireApi } from '@/lib/auth';
import { HttpError, isUuid, route } from '@/lib/http';
import { customerStatement } from '@/lib/receivables';

const ymd = /^\d{4}-\d{2}-\d{2}$/;
const money = (c: number) => (c / 100).toFixed(2);

/** A customer statement as CSV: opening balance, bills and payments in the period, closing balance (issue 168). */
export const GET = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const id = (await params).id;
  if (!isUuid(id)) throw new HttpError(404, 'Not found');
  const ctx = await requireApi('viewer');
  const url = new URL(req.url);
  const tz = ctx.tenant.timezone;
  const to = ymd.test(url.searchParams.get('to') ?? '') ? url.searchParams.get('to')! : localDay(new Date(), tz);
  const from = ymd.test(url.searchParams.get('from') ?? '') ? url.searchParams.get('from')! : `${to.slice(0, 7)}-01`;
  if (from > to) throw new HttpError(400, 'The start date is after the end date.');
  const { c, s } = await asUser(ctx, async (tx) => {
    const [c] = await tx.select().from(customer).where(eq(customer.id, id));
    if (!c) throw new HttpError(404, 'Not found');
    return { c, s: await customerStatement(tx, tz, id, from, to) };
  });
  const rows = [
    ['Date', 'Type', 'Reference', 'Description', 'Charge', 'Payment', 'Balance'],
    [from, 'Opening balance', '', '', '', '', money(s.opening)],
    ...s.lines.map((l) => [l.day, l.kind === 'bill' ? 'Bill' : 'Payment', l.ref, l.description, l.kind === 'bill' ? money(l.cents) : '', l.kind === 'payment' ? money(l.cents) : '', money(l.balance)]),
    [to, 'Closing balance', '', '', '', '', money(s.closing)],
  ];
  const body = rows.map((r) => r.map((v) => csvText(String(v))).join(',')).join('\r\n') + '\r\n';
  const name = `statement-${c.name.replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}-${from}-to-${to}.csv`;
  return new Response(body, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"` } });
});
