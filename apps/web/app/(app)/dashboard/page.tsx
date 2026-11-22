import { and, contract, crew_member, customer, desc, eq, isNull, message_log, push_subscription, route, route_stop, serviceDb, site, sql, storm, trigger_alert } from '@flake/db';
import { fmtLocal, stormWhen } from '@flake/core/time';
import { Badge, buttonVariants, Eyebrow, PageHeader, Stat, Table, Td, Th } from '@flake/ui';
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
import { areaWeather, tenantWeatherHeader } from '@/lib/weather';
import { available, getProviders, getSetting } from '@/lib/providers';
import { openBills } from '@/lib/receivables';
import { liveStorms } from '@/lib/live';
import { ButtonLink, entityLink } from '@/components/links';
import { LiveBanner } from '../storms/live-banner';
import { HowItWorks } from './how-it-works';

export const metadata = { title: 'Dashboard' };

export default async function Dashboard() {
  const ctx = await requirePage();
  const tz = ctx.tenant.timezone;
  const data = await asUser(ctx, async (tx) => ({
    alerts: await tx.select().from(trigger_alert).where(eq(trigger_alert.status, 'open')).orderBy(desc(trigger_alert.created_at)).limit(10),
    recent: await tx.select({ id: storm.id, name: storm.name, started_at: storm.started_at, status: storm.status, billedNothing: sql<boolean>`not exists (select 1 from invoice_draft d where d.storm_id = ${storm.id} and d.status <> 'void')` }).from(storm).where(sql`${storm.status} <> 'active'`).orderBy(desc(storm.started_at)).limit(5),
    // Active customers decide the first-run card, Start a storm and the checklist; archived ones only change the words (issue 139).
    customers: await tx.select({ n: sql<number>`(count(*) filter (where ${customer.archived_at} is null))::int`, all: sql<number>`count(*)::int` }).from(customer),
    crew: await tx.select({ n: sql<number>`count(*)::int` }).from(crew_member).where(eq(crew_member.active, true)),
    routed: await tx.select({ n: sql<number>`count(*)::int` }).from(route_stop).innerJoin(route, eq(route.id, route_stop.route_id)).innerJoin(site, eq(site.id, route_stop.site_id)).where(and(isNull(route.archived_at), eq(site.active, true))),
    // Quotes waiting for a signature, whether emailed or handed over as a link (issue 92), on lots still in service, the
    // same set Customers' "Quote waiting" filter lists.
    pendingQuotes: await tx.select({ n: sql<number>`count(distinct coalesce(${contract.quote_token_hash}, ${contract.id}::text))::int` }).from(contract).innerJoin(site, eq(site.id, contract.site_id)).where(and(sql`${contract.status} in ('sent', 'draft')`, eq(site.active, true))),
    // What customers still owe, after part payments, with how late (issue 188).
    owed: ctx.role === 'viewer' ? [] : await openBills(tx, tz),
    live: await liveStorms(tx, tz),
    storms: (await tx.select({ n: sql<number>`count(*)::int`, billed: sql<number>`(count(*) filter (where ${storm.status} = 'billed'))::int` }).from(storm))[0]!,
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
  // One line per customer: what they owe in all, how many bills, and the oldest one's days late.
  const owedBy = [...data.owed.reduce((m, r) => {
    const x = m.get(r.customer_id) ?? { id: r.customer_id, name: r.customer, cents: 0, n: 0, late: 0 };
    x.cents += r.balance_cents;
    x.n += 1;
    x.late = Math.max(x.late, r.days_late);
    return m.set(r.customer_id, x);
  }, new Map<string, { id: string; name: string; cents: number; n: number; late: number }>()).values()].sort((a, b) => b.late - a.late || b.cents - a.cents);
  const owedTotal = owedBy.reduce((n, r) => n + r.cents, 0);
  // Customers' "come back" requests from their records page, one per lot and hour, for a week (issue 5).
  const requests = (await serviceDb().execute(sql`
    select distinct on (m.related->>'site_id', date_trunc('hour', m.created_at), coalesce(m.related->>'note', '')) m.related->>'site_id' as site_id, m.related->>'customer_id' as customer_id, m.related->>'note' as note, m.created_at, s.label, c.name
    from message_log m join site s on s.id = (m.related->>'site_id')::uuid join customer c on c.id = s.customer_id
    where m.tenant_id = ${ctx.tenantId} and m.related->>'kind' = 'visit_request' and m.created_at > now() - interval '7 days'
    order by m.related->>'site_id', date_trunc('hour', m.created_at), coalesce(m.related->>'note', ''), m.created_at`)) as unknown as { site_id: string; customer_id: string; note: string | null; created_at: string; label: string; name: string }[];
  requests.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const w = await tenantWeatherHeader(ctx.tenantId);
  // A row per service area when there's more than one (issue 198).
  const areas = await areaWeather(ctx.tenantId);
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
  // Snow alerts reach the owner by push even while the company's email and texts are off (D19), but only on a phone
  // that turned them on. Without it, the first trigger alert waits on this dashboard unseen.
  const pushReady = ctx.role === 'owner' && Boolean((await getProviders()).push.publicKey);
  const pushOn = pushReady ? (await serviceDb().select({ id: push_subscription.id }).from(push_subscription).where(and(eq(push_subscription.tenant_id, t.id), eq(push_subscription.user_id, ctx.userId))).limit(1)).length > 0 : false;
  const setup: { done: boolean; text: string; href: string; more?: { text: string; href: string }; optional?: boolean }[] = ctx.role !== 'owner' ? [] : [
    { done: Boolean(t.business_legal_name?.trim()) && hasAddress, text: 'Add your legal business name and address', href: can.sms ? '/settings?tab=sms' : '/settings?tab=company' },
    { done: rateChecked, text: 'Check your prices. Flake starts with typical ones.', href: '/settings?tab=rate' },
    { done: data.customers[0]!.n > 0, text: data.customers[0]!.all ? 'Add a customer' : 'Add your first customer and lot', href: '/customers/new', more: { text: 'Have a list? Import it', href: '/customers/import' } },
    { done: data.crew[0]!.n > 0, text: 'Add your drivers', href: '/settings?tab=crew', more: { text: 'Have a list? Import it', href: '/settings/crew-import' } },
    { done: data.routed[0]!.n > 0, text: 'Put your lots on a route, so a storm knows where to go', href: '/routes' },
    ...(pushReady ? [{ done: pushOn, text: 'Turn on snow alerts on your phone, so a trigger reaches you at 3 AM', href: '/settings?tab=alerts' }] : []),
    ...(can.payments ? [{ done: Boolean(t.stripe_charges_enabled), text: 'Connect Stripe to get paid by card or bank', href: '/settings?tab=payments' }] : []),
    // Without Stripe, a customer's bill only says "pay the way you usually do" until this is filled in (issue 216).
    ...(!t.stripe_charges_enabled ? [{ done: Boolean(t.pay_instructions?.trim()), text: 'Tell customers how to pay you (check to, Zelle, Venmo...)', href: '/settings?tab=payments' }] : []),
    ...(can.sms ? [{ done: t.sms_status === 'approved', text: t.sms_status === 'pending' ? 'Text number: waiting on verification (3 to 5 business days)' : 'Get your text number verified. Crew links go by QR and copy-link until then.', href: '/settings?tab=sms' }] : []),
    { done: Boolean(t.logo_path), text: 'Add your logo for quotes and bills', href: '/settings?tab=company', optional: true },
  ];
  const quotes = data.pendingQuotes[0]!.n;
  const step = data.customers[0]!.n === 0 ? 0 : data.routed[0]!.n === 0 ? 1 : data.storms.n === 0 ? 2 : 3;
  const needs = Boolean(requests.length || renewNow || insurance.length || lowSalt.length || data.service.length);
  const showSetup = setup.some((s) => !s.done && !s.optional);
  return (
    <>
      <PageHeader title="Dashboard" subtitle={ctx.tenant.name} actions={canEdit && data.routed[0]!.n > 0 && !data.live.length ? <Link href="/storms#start" className={buttonVariants({ variant: 'accent' })}>Start a storm</Link> : null} />
      {/* (a) The storm being worked, first (issues 187, 188). */}
      <LiveBanner storms={data.live} />
      {/* Things that are wrong right now: the sentence, then one button. */}
      {usage?.near_limit ? <Notice tone="danger" testId="usage-warning" text={`Storage is nearly full (${usage.files_mb} of ${usage.files_limit_mb} MB of files, ${usage.db_mb} of ${usage.db_limit_mb} MB of database).`} action={<ButtonLink size="sm" href="/settings?tab=system">See details</ButtonLink>} /> : null}
      {failedMessages ? <Notice tone="danger" testId="messages-failed" text={`${failedMessages === 1 ? '1 message' : `${failedMessages} messages`} could not be sent in the last 24 hours. ${retrying ? 'Flake is still retrying.' : 'Flake has stopped retrying. Check the address, then send again from the driver or customer.'}`} action={<ButtonLink size="sm" href="/settings?tab=system">See why</ButtonLink>} /> : null}
      {rejectedMessages ? <Notice tone="warn" testId="messages-rejected" text={`${rejectedMessages === 1 ? '1 message was' : `${rejectedMessages} messages were`} not delivered because the email address or phone number was rejected. Fix it on the driver or customer, and route links go out again.`} action={<ButtonLink size="sm" href="/settings?tab=system">See which</ButtonLink>} /> : null}
      {canEdit && data.customers[0]!.n > 0 && data.routed[0]!.n === 0 ? <Notice tone="info" testId="needs-route" text="Next: put your lots on a route. A storm sends each route to one truck." action={<ButtonLink size="sm" variant="accent" href="/routes">Open Routes</ButtonLink>} /> : null}
      {/* Issue 171: every company starts with sending off; say so where the office looks first. */}
      {canEdit && !ctx.tenant.outbound_enabled ? <Notice tone="info" testId="sending-off" text="Flake isn't sending email or texts for your company yet, so bills, quotes and notices stay inside Flake. 216LABS turns sending on when your company is approved. Until then, share links yourself: each quote, bill and driver page has one." /> : null}
      {/* A brand-new company has no lots, so no forecast to show yet: say what comes first instead of "unavailable" (issue 129). */}
      {data.customers[0]!.n === 0 ? (
        <section className="mb-6 rounded-md bg-slate-950 p-5 text-white" data-testid="first-run">
          <h2 className="font-display text-xl font-semibold">{data.customers[0]!.all ? 'No active customers' : 'Welcome to Flake'}</h2>
          <p className="mt-1 text-sm text-slate-300">{data.customers[0]!.all ? 'Every customer is archived. Add one, or restore one from Archived customers.' : 'Add a customer and their lot.'} The snow forecast for your lots shows here once there&apos;s one to watch.</p>
          {canEdit ? <div className="mt-3 flex flex-wrap gap-2"><Link href="/customers/new" className={buttonVariants({ variant: 'accent' })}>Add your first customer</Link><Link href="/customers/import" className={buttonVariants({ variant: 'outline', className: 'text-ink' })}>Import a list</Link></div> : null}
        </section>
      ) : (
        <section className="mb-6 overflow-hidden rounded-md bg-slate-950 text-white" data-testid="conditions">
          {areas.length > 1 ? (
            <div className="p-4" data-testid="area-weather">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs uppercase tracking-wider text-slate-300"><th className="pb-2 font-semibold">Area</th><th className="pb-2 font-semibold">Next 12 h</th><th className="pb-2 font-semibold max-sm:hidden">Elapsed</th><th className="pb-2 font-semibold max-sm:hidden">Temp</th><th className="pb-2 font-semibold">Trigger</th></tr></thead>
                <tbody>
                  {areas.map((a) => (
                    <tr key={a.area} className="border-t border-slate-800" data-testid="area-row">
                      <td className="py-2 font-semibold">{a.area}<span className="block text-xs font-normal text-slate-400">{a.lots} {a.lots === 1 ? 'lot' : 'lots'}</span></td>
                      <td className="tabular py-2 font-display text-xl">
                        {fmt(a.forecast_in)}
                        {/* Issue 203: the Blend of models' spread, and radar when it's coming down now. */}
                        {a.range_in ? <span className="block font-sans text-xs text-slate-400" data-testid="area-range">Models: {a.range_in[0]} to {a.range_in[1]}&quot;</span> : null}
                        {a.radar_1h_in ? <span className="block font-sans text-xs text-sky-300" data-testid="area-radar">Radar: {a.radar_1h_in}&quot; last hour</span> : null}
                      </td>
                      <td className="tabular py-2 max-sm:hidden">{fmt(a.elapsed_in)}</td>
                      <td className="tabular py-2 max-sm:hidden">{fmt(a.temp_f, ' F')}</td>
                      {/* Plow vs salt vs nothing, and why (issue 204): "0.5" + freezing rain, salt only". */}
                      <td className="py-2" data-testid="area-trigger">
                        {a.trigger.plow ? <span className="font-bold text-beacon">{a.trigger.text}</span> : a.trigger.salt ? <span className="font-semibold text-amber-300">{a.trigger.text}</span> : <span className="text-slate-400">{a.trigger.text}</span>}
                        {a.at_trigger ? <span className="block text-xs text-slate-300">{a.at_trigger} {a.at_trigger === 1 ? 'lot' : 'lots'} at plow trigger</span> : a.near_trigger ? <span className="block text-xs text-amber-300">{a.near_trigger} close to plow trigger</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-slate-300">{w.source === 'unavailable' ? (w.reason ?? 'No forecast yet for your lots.') : `Live forecast by area. Source: ${w.source}${w.fetched_at ? `, ${fmtLocal(w.fetched_at, tz)}` : ''}`}</p>
            </div>
          ) : (
          <div className="flex flex-wrap items-end gap-x-10 gap-y-4 p-5">
            <Stat label="Next 12 h" value={fmt(w.forecast_in)} />
            <Stat label="Elapsed this event" value={fmt(w.elapsed_in)} />
            <Stat label="Temperature" value={fmt(w.temp_f, ' F')} />
            {areas[0]?.range_in ? <Stat label="Models agree on" value={`${areas[0].range_in[0]} to ${areas[0].range_in[1]}"`} /> : null}
            {areas[0] && areas[0].trigger.text !== 'No trigger' ? <p className="text-sm font-semibold text-beacon" data-testid="area-trigger">{areas[0].trigger.text}</p> : null}
            {areas[0]?.radar_1h_in ? <p className="text-sm text-sky-300" data-testid="area-radar">Radar: {areas[0].radar_1h_in}&quot; of precipitation in the last hour</p> : null}
            <p className="ml-auto max-w-md text-xs text-slate-300">{w.source === 'unavailable' ? (w.reason ?? 'No forecast yet for your lots.') : `Live forecast. Source: ${w.source}${w.fetched_at ? `, ${fmtLocal(w.fetched_at, tz)}` : ''}`}</p>
          </div>
          )}
        </section>
      )}
      {data.storms.billed === 0 && canEdit ? <HowItWorks step={step} /> : null}
      <div className={`grid grid-cols-1 gap-6 ${showSetup ? 'lg:grid-cols-3' : ''}`}>
        <div className={`space-y-6 ${showSetup ? 'lg:col-span-2' : ''}`}>
          {/* (b) Snow alerts: the one section that says so when it's empty. */}
          <section>
            <Eyebrow className="mb-2">Snow alerts</Eyebrow>
            {data.alerts.length ? (
              <ul className="divide-y divide-line-faint rounded-md border border-beacon bg-surface">
                {data.alerts.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                    <span className="min-w-0 text-sm font-medium">{a.detail.headline}</span>
                    <Link href={`/alerts/${a.id}`} className={buttonVariants({ size: 'sm', variant: 'accent' })} data-testid="alert-review">Review</Link>
                  </li>
                ))}
              </ul>
            ) : <p className="rounded-md border border-line-faint bg-surface p-3 text-sm text-muted">No snow alerts. Flake checks each lot&apos;s forecast and shows an alert here when one reaches its trigger.</p>}
            {!data.live.length ? <p className="mt-2 text-sm text-muted" data-testid="no-storm">No storm is running. {canEdit ? 'Start one by hand, or wait for a trigger alert.' : 'The office starts one when snow is coming.'}</p> : null}
          </section>
          {/* (c) Needs you today. */}
          {needs ? (
            <section data-testid="needs-you">
              <Eyebrow className="mb-2">Needs you today</Eyebrow>
              <div className="grid gap-3 md:grid-cols-2">
                {requests.length ? (
                  <ActionCard title="Customers asking for a visit" testId="visit-requests" body="They asked from their records page in the last week." action={<ButtonLink size="sm" href="/storms">Go to storms</ButtonLink>}>
                    <ul className="mt-2 space-y-1 text-sm">
                      {requests.slice(0, 6).map((r) => <li key={`${r.site_id}:${r.created_at}`}><Link className={entityLink} href={`/customers/${r.customer_id}`}>{r.name}</Link>, {r.label}{r.note ? `: "${r.note}"` : ''} <span className="text-xs text-muted">{fmtLocal(r.created_at, tz)}</span></li>)}
                    </ul>
                  </ActionCard>
                ) : null}
                {renewNow ? <ActionCard title="Renewals" testId="renewals-due" body={`${renewNow.rows.length} ${renewNow.rows.length === 1 ? 'lot has' : 'lots have'} no quote yet for ${renewNow.next}.`} action={<ButtonLink size="sm" variant="accent" href="/bids">Renew them</ButtonLink>} /> : null}
                {insurance.length ? (
                  <ActionCard title="Insurance" testId="insurance-alerts" body="Certificates ending soon or ended, and subs without cover." action={<ButtonLink size="sm" href="/compliance">Open insurance and claims</ButtonLink>}>
                    <ul className="mt-2 space-y-1 text-sm">{insurance.slice(0, 4).map((a, i) => <li key={i} className="flex flex-wrap gap-2"><Badge tone={a.tone}>{a.tone === 'red' ? 'Act now' : 'Soon'}</Badge><span className="wrap-anywhere">{a.text}</span></li>)}</ul>
                  </ActionCard>
                ) : null}
                {lowSalt.length ? (
                  <ActionCard title="Salt is low" testId="salt-reorder" tone="warn" body={lowSalt.map((y) => `${y.yard.name}: ${y.tons} t on hand (reorder at ${Number(y.yard.reorder_tons)} t).`).join(' ')} action={<ButtonLink size="sm" variant="accent" href="/salt">Order salt</ButtonLink>} />
                ) : null}
                {data.service.length ? (
                  <ActionCard title="Truck service" testId="service-due" body="Service due soon or overdue." action={<ButtonLink size="sm" href="/settings?tab=equipment">Open equipment</ButtonLink>}>
                    <ul className="mt-2 space-y-1 text-sm">
                      {data.service.slice(0, 6).map((m) => (
                        <li key={m.id} className="flex flex-wrap items-center gap-2" data-testid="service-row">
                          <Badge tone={m.status.state === 'overdue' ? 'red' : 'amber'}>{m.status.state === 'overdue' ? 'Overdue' : 'Due soon'}</Badge>
                          <span className="wrap-anywhere"><b>{m.truck_name}</b>: {m.name}</span>
                          <span className="text-muted">{m.status.detail}</span>
                        </li>
                      ))}
                      {data.service.length > 6 ? <li className="text-xs text-muted">And {data.service.length - 6} more.</li> : null}
                    </ul>
                  </ActionCard>
                ) : null}
              </div>
            </section>
          ) : null}
          {/* (d) Money: unsigned quotes and money owed are different things, so two cards (issue 188). */}
          {owedTotal || quotes ? (
            <section data-testid="waiting-on">
              <Eyebrow className="mb-2">Money</Eyebrow>
              <div className="grid gap-3 md:grid-cols-2">
                {quotes ? <ActionCard title="Quotes not signed yet" testId="quotes-waiting" body={`${quotes === 1 ? '1 quote is' : `${quotes} quotes are`} waiting for a signature. Until a customer signs, their lots aren't billed and don't get snow alerts.`} action={<ButtonLink size="sm" href="/customers?waiting=1">See unsigned quotes</ButtonLink>} /> : null}
                {owedTotal ? (
                  <ActionCard title="Money owed to you" testId="owed-total" body={`${money(owedTotal)} from ${owedBy.length === 1 ? '1 customer' : `${owedBy.length} customers`}.`} action={<ButtonLink size="sm" variant="accent" href="/receivables" data-testid="open-receivables">Open receivables</ButtonLink>}>
                    <ul className="mt-2 space-y-0.5 text-sm">
                      {owedBy.slice(0, 6).map((r) => <li key={r.id} className="flex flex-wrap justify-between gap-x-3"><span><Link className={entityLink} href={`/customers/${r.id}`}>{r.name}</Link>: <span className="tabular">{money(r.cents)}</span>{r.n > 1 ? ` (${r.n} bills)` : ''}</span>{r.late > 0 ? <span className="text-xs font-semibold text-warn-ink">{r.late} {r.late === 1 ? 'day' : 'days'} late</span> : null}</li>)}
                    </ul>
                    {owedBy.length > 6 ? <p className="mt-1 text-xs text-muted">And {owedBy.length - 6} more customers.</p> : null}
                  </ActionCard>
                ) : null}
              </div>
            </section>
          ) : null}
        </div>
        {/* (e) Setup for a new company. */}
        {showSetup ? (
          <section data-testid="setup-checklist">
            <Eyebrow className="mb-2">Finish setup: {setup.filter((s) => s.done).length} of {setup.length} done</Eyebrow>
            <ul className="divide-y divide-line-faint rounded-md border border-line-faint bg-surface">
              {setup.map((s) => (
                <li key={s.text} className="p-3 text-sm" data-testid="setup-step" data-done={s.done ? 'yes' : 'no'}>
                  {s.done ? (
                    <span className="flex items-start gap-2 text-muted"><span aria-hidden="true" className="text-ok-ink">✓</span><span><span className="sr-only">Done: </span>{s.text}</span></span>
                  ) : (
                    <span className="flex items-start gap-2"><span aria-hidden="true" className="text-faint">○</span><span><Link className={entityLink} href={s.href}>{s.text}</Link>{s.optional ? <span className="text-muted"> (optional)</span> : null}{s.more ? <ButtonLink size="sm" variant="ghost" className="-ml-3 mt-0.5 flex w-fit" href={s.more.href}>{s.more.text}</ButtonLink> : null}</span></span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
      {/* (f) Recent storms. */}
      {data.recent.length ? (
        <>
          <Eyebrow className="mb-2 mt-6">Recent storms</Eyebrow>
          <Table stack>
            <thead><tr><Th>Storm</Th><Th>Started</Th><Th>Status</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
            <tbody>
              {data.recent.map((s) => (
                <tr key={s.id}>
                  <Td><Link className={entityLink} href={`/storms/${s.id}`}>{s.name}</Link></Td>
                  <Td label="Started">{stormWhen(s.started_at, tz)}</Td>
                  <Td label="Status"><Badge tone={stormStatus(s.status ?? '', s.billedNothing).tone}>{stormStatus(s.status ?? '', s.billedNothing).word}</Badge></Td>
                  <Td><ButtonLink size="sm" href={`/billing?storm=${s.id}`}>Billing</ButtonLink></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      ) : null}
    </>
  );
}

/** One thing that needs the office: a heading, one sentence, at most one button (issue 188). */
function ActionCard({ title, body, action, testId, tone, children }: { title: string; body: string; action?: React.ReactNode; testId?: string; tone?: 'warn'; children?: React.ReactNode }) {
  return (
    <div className={tone === 'warn' ? 'rounded-md border border-warn-line bg-warn-tint p-4 text-warn-ink' : 'rounded-md border border-line-faint bg-surface p-4'} data-testid={testId}>
      <h3 className="font-semibold text-ink">{title}</h3>
      <p className="mt-1 text-sm">{body}</p>
      {children}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

/** A banner across the top: the sentence, then the button, never a link inside the sentence. */
function Notice({ tone, text, action, testId }: { tone: 'danger' | 'warn' | 'info'; text: string; action?: React.ReactNode; testId: string }) {
  const color = { danger: 'bg-danger-tint text-danger', warn: 'bg-warn-tint text-warn-ink', info: 'bg-info-tint text-ink' }[tone];
  return (
    <div className={`mb-4 flex flex-wrap items-center gap-3 rounded-md p-3 text-sm ${color}`} data-testid={testId}>
      <p className="min-w-0 flex-1">{text}</p>
      {action}
    </div>
  );
}
