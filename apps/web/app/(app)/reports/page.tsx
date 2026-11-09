import { fmtLocal } from '@flake/core/time';
import { buttonVariants, Card, Eyebrow, Input, Label, PageHeader, Stat, Table, Td, Th } from '@flake/ui';
import { asUser, requirePage } from '@/lib/auth';
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
  const { hours, salt } = await asUser(ctx, async (tx) => ({ hours: await crewHours(tx, p, tz), salt: await saltReport(tx, ctx.tenantId, p) }));
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
      <PageHeader title="Reports" subtitle="Crew hours for payroll, and salt used and on hand." />
      <form method="get" className="mb-6 flex flex-wrap items-end gap-3" data-testid="period">
        <div><Label htmlFor="from">From</Label><Input id="from" name="from" type="date" defaultValue={p.from} /></div>
        <div><Label htmlFor="to">To</Label><Input id="to" name="to" type="date" defaultValue={p.to} /></div>
        <button type="submit" className={buttonVariants({ variant: 'outline' })}>Show</button>
      </form>

      <section className="mb-8" aria-labelledby="hours-title">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <Eyebrow id="hours-title">Crew hours</Eyebrow>
          {hours.length ? <a href={`/api/reports/hours.csv?from=${p.from}&to=${p.to}`} className={buttonVariants({ variant: 'outline', size: 'sm' })} data-testid="hours-csv">Download for payroll (CSV)</a> : null}
        </div>
        <p className="mb-3 max-w-2xl text-sm text-slate-600">
          From each driver&apos;s first tap on their route link to their last, using their phone&apos;s taps and GPS. A quiet gap of two hours or more starts a new shift. Check anything with a note before you pay.
        </p>
        {hours.length ? (
          <>
            <Table data-testid="hours-summary">
              <thead><tr><Th>Name</Th><Th>Type</Th><Th>Shifts</Th><Th>Stops done</Th><Th className="text-right">Hours</Th></tr></thead>
              <tbody>
                {people.map((x) => (
                  <tr key={x.id}><Td className="font-medium">{x.name}</Td><Td>{x.kind === 'sub' ? 'Subcontractor' : 'Employee'}</Td><Td className="tabular">{x.shifts}</Td><Td className="tabular">{x.stops}</Td><Td className="tabular text-right font-semibold">{x.hours.toFixed(2)}</Td></tr>
                ))}
              </tbody>
            </Table>
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-semibold text-slate-700">Every shift</summary>
              <Table className="mt-2" data-testid="hours-shifts">
                <thead><tr><Th>Name</Th><Th>Storm</Th><Th>Clock in</Th><Th>Clock out</Th><Th className="text-right">Hours</Th><Th>Note</Th></tr></thead>
                <tbody>
                  {hours.map((h, i) => (
                    <tr key={i}><Td>{h.crew}</Td><Td>{h.storm}</Td><Td className="tabular">{h.clockIn}</Td><Td className="tabular">{h.clockOut}</Td><Td className="tabular text-right">{h.hours.toFixed(2)}</Td><Td className="text-amber-800">{h.note}</Td></tr>
                  ))}
                </tbody>
              </Table>
            </details>
          </>
        ) : <Card className="text-sm text-slate-600">No driver activity between these dates.</Card>}
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
        {salt.stock.tons < 0 ? <p className="mb-4 rounded-md bg-amber-50 p-3 text-sm text-amber-950" data-testid="salt-negative">Drivers logged more salt than was delivered. Add the deliveries you are missing, or a count of the pile.</p> : null}
        {salt.storms.length ? (
          <Table className="mb-4" data-testid="salt-storms">
            <thead><tr><Th>Storm</Th><Th>Salted visits</Th><Th className="text-right">Tons</Th><Th className="text-right">Applications</Th></tr></thead>
            <tbody>{salt.storms.map((s) => <tr key={s.storm}><Td>{s.storm}</Td><Td className="tabular">{s.visits}</Td><Td className="tabular text-right">{s.tons.toFixed(2)}</Td><Td className="tabular text-right">{s.applications || '-'}</Td></tr>)}</tbody>
          </Table>
        ) : null}
        <p className="mb-3 max-w-2xl text-xs text-slate-600">Bags count as 50 lb. Salt logged as &quot;applications&quot; has no weight, so it is listed but not taken off the pile.</p>
        <SaltStockForm canEdit={ctx.role !== 'viewer'} entries={salt.entries.map((e) => ({ ...e, when: fmtLocal(e.at, tz, { month: 'short', day: 'numeric', year: 'numeric' }) }))} />
        {ordering ? <SaltOrder initial={JSON.parse(JSON.stringify(ordering))} defaultAddress={yard} canOrder={ctx.role !== 'viewer'} /> : null}
      </section>
    </>
  );
}
