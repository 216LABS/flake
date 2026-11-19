import { and, contract, crew_member, customer, desc, eq, isNull, message_log, route, route_stop, run_stop, serviceDb, site, sql, storm, storm_run, trigger_alert } from '@flake/db';
import { fmtLocal, stormWhen } from '@flake/core/time';
import { Badge, buttonVariants, Card, EmptyState, Eyebrow, PageHeader, Progress, Stat, Table, Td, Th } from '@flake/ui';
import Link from 'next/link';
import { asUser, requirePage } from '@/lib/auth';
import { stormStatus } from '@/lib/labels';
import { money } from '@/lib/client';
import { listMaintenance } from '@/lib/maintenance';
import { yardStock } from '@/lib/yards';
import { complianceAlerts } from '@/lib/compliance';
import { renewalQueue, renewalsOpen } from '@/lib/bids';
import { localDay } from '@flake/core/receivables';
import { canSeeUsage, deploymentUsage } from '@/lib/usage';
import { tenantWeatherHeader } from '@/lib/weather';
import { available, getSetting } from '@/lib/providers';

export const metadata = { title: 'Dashboard' };

export default async function Dashboard() {
  const ctx = await requirePage();
  const tz = ctx.tenant.timezone;
  const data = await asUser(ctx, async (tx) => ({
    alerts: await tx.select().from(trigger_alert).where(eq(trigger_alert.status, 'open')).orderBy(desc(trigger_alert.created_at)).limit(10),
    active: await tx.select().from(storm).where(eq(storm.status, 'active')).orderBy(desc(storm.started_at)),
    recent: await tx.select({ id: storm.id, name: storm.name, started_at: storm.started_at, status: storm.status, billedNothing: sql<boolean>`not exists (select 1 from invoice_draft d where d.storm_id = ${storm.id} and d.status <> 'void')` }).from(storm).where(sql`${storm.status} <> 'active'`).orderBy(desc(storm.started_at)).limit(5),
    // Active customers decide the first-run card, Start a storm and the checklist; archived ones only change the words (issue 139).
    customers: await tx.select({ n: sql<number>`(count(*) filter (where ${customer.archived_at} is null))::int`, all: sql<number>`count(*)::int` }).from(customer),
    crew: await tx.select({ n: sql<number>`count(*)::int` }).from(crew_member).where(eq(crew_member.active, true)),
    routed: await tx.select({ n: sql<number>`count(*)::int` }).from(route_stop).innerJoin(route, eq(route.id, route_stop.route_id)).innerJoin(site, eq(site.id, route_stop.site_id)).where(and(isNull(route.archived_at), eq(site.active, true))),
    progress: await tx.select({ storm_id: storm_run.storm_id, finished: sql<number>`count(*) filter (where ${run_stop.status} in ('done', 'skipped'))::int`, total: sql<number>`count(*)::int` }).from(run_stop).innerJoin(storm_run, eq(storm_run.id, run_stop.storm_run_id)).innerJoin(storm, eq(storm.id, storm_run.storm_id)).where(eq(storm.status, 'active')).groupBy(storm_run.storm_id),
    // Quotes waiting for a signature, whether emailed or handed over as a link (issue 92), on lots still in service, the
    // same set Customers' "Quote waiting" filter lists.
    pendingQuotes: await tx.select({ n: sql<number>`count(distinct coalesce(${contract.quote_token_hash}, ${contract.id}::text))::int` }).from(contract).innerJoin(site, eq(site.id, contract.site_id)).where(and(sql`${contract.status} in ('sent', 'draft')`, eq(site.active, true))),
    // What customers still owe: storm bills not collected yet, and seasonal installments not paid.
    owed: (await tx.execute(sql`
      select c.id, c.name, sum(x.cents)::int as cents, count(*)::int as n from (
        select customer_id, subtotal_cents as cents from invoice_draft where status in ('approved', 'sent', 'failed') and subtotal_cents > 0
        union all
        select s.customer_id, i.amount_cents from installment_invoice i join contract k on k.id = i.contract_id join site s on s.id = k.site_id where i.status in ('manual', 'sent', 'failed')
      ) x join customer c on c.id = x.customer_id group by c.id, c.name order by cents desc`)) as unknown as { id: string; name: string; cents: number; n: number }[],
    // Truck service due soon or overdue (issue 161).
    service: (await listMaintenance(tx)).filter((m) => m.status.state !== 'ok'),
  }));
  // Salt at or under a yard's reorder point (issue 169). Dashboard only; nothing is ordered by itself.
  const lowSalt = ctx.role === 'viewer' ? [] : (await yardStock(ctx.tenantId)).filter((y) => y.low);
  // Certificates ending or ended, and subs without current cover (issue 165).
  const insurance = await asUser(ctx, (tx) => complianceAlerts(tx, tz));
  // Renewals for next winter, from the company's start date (issue 166).
  const renewals = ctx.role === 'viewer' ? null : await asUser(ctx, (tx) => renewalQueue(tx, tz));
  const renewNow = renewals && renewals.rows.length && renewalsOpen(localDay(new Date(), tz), ctx.tenant.renewal_start ?? '08-01', renewals.season) ? renewals : null;
  const owedTotal = data.owed.reduce((n, r) => n + r.cents, 0);
  // Customers' "come back" requests from their records page, one per lot and hour, for a week (issue 5).
  const requests = (await serviceDb().execute(sql`
    select distinct on (m.related->>'site_id', date_trunc('hour', m.created_at), coalesce(m.related->>'note', '')) m.related->>'site_id' as site_id, m.related->>'customer_id' as customer_id, m.related->>'note' as note, m.created_at, s.label, c.name
    from message_log m join site s on s.id = (m.related->>'site_id')::uuid join customer c on c.id = s.customer_id
    where m.tenant_id = ${ctx.tenantId} and m.related->>'kind' = 'visit_request' and m.created_at > now() - interval '7 days'
    order by m.related->>'site_id', date_trunc('hour', m.created_at), coalesce(m.related->>'note', ''), m.created_at`)) as unknown as { site_id: string; customer_id: string; note: string | null; created_at: string; label: string; name: string }[];
  requests.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const w = await tenantWeatherHeader(ctx.tenantId);
  // Failures retry; rejected addresses don't, and need someone to fix the address (issue 49).
  // "Still retrying" only while a send for this company is actually waiting for another try (issue 69).
  const [{ retrying } = { retrying: false }] = (await serviceDb().execute(sql`select exists (select 1 from job where done_at is null and dead_at is null and attempts > 0 and last_error is not null
    and payload->>'tenantId' = ${ctx.tenantId}) as retrying`)) as unknown as { retrying: boolean }[];
  const [{ failedMessages, rejectedMessages } = { failedMessages: 0, rejectedMessages: 0 }] = await serviceDb()
    .select({ failedMessages: sql<number>`(count(*) filter (where ${message_log.status} = 'failed'))::int`, rejectedMessages: sql<number>`(count(*) filter (where ${message_log.status} = 'rejected'))::int` })
    .from(message_log).where(and(eq(message_log.tenant_id, ctx.tenantId), sql`${message_log.created_at} > now() - interval '24 hours'`));
  const usage = canSeeUsage(ctx.email) ? await deploymentUsage() : null;
  const fmt = (v: number | null, unit = '"') => (v === null ? 'unavailable' : `${v}${unit}`);
  const canEdit = ctx.role !== 'viewer';
  const can = await available();
  // Issue 173: everything a new owner needs, in order, each finished in the app. Stripe and texting appear only when the
  // platform has their keys (issue 175); the logo is optional.
  const t = ctx.tenant;
  const hasAddress = Boolean((t.address as { line1?: string } | null)?.line1);
  const rateChecked = ctx.role === 'owner' ? Boolean(await getSetting(`setup.rate:${t.id}`)) : false;
  const setup: { done: boolean; text: string; href: string; more?: { text: string; href: string }; optional?: boolean }[] = ctx.role !== 'owner' ? [] : [
    { done: Boolean(t.business_legal_name?.trim()) && hasAddress, text: 'Add your legal business name and address', href: can.sms ? '/settings?tab=sms' : '/settings?tab=company' },
    { done: rateChecked, text: 'Check your prices. Flake starts with typical ones.', href: '/settings?tab=rate' },
    { done: data.customers[0]!.n > 0, text: data.customers[0]!.all ? 'Add a customer' : 'Add your first customer and lot', href: '/customers/new', more: { text: 'Have a list? Import it', href: '/customers/import' } },
    { done: data.crew[0]!.n > 0, text: 'Add your drivers', href: '/settings?tab=crew', more: { text: 'Have a list? Import it', href: '/settings/crew-import' } },
    { done: data.routed[0]!.n > 0, text: 'Put your lots on a route, so a storm knows where to go', href: '/routes' },
    ...(can.payments ? [{ done: Boolean(t.stripe_charges_enabled), text: 'Connect Stripe to get paid by card or bank', href: '/settings?tab=payments' }] : []),
    ...(can.sms ? [{ done: t.sms_status === 'approved', text: t.sms_status === 'pending' ? 'Text number: waiting on verification (3 to 5 business days)' : 'Get your text number verified. Crew links go by QR and copy-link until then.', href: '/settings?tab=sms' }] : []),
    { done: Boolean(t.logo_path), text: 'Add your logo for quotes and bills', href: '/settings?tab=company', optional: true },
  ];
  return (
    <>
      <PageHeader title="Dashboard" subtitle={ctx.tenant.name} actions={canEdit && data.routed[0]!.n > 0 ? <Link href="/storms#start" className={buttonVariants({ variant: 'accent' })}>Start a storm</Link> : null} />
      {/* Customers but no lot on a route: a storm would have nothing to send, so say the next step (first-run walk). */}
      {canEdit && data.customers[0]!.n > 0 && data.routed[0]!.n === 0 ? <p className="mb-4 rounded-md bg-info-tint p-3 text-sm text-ink" data-testid="needs-route">Next: put your lots on a route. A storm sends each route to one truck. <Link className="font-semibold underline" href="/routes">Open Routes</Link></p> : null}
      {/* Issue 171: every company starts with sending off; say so where the office looks first. */}
      {canEdit && !ctx.tenant.outbound_enabled ? <p className="mb-4 rounded-md bg-info-tint p-3 text-sm text-ink" data-testid="sending-off">Flake isn&apos;t sending email or texts for your company yet, so bills, quotes and notices stay inside Flake. 216LABS turns sending on when your company is approved. Until then, share links yourself: each quote, bill and driver page has one.</p> : null}
      {usage?.near_limit ? <p className="mb-4 rounded-md bg-danger-tint p-3 text-sm text-danger" data-testid="usage-warning">Storage is nearly full ({usage.files_mb} of {usage.files_limit_mb} MB of files, {usage.db_mb} of {usage.db_limit_mb} MB of database). <Link className="underline" href="/settings?tab=system">See details</Link></p> : null}
      {failedMessages ? <p className="mb-4 rounded-md bg-danger-tint p-3 text-sm text-danger" data-testid="messages-failed">{failedMessages === 1 ? '1 message' : `${failedMessages} messages`} could not be sent in the last 24 hours. {retrying ? 'Flake is still retrying.' : 'Flake has stopped retrying. Check the address, then send again from the driver or customer.'} <Link className="underline" href="/settings?tab=system">See why</Link></p> : null}
      {rejectedMessages ? <p className="mb-4 rounded-md bg-warn-tint p-3 text-sm text-warn-ink" data-testid="messages-rejected">{rejectedMessages === 1 ? '1 message was' : `${rejectedMessages} messages were`} not delivered because the email address or phone number was rejected. Fix it on the driver or customer, and route links go out again. <Link className="underline" href="/settings?tab=system">See which</Link></p> : null}
      {/* A brand-new company has no lots, so no forecast to show yet: say what comes first instead of "unavailable" (issue 129). */}
      {data.customers[0]!.n === 0 ? (
        <section className="rounded-md bg-slate-950 p-5 text-white" data-testid="first-run">
          <h2 className="font-display text-xl font-semibold">{data.customers[0]!.all ? 'No active customers' : 'Welcome to Flake'}</h2>
          <p className="mt-1 text-sm text-slate-300">{data.customers[0]!.all ? 'Every customer is archived. Add one, or restore one from Archived customers.' : 'Add a customer and their lot.'} The snow forecast for your lots shows here once there&apos;s one to watch.</p>
          {canEdit ? <div className="mt-3 flex flex-wrap gap-2"><Link href="/customers/new" className={buttonVariants({ variant: 'accent' })}>Add your first customer</Link><Link href="/customers/import" className={buttonVariants({ variant: 'outline', className: 'text-ink' })}>Import a list</Link></div> : null}
        </section>
      ) : (
      <section className="overflow-hidden rounded-md bg-slate-950 text-white" data-testid="conditions">
        <div className="flex flex-wrap items-end gap-x-10 gap-y-4 p-5">
          <Stat label="Next 12 h" value={fmt(w.forecast_in)} />
          <Stat label="Elapsed this event" value={fmt(w.elapsed_in)} />
          <Stat label="Temperature" value={fmt(w.temp_f, ' F')} />
          <p className="ml-auto text-xs text-slate-300">{w.reason ? `${w.reason} ` : ''}{w.source === 'unavailable' ? '' : `Live forecast. Source: ${w.source}${w.fetched_at ? `, ${fmtLocal(w.fetched_at, tz)}` : ''}`}</p>
        </div>
      </section>
      )}
      <div className={`mt-6 grid grid-cols-1 gap-6 ${setup.some((s) => !s.done && !s.optional) ? 'lg:grid-cols-3' : ''}`}>
        <div className={`space-y-6 ${setup.some((s) => !s.done && !s.optional) ? 'lg:col-span-2' : ''}`}>
          <section>
            <Eyebrow className="mb-2">Trigger alerts</Eyebrow>
            {data.alerts.length ? (
              <ul className="divide-y divide-line-faint rounded-md border border-beacon bg-surface">
                {data.alerts.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                    <span className="min-w-0 text-sm font-medium">{a.detail.headline}</span>
                    <Link href={`/alerts/${a.id}`} className={buttonVariants({ size: 'sm', variant: 'accent' })} data-testid="alert-review">Review</Link>
                  </li>
                ))}
              </ul>
            ) : <p className="rounded-md border border-line-faint bg-surface p-3 text-sm text-muted">No open alerts.</p>}
          </section>
          {requests.length ? (
            <section data-testid="visit-requests">
              <Eyebrow className="mb-2">Customers asking for a visit</Eyebrow>
              <ul className="divide-y divide-line-faint rounded-md border border-line-faint bg-surface">
                {requests.slice(0, 8).map((r) => (
                  <li key={`${r.site_id}:${r.created_at}`} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                    <span className="min-w-0"><Link className="font-medium text-ink underline" href={`/customers/${r.customer_id}`}>{r.name}</Link>, {r.label}{r.note ? `: "${r.note}"` : ''}</span>
                    <span className="text-xs text-muted">{fmtLocal(r.created_at, tz)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {owedTotal || data.pendingQuotes[0]!.n ? (
            <section data-testid="waiting-on">
              <Eyebrow className="mb-2">Waiting on customers</Eyebrow>
              <div className="rounded-md border border-line-faint bg-surface p-3 text-sm">
                {data.pendingQuotes[0]!.n ? <p data-testid="quotes-waiting">{data.pendingQuotes[0]!.n === 1 ? '1 quote is' : `${data.pendingQuotes[0]!.n} quotes are`} waiting for a signature. <Link className="text-link underline" href="/customers?waiting=1">See which</Link></p> : null}
                {owedTotal ? (
                  <>
                    <p className={data.pendingQuotes[0]!.n ? 'mt-2' : ''} data-testid="owed-total">Still owed: <b className="tabular">{money(owedTotal)}</b></p>
                    <ul className="mt-1 space-y-0.5">
                      {data.owed.slice(0, 8).map((r) => <li key={r.id}><Link className="text-link underline" href={`/customers/${r.id}`}>{r.name}</Link>: <span className="tabular">{money(r.cents)}</span>{r.n > 1 ? ` (${r.n} bills)` : ''}</li>)}
                    </ul>
                    {data.owed.length > 8 ? <p className="mt-1 text-xs text-muted">And {data.owed.length - 8} more customers.</p> : null}
                    <Link className="mt-1 inline-block text-link underline" href="/receivables" data-testid="open-receivables">Receivables: what's late, payments, reminders</Link>
                  </>
                ) : null}
              </div>
            </section>
          ) : null}
          {renewNow ? (
            <section data-testid="renewals-due">
              <Eyebrow className="mb-2">Renewals</Eyebrow>
              <p className="rounded-md border border-line-faint bg-surface p-3 text-sm">{renewNow.rows.length} {renewNow.rows.length === 1 ? 'lot has' : 'lots have'} nothing yet for {renewNow.next}. <Link className="font-semibold text-link underline" href="/bids">Renew them</Link></p>
            </section>
          ) : null}
          {insurance.length ? (
            <section data-testid="insurance-alerts">
              <Eyebrow className="mb-2">Insurance</Eyebrow>
              <ul className="space-y-1 rounded-md border border-line-faint bg-surface p-3 text-sm">
                {insurance.slice(0, 6).map((a, i) => <li key={i} className="flex flex-wrap gap-2"><Badge tone={a.tone}>{a.tone === 'red' ? 'Act now' : 'Soon'}</Badge><span className="wrap-anywhere">{a.text}</span></li>)}
                <li><Link className="text-link underline" href="/compliance">Insurance and claims</Link></li>
              </ul>
            </section>
          ) : null}
          {lowSalt.length ? (
            <section data-testid="salt-reorder">
              <Eyebrow className="mb-2">Salt</Eyebrow>
              <ul className="space-y-1 rounded-md border border-warn-line bg-warn-tint p-3 text-sm text-warn-ink">
                {lowSalt.map((y) => <li key={y.yard.id}>Reorder salt, {y.yard.name}: {y.tons} tons on hand (reorder at {Number(y.yard.reorder_tons)}). <Link className="font-semibold underline" href="/reports">Order salt</Link></li>)}
              </ul>
            </section>
          ) : null}
          {data.service.length ? (
            <section data-testid="service-due">
              <Eyebrow className="mb-2">Truck service</Eyebrow>
              <ul className="space-y-1 rounded-md border border-line-faint bg-surface p-3 text-sm">
                {data.service.slice(0, 8).map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-2" data-testid="service-row">
                    <Badge tone={m.status.state === 'overdue' ? 'red' : 'amber'}>{m.status.state === 'overdue' ? 'Overdue' : 'Due soon'}</Badge>
                    <span className="wrap-anywhere"><b>{m.truck_name}</b>: {m.name}</span>
                    <span className="text-muted">{m.status.detail}</span>
                  </li>
                ))}
                {data.service.length > 8 ? <li className="text-xs text-muted">And {data.service.length - 8} more.</li> : null}
                <li><Link className="text-link underline" href="/settings?tab=equipment">Open Equipment</Link></li>
              </ul>
            </section>
          ) : null}
          <section>
            <Eyebrow className="mb-2">Active storms</Eyebrow>
            {data.active.length ? (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {data.active.map((s) => {
                  const p = data.progress.find((x) => x.storm_id === s.id);
                  return (
                    <Link key={s.id} href={`/storms/${s.id}`} data-testid="active-storm">
                      <Card className="transition-colors hover:border-ink">
                        <div className="flex items-start justify-between gap-2"><div className="font-display text-lg font-semibold leading-tight">{s.name}</div><Badge tone={stormStatus('active').tone}>{stormStatus('active').word}</Badge></div>
                        <div className="mt-0.5 text-xs text-muted">Started {stormWhen(s.started_at, tz)}</div>
                        <Progress className="mt-3" value={p?.finished ?? 0} max={p?.total ?? 0} label={`Stops finished in ${s.name}`} />
                        <div className="tabular mt-1.5 text-sm font-medium text-ink" data-testid="storm-progress">{p ? `${p.finished} of ${p.total} stops finished` : 'No stops yet'}</div>
                      </Card>
                    </Link>
                  );
                })}
              </div>
            ) : <EmptyState title="No storm is running" body={canEdit ? 'Start one by hand, or wait for a trigger alert.' : 'The office starts one when snow is coming.'} />}
          </section>
        </div>
        {setup.some((s) => !s.done && !s.optional) ? (
          <section data-testid="setup-checklist">
            <Eyebrow className="mb-2">Finish setup: {setup.filter((s) => s.done).length} of {setup.length} done</Eyebrow>
            <ul className="divide-y divide-line-faint rounded-md border border-line-faint bg-surface">
              {setup.map((s) => (
                <li key={s.text} className="p-3 text-sm" data-testid="setup-step" data-done={s.done ? 'yes' : 'no'}>
                  {s.done ? (
                    <span className="flex items-start gap-2 text-muted"><span aria-hidden="true" className="text-ok-ink">✓</span><span><span className="sr-only">Done: </span>{s.text}</span></span>
                  ) : (
                    <span className="flex items-start gap-2"><span aria-hidden="true" className="text-faint">○</span><span><Link className="font-medium text-ink underline-offset-2 hover:underline" href={s.href}>{s.text}</Link>{s.optional ? <span className="text-muted"> (optional)</span> : null}{s.more ? <Link className="mt-0.5 block text-xs text-link underline" href={s.more.href}>{s.more.text}</Link> : null}</span></span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
      <Eyebrow className="mb-2 mt-6">Recent storms</Eyebrow>
      {data.recent.length ? (
        <Table stack>
          <thead><tr><Th>Storm</Th><Th>Started</Th><Th>Status</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
          <tbody>
            {data.recent.map((s) => (
              <tr key={s.id}>
                <Td><Link className="text-link underline" href={`/storms/${s.id}`}>{s.name}</Link></Td>
                <Td label="Started">{stormWhen(s.started_at, tz)}</Td>
                <Td label="Status"><Badge tone={stormStatus(s.status ?? '', s.billedNothing).tone}>{stormStatus(s.status ?? '', s.billedNothing).word}</Badge></Td>
                <Td><Link className="text-link underline" href={`/billing?storm=${s.id}`}>Billing</Link></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : <p className="text-sm text-muted">None yet.</p>}
    </>
  );
}
