import { localDay } from '@flake/core/receivables';
import { customer, eq } from '@flake/db';
import { Card, Input, PageHeader, Table, Td, Th } from '@flake/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { asUser, requirePage } from '@/lib/auth';
import { money } from '@/lib/client';
import { customerStatement } from '@/lib/receivables';
import { PrintButton } from './print-button';

export const metadata = { title: 'Statement' };
const ymd = /^\d{4}-\d{2}-\d{2}$/;

/** A customer statement to print or save as PDF, or download as CSV (issue 168). Sending it is up to the office. */
export default async function Statement({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const { id } = await params;
  const q = await searchParams;
  const ctx = await requirePage();
  const tz = ctx.tenant.timezone;
  const to = q.to && ymd.test(q.to) ? q.to : localDay(new Date(), tz);
  const from = q.from && ymd.test(q.from) && q.from <= to ? q.from : `${to.slice(0, 7)}-01`;
  const data = await asUser(ctx, async (tx) => {
    const [c] = await tx.select().from(customer).where(eq(customer.id, id));
    return c ? { c, s: await customerStatement(tx, tz, id, from, to) } : null;
  }).catch(() => null);
  if (!data) notFound();
  const { c, s } = data;
  const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  return (
    <>
      <PageHeader title={`Statement: ${c.name}`} subtitle={`${day(from)} to ${day(to)}. From ${ctx.tenant.name}.`} />
      <form data-print-hide className="mb-4 flex flex-wrap items-end gap-2 text-sm" data-testid="statement-range">
        <label>From <Input type="date" name="from" defaultValue={from} className="w-auto" /></label>
        <label>To <Input type="date" name="to" defaultValue={to} className="w-auto" /></label>
        <button className="rounded border px-3 py-1 font-semibold" type="submit">Show</button>
        <PrintButton />
        <a className="text-link underline" href={`/api/customers/${c.id}/statement?from=${from}&to=${to}`} data-testid="statement-csv">Download CSV</a>
      </form>
      <Card className="max-w-3xl">
        <Table>
          <thead><tr><Th>Date</Th><Th>What</Th><Th className="text-right">Charge</Th><Th className="text-right">Payment</Th><Th className="text-right">Balance</Th></tr></thead>
          <tbody>
            <tr><Td>{day(from)}</Td><Td>Opening balance</Td><Td /><Td /><Td className="text-right tabular" data-testid="statement-opening">{money(s.opening)}</Td></tr>
            {s.lines.map((l, i) => (
              <tr key={i} data-testid="statement-line">
                <Td>{day(l.day)}</Td>
                <Td className="wrap-anywhere">{l.description}<span className="block text-xs text-muted">{l.ref}</span></Td>
                <Td className="text-right tabular">{l.kind === 'bill' ? money(l.cents) : ''}</Td>
                <Td className="text-right tabular">{l.kind === 'payment' ? money(l.cents) : ''}</Td>
                <Td className="text-right tabular">{money(l.balance)}</Td>
              </tr>
            ))}
            <tr className="font-semibold"><Td>{day(to)}</Td><Td>Balance due</Td><Td /><Td /><Td className="text-right tabular" data-testid="statement-closing">{money(s.closing)}</Td></tr>
          </tbody>
        </Table>
      </Card>
      <Link data-print-hide className="mt-4 inline-block text-sm text-link underline" href={`/customers/${c.id}`}>Back to {c.name}</Link>
    </>
  );
}
