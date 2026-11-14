import { fmtLocal } from '@flake/core/time';
import { buttonVariants, Card, Eyebrow, Input, Label, PageHeader, Stat, Table, Td, Th } from '@flake/ui';
import { sql } from '@flake/db';
import { asUser, requirePage } from '@/lib/auth';
import { money } from '@/lib/client';
import { crewHours, period, saltReport } from '@/lib/reports';
import { contractorSalt, saltOrderingReady } from '@/lib/salt-orders';
import { SaltOrder } from './salt-order';
import { SaltStockForm } from './salt-stock';

export const metadata = { title: 'Reports' };

const tons = (n: number) => `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} t`;

export default async function Reports({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const q = await searchParams;
  const ctx = await requirePage();
  const tz = ctx.tenant.timezone;
  const p = period(q.from, q.to, tz);
  // A backward range is shown as typed, with what's wrong and a one-tap swap, and no results (issue 63).
  if (p.backward) {
    return (
      <>
        <PageHeader title="Reports" subtitle="What you billed and were paid, crew hours for payroll, and salt used and on hand." />
        <form method="get" className="mb-4 grid grid-cols-1 items-end gap-3 sm:flex sm:flex-wrap" data-testid="period">
          <div className="min-w-0"><Label htmlFor="from">From</Label><Input id="from" name="from" type="date" defaultValue={p.backward.from} aria-invalid="true" /></div>
          <div className="min-w-0"><Label htmlFor="to">To</Label><Input id="to" name="to" type="date" defaultValue={p.backward.to} /></div>
          <button type="submit" className={buttonVariants({ variant: 'outline', className: 'h-11 sm:h-10' })} data-testid="period-show">Show</button>
        </form>
        <p className="rounded-md bg-danger-tint p-3 text-sm text-danger" role="alert" data-testid="period-backward">
          The From date ({fmtLocal(`${p.backward.from}T12:00:00Z`, 'UTC', { month: 'short', day: 'numeric', year: 'numeric' })}) is after the To date ({fmtLocal(`${p.backward.to}T12:00:00Z`, 'UTC', { month: 'short', day: 'numeric', year: 'numeric' })}). Fix one of them, or{' '}
          <a className="font-semibold underline" href={`/reports?from=${p.backward.to}&to=${p.backward.from}`} data-testid="period-swap">show {p.backward.to} to {p.backward.from}</a>.
        </p>
      </>
    );
  }
  const { hours, salt, bills } = await asUser(ctx, async (tx) => ({
    hours: await crewHours(tx, p, tz),
    salt: await saltReport(tx, ctx.tenantId, p),
    // Storm bills past review, by storm started in the period; seasonal installments by the month they were billed.
    bills: (await tx.execute(sql`
      select s.id, s.name, s.started_at,
        coalesce(sum(d.subtotal_cents), 0)::int as billed,
        coalesce(sum(d.subtotal_cents) filter (where d.status = 'paid'), 0)::int as paid,
        coalesce(sum(d.subtotal_cents) filter (where d.status in ('approved', 'sent', 'failed')), 0)::int as owed
      from storm s join invoice_draft d on d.storm_id = s.id and d.status not in ('draft', 'void')
      where s.started_at >= ${p.startAt} and s.started_at < ${p.endAt}
      group by s.id, s.name, s.started_at order by s.started_at`)) as unknown as { id: string; name: string; started_at: string; billed: number; paid: number; owed: number }[],
  }));
  const installments = (await asUser(ctx, (tx) => tx.execute(sql`
    select coalesce(sum(amount_cents), 0)::int as billed, coalesce(sum(amount_cents) filter (where status = 'paid'), 0)::int as paid,
      coalesce(sum(amount_cents) filter (where status in ('manual', 'sent', 'failed')), 0)::int as owed
    from installment_invoice where period >= ${p.from.slice(0, 7)} and period <= ${p.to.slice(0, 7)}`)) as unknown as { billed: number; paid: number; owed: number }[])[0] ?? { billed: 0, paid: 0, owed: 0 };
  const billTotal = (k: 'billed' | 'paid' | 'owed') => bills.reduce((n, b) => n + b[k], 0) + installments[k];
  const people = [...new Set(hours.map((h) => h.crewId))].map((id) => {
    const rows = hours.filter((h) => h.crewId === id);
    return { id, name: rows[0]!.crew, kind: rows[0]!.kind, shifts: rows.length, hours: rows.reduce((n, r) => n + r.hours, 0), stops: rows.reduce((n, r) => n + r.stops, 0) };
  });
  // Salt ordering shows once its tables exist on this database (supabase db push).
  const ordering = (await saltOrderingReady()) ? await contractorSalt(ctx) : null;
  const yard = ctx.tenant.address ? [ctx.tenant.address.line1, ctx.tenant.address.city, ctx.tenant.address.state, ctx.tenant.address.zip].filter(Boolean).join(', ') : '';
  const usedTons = salt.storms.reduce((n, s) => n + s.tons, 0);
  const saltedVisits = salt.storms.reduce((n, s) => n + s.visits, 0);
  return (
    <>
      <PageHeader title="Reports" subtitle="What you billed and were paid, crew hours for payroll, and salt used and on hand." />
      {/* Stacked on a phone, so a wide iOS date control can't sit on top of Show (issue 44). */}
      <form method="get" className="mb-6 grid grid-cols-1 items-end gap-3 sm:flex sm:flex-wrap" data-testid="period">
        <div className="min-w-0"><Label htmlFor="from">From</Label><Input id="from" name="from" type="date" defaultValue={p.from} /></div>
        <div className="min-w-0"><Label htmlFor="to">To</Label><Input id="to" name="to" type="date" defaultValue={p.to} /></div>
        <button type="submit" className={buttonVariants({ variant: 'outline', className: 'h-11 sm:h-10' })} data-testid="period-show">Show</button>
      </form>

      <section className="mb-8" aria-labelledby="hours-title">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <Eyebrow id="hours-title">Crew hours</Eyebrow>
          {hours.length ? <a href={`/api/reports/hours.csv?from=${p.from}&to=${p.to}`} className={buttonVariants({ variant: 'outline', size: 'sm' })} data-testid="hours-csv">Download for payroll (CSV)</a> : null}
        </div>
        <p className="mb-3 max-w-2xl text-sm text-muted">
          From each driver&apos;s first tap on their route link to their last, using their phone&apos;s taps and GPS. A quiet gap of two hours or more starts a new shift. Check anything with a note before you pay.
        </p>
        {hours.length ? (
          <>
            <Table stack data-testid="hours-summary">
              <thead><tr><Th>Name</Th><Th>Type</Th><Th>Shifts</Th><Th>Stops done</Th><Th className="text-right">Hours</Th></tr></thead>
              <tbody>
                {people.map((x) => (
                  <tr key={x.id}><Td className="font-medium">{x.name}</Td><Td label="Type">{x.kind === 'sub' ? 'Subcontractor' : 'Employee'}</Td><Td label="Shifts" className="tabular">{x.shifts}</Td><Td label="Stops done" className="tabular">{x.stops}</Td><Td label="Hours" className="tabular text-right font-semibold">{x.hours.toFixed(2)}</Td></tr>
                ))}
              </tbody>
            </Table>
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-semibold text-ink-2">Every shift</summary>
              <Table stack className="mt-2" data-testid="hours-shifts">
                <thead><tr><Th>Name</Th><Th>Storm</Th><Th>Clock in</Th><Th>Clock out</Th><Th className="text-right">Hours</Th><Th>Note</Th></tr></thead>
                <tbody>
                  {hours.map((h, i) => (
                    <tr key={i}><Td className="font-medium">{h.crew}</Td><Td label="Storm">{h.storm}</Td><Td label="Clock in" className="tabular">{h.clockIn}</Td><Td label="Clock out" className="tabular">{h.clockOut}</Td><Td label="Hours" className="tabular text-right">{h.hours.toFixed(2)}</Td><Td className="text-warn-ink">{h.note}</Td></tr>
                  ))}
                </tbody>
              </Table>
            </details>
          </>
        ) : <Card className="text-sm text-muted">No driver activity between these dates.</Card>}
      </section>

      <section className="mb-8" aria-labelledby="money-title" data-testid="money-report">
        <Eyebrow id="money-title" className="mb-2">Money</Eyebrow>
        {billTotal('billed') ? (
          <>
            <div className="mb-3 flex flex-wrap gap-x-10 gap-y-3">
              <Stat label="Billed" value={money(billTotal('billed'))} />
              <Stat label="Paid" value={money(billTotal('paid'))} />
              <Stat label="Still owed" value={money(billTotal('owed'))} />
            </div>
            <Table stack>
              <thead><tr><Th>Storm</Th><Th>Billed</Th><Th>Paid</Th><Th>Owed</Th></tr></thead>
              <tbody>
                {bills.map((b) => (
                  <tr key={b.id} data-testid="money-row">
                    <Td><a className="text-link underline" href={`/billing?storm=${b.id}`}>{b.name}</a><span className="block text-xs text-muted">{fmtLocal(b.started_at, tz, { month: 'short', day: 'numeric' })}</span></Td>
                    <Td label="Billed" className="tabular">{money(b.billed)}</Td>
                    <Td label="Paid" className="tabular">{money(b.paid)}</Td>
                    <Td label="Owed" className="tabular">{money(b.owed)}</Td>
                  </tr>
                ))}
                {installments.billed ? (
                  <tr data-testid="money-installments">
                    <Td>Seasonal installments</Td>
                    <Td label="Billed" className="tabular">{money(installments.billed)}</Td>
                    <Td label="Paid" className="tabular">{money(installments.paid)}</Td>
                    <Td label="Owed" className="tabular">{money(installments.owed)}</Td>
                  </tr>
                ) : null}
              </tbody>
            </Table>
          </>
        ) : <p className="text-sm text-muted">Nothing billed in these dates yet. Approved storm bills and seasonal installments show here.</p>}
      </section>

      <section aria-labelledby="salt-title">
        <Eyebrow id="salt-title" className="mb-2">Salt</Eyebrow>
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <Card data-testid="salt-on-hand">
            <Stat label="On hand" value={tons(salt.stock.tons)} note={salt.stock.since ? `Counted ${fmtLocal(salt.stock.since, tz, { month: 'short', day: 'numeric' })}, less what drivers logged since` : 'Deliveries less what drivers logged. Add a count to set it exactly.'} />
          </Card>
          <Card><Stat label="Storms left" value={salt.stormsLeft ?? '-'} note="At your average use per storm" /></Card>
          <Card><Stat label="Used these dates" value={tons(usedTons)} note={`${saltedVisits} salted visit${saltedVisits === 1 ? '' : 's'}`} /></Card>
        </div>
        {salt.stock.tons < 0 ? <p className="mb-4 rounded-md bg-warn-tint p-3 text-sm text-warn-ink" data-testid="salt-negative">Drivers logged more salt than was delivered. Add the deliveries you are missing, or a count of the pile.</p> : null}
        {salt.storms.length ? (
          <Table stack className="mb-4" data-testid="salt-storms">
            <thead><tr><Th>Storm</Th><Th>Salted visits</Th><Th className="text-right">Tons</Th><Th className="text-right">Applications</Th></tr></thead>
            <tbody>{salt.storms.map((s) => <tr key={s.storm}><Td className="font-medium">{s.storm}</Td><Td label="Salted visits" className="tabular">{s.visits}</Td><Td label="Tons" className="tabular text-right">{s.tons.toFixed(2)}</Td><Td label="Applications" className="tabular text-right">{s.applications || '-'}</Td></tr>)}</tbody>
          </Table>
        ) : null}
        <p className="mb-3 max-w-2xl text-xs text-muted">Bags count as 50 lb. Salt logged as &quot;applications&quot; has no weight, so it is listed but not taken off the pile.</p>
        <SaltStockForm canEdit={ctx.role !== 'viewer'} entries={salt.entries.map((e) => ({ ...e, when: fmtLocal(e.at, tz, { month: 'short', day: 'numeric', year: 'numeric' }) }))} />
        {ordering ? <SaltOrder initial={JSON.parse(JSON.stringify(ordering))} defaultAddress={yard} canOrder={ctx.role !== 'viewer'} /> : null}
      </section>
    </>
  );
}
