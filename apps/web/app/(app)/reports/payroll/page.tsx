import { localDay } from '@flake/core/receivables';
import { Card, EmptyState, PageHeader, Select, Table, Td, Th } from '@flake/ui';
import Link from 'next/link';
import { asUser, requirePage } from '@/lib/auth';
import { money } from '@/lib/client';
import { payPeriods, payrollFor, type PayrollSettings } from '@/lib/payroll';
import { PayrollSettings as PayrollSettingsForm } from './payroll-settings';

export const metadata = { title: 'Payroll' };

const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Payroll hours for a pay period, to import into Gusto or ADP (issue 170). Employees only. */
export default async function Payroll({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const ctx = await requirePage();
  if (ctx.role === 'viewer') return <><PageHeader title="Payroll" /><Card className="max-w-2xl"><p className="text-sm">Payroll shows pay, so only owners and dispatchers can open it.</p></Card></>;
  const tz = ctx.tenant.timezone;
  const settings = (ctx.tenant.payroll ?? {}) as PayrollSettings;
  const periods = payPeriods(localDay(new Date(), tz), { period: settings.period, weekStart: settings.week_start, anchor: settings.anchor });
  const asked = (await searchParams).p;
  const picked = periods.find((x) => x.from === asked) ?? periods[0]!;
  const rows = await asUser(ctx, (tx) => payrollFor(tx, tz, settings, picked.from, picked.to));
  const noRate = rows.filter((r) => r.amount_cents == null).map((r) => r.name);
  const qs = `from=${picked.from}&to=${picked.to}`;
  return (
    <>
      <PageHeader title="Payroll" subtitle="Hours for a pay period, split into regular, storm, holiday and overtime, ready to import. Subs are paid from Sub pay, not here." />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-2" data-testid="payroll-period">
        <label className="text-sm">Pay period <Select name="p" defaultValue={picked.from} className="w-auto">{periods.map((x) => <option key={x.from} value={x.from}>{day(x.from)} to {day(x.to)}</option>)}</Select></label>
        <button type="submit" className="h-10 rounded-md border px-3 text-sm font-semibold">Show</button>
        {rows.length ? <>
          <a className="h-10 content-center rounded-md border px-3 text-sm font-semibold" href={`/api/reports/payroll?${qs}&format=gusto`} data-testid="payroll-gusto">Gusto file</a>
          <a className="h-10 content-center rounded-md border px-3 text-sm font-semibold" href={`/api/reports/payroll?${qs}&format=adp`} data-testid="payroll-adp">ADP file</a>
        </> : null}
      </form>
      {noRate.length ? <p className="mb-3 rounded-md bg-warn-tint p-3 text-sm text-warn-ink" data-testid="payroll-no-rate">No pay rate for {noRate.join(', ')}, so no amount is shown. Hours still export. Add rates in Settings, Crew.</p> : null}
      {rows.length ? (
        <Table stack data-testid="payroll-table">
          <thead><tr><Th>Employee</Th><Th className="text-right">Regular</Th><Th className="text-right">Storm</Th><Th className="text-right">Holiday</Th><Th className="text-right">Overtime</Th><Th className="text-right">Pay</Th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.crewId} data-testid="payroll-row">
                <Td className="wrap-anywhere font-medium">{r.name}
                  <details className="text-xs font-normal"><summary className="cursor-pointer text-link">{r.lines.length} {r.lines.length === 1 ? 'shift' : 'shifts'}</summary>
                    <ul>{r.lines.map((l, i) => <li key={i}>{new Date(l.start).toLocaleString('en-US', { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} to {new Date(l.end).toLocaleString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })}, {l.storm}: {l.hours} h{l.ot ? ` (${l.ot} overtime)` : ''}</li>)}</ul>
                  </details>
                </Td>
                <Td label="Regular" className="text-right tabular">{r.regular}</Td>
                <Td label="Storm" className="text-right tabular">{r.storm}</Td>
                <Td label="Holiday" className="text-right tabular">{r.holiday}</Td>
                <Td label="Overtime" className="text-right tabular" data-testid="payroll-ot">{r.ot}</Td>
                <Td label="Pay" className="text-right tabular">{r.amount_cents == null ? 'No rate' : money(r.amount_cents)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : <EmptyState title="No employee hours in this period" />}
      <p className="mt-3 max-w-3xl text-xs text-muted">Overtime is every hour past 40 in a workweek, which starts {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][settings.week_start ?? 0]} at midnight. A shift counts in the week it started. A shift that starts on a holiday you listed is holiday hours; with a storm rate set, the rest are storm hours. Overtime is 1.5 times regular unless you set an overtime rate. Hours come from the drivers&apos; phones, the same as Crew hours.</p>
      {ctx.role === 'owner' ? <PayrollSettingsForm initial={settings} /> : null}
      <Link className="mt-4 inline-block text-sm text-link underline" href="/reports">Back to reports</Link>
    </>
  );
}
