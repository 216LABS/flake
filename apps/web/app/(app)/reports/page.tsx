import { fmtLocal, stormWhen } from '@flake/core/time';
import { buttonVariants, Card, Eyebrow, Input, Label, PageHeader, Select, Stat, Table, Td, Th } from '@flake/ui';
import { ButtonA, ButtonLink, entityLink, FilterTabs } from '@/components/links';
import { ReportsNav } from './reports-nav';
import { sql } from '@flake/db';
import { asUser, requirePage } from '@/lib/auth';
import { listBranches } from '@/lib/branches';
import { money } from '@/lib/client';
import { crewHours, equipmentReport, period, saltReport, subPayReport } from '@/lib/reports';
import { tenantHasPro } from '@/lib/billing';
import { contractorSalt, saltOrderingReady } from '@/lib/salt-orders';
import { SaltOrder } from './salt-order';
import { SaltStockForm } from './salt-stock';
import { SeasonTerms } from './season-terms';
import { InsurancePack } from './insurance-pack';
import { currentSeason } from '@flake/core/time';
import { localDay } from '@flake/core/receivables';
import { seasonTerms } from '@/lib/season-terms';

export const metadata = { title: 'Reports' };

const tons = (n: number) => `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} t`;

export default async function Reports({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; subs?: string; branch?: string }> }) {
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
          The From date ({fmtLocal(`${p.backward.from}T12:00:00Z`, 'UTC', { month: 'short', day: 'numeric', year: 'numeric' })}) is after the To date ({fmtLocal(`${p.backward.to}T12:00:00Z`, 'UTC', { month: 'short', day: 'numeric', year: 'numeric' })}). Fix one of them, or swap them.
          <ButtonA size="sm" className="ml-2" href={`/reports?from=${p.backward.to}&to=${p.backward.from}`} data-testid="period-swap">Swap dates</ButtonA>
        </p>
      </>
    );
  }
  const showPay = ctx.role !== 'viewer' && tenantHasPro(ctx.tenant);
  // One branch (issue 227): its storms' bills and its crew's hours. Storms and crew are each in one branch, so the
  // branches add up to the company. Everything else on this page is the whole company.
  const branches = await asUser(ctx, (tx) => listBranches(tx));
  const branchId = q.branch === 'none' || branches.some((b) => b.id === q.branch) ? q.branch! : null;
  const stormBranch = branchId === 'none' ? sql`and s.branch_id is null` : branchId ? sql`and s.branch_id = ${branchId}` : sql``;
  const crewBranch = branchId ? new Set((await asUser(ctx, (tx) => tx.execute(sql`select id from crew_member where ${branchId === 'none' ? sql`branch_id is null` : sql`branch_id = ${branchId}`}`)) as unknown as { id: string }[]).map((r) => r.id)) : null;
  const { hours: allHours, salt, bills, equipment, subPay } = await asUser(ctx, async (tx) => ({
    equipment: await equipmentReport(tx, p),
    subPay: showPay ? await subPayReport(tx, p) : [],
    hours: await crewHours(tx, p, tz),
    salt: await saltReport(tx, ctx.tenantId, p),
    // Storm bills past review, by storm started in the period; seasonal installments by the month they were billed.
    bills: (await tx.execute(sql`
      select s.id, s.name, s.started_at,
        coalesce(sum(d.subtotal_cents), 0)::int as billed,
        coalesce(sum(d.subtotal_cents) filter (where d.status = 'paid'), 0)::int as paid,
        coalesce(sum(d.subtotal_cents) filter (where d.status in ('approved', 'sent', 'failed')), 0)::int as owed,
        coalesce(sum(d.subtotal_cents) filter (where d.status = 'charged'), 0)::int as processing
      from storm s join invoice_draft d on d.storm_id = s.id and d.status not in ('draft', 'void')
      where s.started_at >= ${p.startAt} and s.started_at < ${p.endAt} ${stormBranch}
      group by s.id, s.name, s.started_at order by s.started_at`)) as unknown as { id: string; name: string; started_at: string; billed: number; paid: number; owed: number; processing: number }[],
  }));
  const installments = (await asUser(ctx, (tx) => tx.execute(sql`
    select coalesce(sum(amount_cents) filter (where status <> 'void'), 0)::int as billed, coalesce(sum(amount_cents) filter (where status = 'paid'), 0)::int as paid,
      coalesce(sum(amount_cents) filter (where status in ('manual', 'sent', 'failed')), 0)::int as owed,
      coalesce(sum(amount_cents) filter (where status = 'pending'), 0)::int as processing
    from installment_invoice where period >= ${p.from.slice(0, 7)} and period <= ${p.to.slice(0, 7)}`)) as unknown as { billed: number; paid: number; owed: number; processing: number }[])[0] ?? { billed: 0, paid: 0, owed: 0, processing: 0 };
  // Crew hours are for payroll: employees only, unless asked. Subs are paid from Sub pay (issue 160).
  const withSubs = q.subs === '1';
  const hours = allHours.filter((h) => (withSubs || h.kind !== 'sub') && (!crewBranch || crewBranch.has(h.crewId)));
  const subsHidden = !withSubs && allHours.some((h) => h.kind === 'sub');
  // Billed = Paid + Owed + In progress, always (issue 132): a card or bank payment under way is neither yet.
  const billTotal = (k: 'billed' | 'paid' | 'owed' | 'processing') => bills.reduce((n, b) => n + b[k], 0) + installments[k];
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
        {branches.length > 1 ? <div className="min-w-0"><Label htmlFor="branch">Bills and hours for</Label><Select id="branch" name="branch" defaultValue={branchId ?? ''} data-testid="reports-branch"><option value="">All branches</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}<option value="none">No branch</option></Select></div> : null}
        {q.subs ? <input type="hidden" name="subs" value={q.subs} /> : null}
        <button type="submit" className={buttonVariants({ variant: 'outline', className: 'h-11 sm:h-10' })} data-testid="period-show">Show</button>
      </form>
      {p.invalid.length ? <p className="mb-4 rounded-md bg-warn-tint p-3 text-sm text-warn-ink" role="alert" data-testid="period-invalid">{p.invalid.join(' and ')} {p.invalid.length === 1 ? "isn't a valid date" : "aren't valid dates"}, so this shows {p.from} to {p.to} instead.</p> : null}

      <section className="mb-8" aria-labelledby="hours-title">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <Eyebrow id="hours-title">Crew hours</Eyebrow>
          {hours.length ? <a href={`/api/reports/hours.csv?from=${p.from}&to=${p.to}${withSubs ? '&subs=1' : ''}`} className={buttonVariants({ variant: 'outline', size: 'sm' })} data-testid="hours-csv">Download for payroll (CSV)</a> : null}
        </div>
        <p className="mb-3 max-w-2xl text-sm text-muted">
          From each driver&apos;s first tap on their route link to their last, using their phone&apos;s taps and GPS. A quiet gap of two hours or more starts a new shift. A shift that runs past midnight counts in full on the day it started. Check anything with a note before you pay.
        </p>
        <ReportsNav here="overview" canSeePay={ctx.role !== 'viewer'} />
      {ctx.role !== 'viewer' ? <p className="mb-3 text-sm text-muted">Payroll has regular, storm, holiday and overtime hours with Gusto and ADP files. Profit per lot shows what each lot earned after labor, salt and equipment.</p> : null}
        {subsHidden || withSubs ? (
          <div className="mb-3" data-testid="subs-hidden">
            <FilterTabs label="Whose hours" className="mb-1" items={[{ href: `/reports?from=${p.from}&to=${p.to}`, label: 'Employees only', active: !withSubs }, { href: `/reports?from=${p.from}&to=${p.to}&subs=1`, label: 'Include subcontractors', active: withSubs, testId: 'include-subs' }]} />
            {!withSubs ? <p className="mt-1 text-sm text-muted">Subcontractors are paid from Sub pay{showPay ? ' below' : ''}, not payroll.</p> : null}
          </div>
        ) : null}
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

      {ctx.role !== 'viewer' ? await (async () => { const st = await asUser(ctx, (tx) => seasonTerms(tx, ctx.tenant.timezone)); return <SeasonTerms season={st.season} rows={st.rows} owner={ctx.role === 'owner'} />; })() : null}
      <InsurancePack from={`${currentSeason(new Date(), ctx.tenant.timezone).slice(0, 4)}-07-01`} to={localDay(new Date(), ctx.tenant.timezone)} canShare={ctx.role !== 'viewer'} />
      <section className="mb-8" aria-labelledby="money-title" data-testid="money-report">
        <Eyebrow id="money-title" className="mb-2">Money</Eyebrow>
        {billTotal('billed') ? (
          <>
            <div className="mb-3 flex flex-wrap gap-x-10 gap-y-3">
              <Stat label="Billed" value={money(billTotal('billed'))} />
              <Stat label="Paid" value={money(billTotal('paid'))} />
              <Stat label="Still owed" value={money(billTotal('owed'))} />
              {billTotal('processing') ? <Stat label="Payment in progress" value={money(billTotal('processing'))} /> : null}
            </div>
            <Table stack>
              <thead><tr><Th>Storm</Th><Th>Billed</Th><Th>Paid</Th><Th>Owed</Th>{billTotal('processing') ? <Th>In progress</Th> : null}</tr></thead>
              <tbody>
                {bills.map((b) => (
                  <tr key={b.id} data-testid="money-row">
                    <Td><a className={entityLink} href={`/billing?storm=${b.id}`}>{b.name}</a><span className="block text-xs text-muted">{stormWhen(b.started_at, tz, false)}</span></Td>
                    <Td label="Billed" className="tabular">{money(b.billed)}</Td>
                    <Td label="Paid" className="tabular">{money(b.paid)}</Td>
                    <Td label="Owed" className="tabular">{money(b.owed)}</Td>
                    {billTotal('processing') ? <Td label="In progress" className="tabular">{money(b.processing)}</Td> : null}
                  </tr>
                ))}
                {installments.billed ? (
                  <tr data-testid="money-installments">
                    <Td>Seasonal installments</Td>
                    <Td label="Billed" className="tabular">{money(installments.billed)}</Td>
                    <Td label="Paid" className="tabular">{money(installments.paid)}</Td>
                    <Td label="Owed" className="tabular">{money(installments.owed)}</Td>
                    {billTotal('processing') ? <Td label="In progress" className="tabular">{money(installments.processing)}</Td> : null}
                  </tr>
                ) : null}
              </tbody>
            </Table>
            <p className="mt-2 text-xs text-muted" data-testid="money-note">Storm bills count by the day the storm started. Seasonal installments count by the month they were billed, for every month these dates touch.{billTotal('processing') ? ' In progress is a card or bank payment that has started and not cleared yet.' : ''}</p>
          </>
        ) : <p className="text-sm text-muted">Nothing billed in these dates yet. Approved storm bills and seasonal installments show here.</p>}
      </section>

      {subPay.length ? (
        <section className="mb-8" aria-labelledby="subpay-title" data-testid="subpay-report">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <Eyebrow id="subpay-title">Sub pay</Eyebrow>
            <a href={`/api/reports/subpay.csv?from=${p.from}&to=${p.to}`} className={buttonVariants({ variant: 'outline', size: 'sm' })} data-testid="subpay-csv">Download (CSV)</a>
          </div>
          <Table stack>
            <thead><tr><Th>Subcontractor</Th><Th>Storms</Th><Th>Visits</Th><Th>Hours</Th><Th>Bags</Th><Th className="text-right">Total</Th></tr></thead>
            <tbody>
              {subPay.map((r) => (
                <tr key={r.crew_id} data-testid="subpay-row">
                  <Td className="font-medium wrap-anywhere">{r.name}{r.checks ? <span className="block text-xs font-medium text-warn-ink">{r.checks} visit{r.checks === 1 ? '' : 's'} to check before paying</span> : null}</Td>
                  <Td label="Storms">{r.storms.length ? r.storms.map((s, i) => <span key={s.id}>{i ? ', ' : ''}<a className={entityLink} href={`/storms/${s.id}/pay`}>{s.name}</a></span>) : '-'}{r.season_cents ? <span className="block text-xs text-muted">Season flat rate {money(r.season_cents)}</span> : null}</Td>
                  <Td label="Visits" className="tabular">{r.visits}</Td>
                  <Td label="Hours" className="tabular">{r.hours.toFixed(2)}</Td>
                  <Td label="Bags" className="tabular">{r.bags}</Td>
                  <Td label="Total" className="tabular text-right font-semibold">{money(r.total_cents)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <p className="mt-1 text-xs text-muted">Storms that started in these dates, priced like each storm&apos;s Sub pay page: undone visits aren&apos;t paid, corrected salt is.</p>
        </section>
      ) : null}

      {equipment.length ? (
        <section className="mb-8" aria-labelledby="equipment-title" data-testid="equipment-report">
          <Eyebrow id="equipment-title" className="mb-2">Equipment</Eyebrow>
          <Table stack>
            <thead><tr><Th>Truck</Th><Th>Storms</Th><Th>Fuel</Th><Th>Fuel cost</Th><Th>Maintenance</Th><Th>Meter</Th></tr></thead>
            <tbody>
              {equipment.map((t) => (
                <tr key={t.id} data-testid="equipment-row">
                  <Td className="wrap-anywhere">{t.name}</Td>
                  <Td label="Storms" className="tabular">{t.storms}</Td>
                  <Td label="Fuel" className="tabular">{t.gallons ? `${t.gallons} gal` : '-'}</Td>
                  <Td label="Fuel cost" className="tabular">{t.fuel_cents ? money(t.fuel_cents) : '-'}</Td>
                  <Td label="Maintenance" className="tabular">{t.maintenance_cents ? money(t.maintenance_cents) : '-'}</Td>
                  <Td label="Meter" className="tabular">{t.last_hours != null ? `${t.last_hours} h` : '-'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <p className="mt-1 text-xs text-muted">Storms counts the storm routes each truck was set on. Log fuel, hours and maintenance in Settings, Equipment.</p>
        </section>
      ) : null}

      <section aria-labelledby="salt-title">
        <Eyebrow id="salt-title" className="mb-2">Salt</Eyebrow>
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <Card data-testid="salt-on-hand">
            <ButtonLink size="sm" className="float-right" href="/salt" data-testid="open-salt-yards">Salt yards</ButtonLink>
            <Stat label="On hand" value={salt.entries.length ? tons(salt.stock.tons) : 'Not counted'} note={salt.stock.since ? `Counted ${fmtLocal(salt.stock.since, tz, { month: 'short', day: 'numeric' })}, less what drivers logged since` : 'Deliveries less what drivers logged. Add a count to set it exactly.'} />
          </Card>
          <Card><Stat label="Storms left" value={salt.stormsLeft ?? '-'} note="At your average use per storm" /></Card>
          <Card><Stat label="Used these dates" value={tons(usedTons)} note={`${saltedVisits} salted visit${saltedVisits === 1 ? '' : 's'}`} /></Card>
        </div>
        {!salt.entries.length ? <p className="mb-4 rounded-md bg-tint p-3 text-sm text-ink-2" data-testid="salt-no-stock">No deliveries or counts logged yet, so there&apos;s no stock to show. Add a count of the pile to start.</p> : null}
        {salt.entries.length > 0 && salt.stock.tons < 0 ? <p className="mb-4 rounded-md bg-warn-tint p-3 text-sm text-warn-ink" data-testid="salt-negative">Drivers logged more salt than was delivered. Add the deliveries you are missing, or a count of the pile.</p> : null}
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
