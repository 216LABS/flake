import { and, contract, crew_member, customer, desc, eq, message_log, route_stop, run_stop, serviceDb, sql, storm, storm_run, trigger_alert } from '@flake/db';
import { fmtLocal } from '@flake/core/time';
import { Badge, buttonVariants, Card, EmptyState, Eyebrow, PageHeader, Progress, Stat, Table, Td, Th } from '@flake/ui';
import Link from 'next/link';
import { asUser, requirePage } from '@/lib/auth';
import { stormStatus } from '@/lib/labels';
import { canSeeUsage, deploymentUsage } from '@/lib/usage';
import { tenantWeatherHeader } from '@/lib/weather';

export const metadata = { title: 'Dashboard' };

export default async function Dashboard() {
  const ctx = await requirePage();
  const tz = ctx.tenant.timezone;
  const data = await asUser(ctx, async (tx) => ({
    alerts: await tx.select().from(trigger_alert).where(eq(trigger_alert.status, 'open')).orderBy(desc(trigger_alert.created_at)).limit(10),
    active: await tx.select().from(storm).where(eq(storm.status, 'active')).orderBy(desc(storm.started_at)),
    recent: await tx.select().from(storm).where(sql`${storm.status} <> 'active'`).orderBy(desc(storm.started_at)).limit(5),
    customers: await tx.select({ n: sql<number>`count(*)::int` }).from(customer),
    crew: await tx.select({ n: sql<number>`count(*)::int` }).from(crew_member).where(eq(crew_member.active, true)),
    routed: await tx.select({ n: sql<number>`count(*)::int` }).from(route_stop),
    progress: await tx.select({ storm_id: storm_run.storm_id, finished: sql<number>`count(*) filter (where ${run_stop.status} in ('done', 'skipped'))::int`, total: sql<number>`count(*)::int` }).from(run_stop).innerJoin(storm_run, eq(storm_run.id, run_stop.storm_run_id)).innerJoin(storm, eq(storm.id, storm_run.storm_id)).where(eq(storm.status, 'active')).groupBy(storm_run.storm_id),
    pendingQuotes: await tx.select({ n: sql<number>`count(*)::int` }).from(contract).where(and(eq(contract.status, 'sent'))),
  }));
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
  const setup = ctx.role !== 'owner' ? [] : [
    { done: data.customers[0]!.n > 0, text: 'Add your first customer', href: '/customers/new' },
    { done: data.crew[0]!.n > 0, text: 'Invite your drivers', href: '/settings?tab=crew' },
    { done: data.routed[0]!.n > 0, text: 'Put your lots on a route, so a storm knows where to go', href: '/routes' },
    { done: Boolean(ctx.tenant.stripe_charges_enabled), text: 'Connect Stripe to get paid', href: '/settings?tab=payments' },
    { done: ctx.tenant.sms_status === 'approved', text: 'Verify your text number. Links go by email and QR until then.', href: '/settings?tab=sms' },
  ];
  return (
    <>
      <PageHeader title="Dashboard" subtitle={ctx.tenant.name} actions={canEdit ? <Link href="/storms#start" className={buttonVariants({ variant: 'accent' })}>Start a storm</Link> : null} />
      {usage?.near_limit ? <p className="mb-4 rounded-md bg-danger-tint p-3 text-sm text-danger" data-testid="usage-warning">Storage is nearly full ({usage.files_mb} of {usage.files_limit_mb} MB of files, {usage.db_mb} of {usage.db_limit_mb} MB of database). <Link className="underline" href="/settings?tab=system">See details</Link></p> : null}
      {failedMessages ? <p className="mb-4 rounded-md bg-danger-tint p-3 text-sm text-danger" data-testid="messages-failed">{failedMessages === 1 ? '1 message' : `${failedMessages} messages`} could not be sent in the last 24 hours. {retrying ? 'Flake is still retrying.' : 'Flake has stopped retrying. Check the address, then send again from the driver or customer.'} <Link className="underline" href="/settings?tab=system">See why</Link></p> : null}
      {rejectedMessages ? <p className="mb-4 rounded-md bg-warn-tint p-3 text-sm text-warn-ink" data-testid="messages-rejected">{rejectedMessages === 1 ? '1 message was' : `${rejectedMessages} messages were`} not delivered because the email address or phone number was rejected. Fix it on the driver or customer, and route links go out again. <Link className="underline" href="/settings?tab=system">See which</Link></p> : null}
      <section className="overflow-hidden rounded-md bg-slate-950 text-white" data-testid="conditions">
        <div className="flex flex-wrap items-end gap-x-10 gap-y-4 p-5">
          <Stat label="Next 12 h" value={fmt(w.forecast_in)} />
          <Stat label="Elapsed this event" value={fmt(w.elapsed_in)} />
          <Stat label="Temperature" value={fmt(w.temp_f, ' F')} />
          <p className="ml-auto text-xs text-slate-300">{w.reason ? `${w.reason} ` : ''}Live forecast. Source: {w.source}{w.fetched_at ? `, ${fmtLocal(w.fetched_at, tz)}` : ''}</p>
        </div>
      </section>
      <div className={`mt-6 grid grid-cols-1 gap-6 ${setup.some((s) => !s.done) ? 'lg:grid-cols-3' : ''}`}>
        <div className={`space-y-6 ${setup.some((s) => !s.done) ? 'lg:col-span-2' : ''}`}>
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
                        <div className="mt-0.5 text-xs text-muted">Started {fmtLocal(s.started_at, tz)}</div>
                        <Progress className="mt-3" value={p?.finished ?? 0} max={p?.total ?? 0} label={`Stops finished in ${s.name}`} />
                        <div className="tabular mt-1.5 text-sm font-medium text-ink" data-testid="storm-progress">{p ? `${p.finished} of ${p.total} stops finished` : 'No stops yet'}</div>
                      </Card>
                    </Link>
                  );
                })}
              </div>
            ) : <EmptyState title="No storm is running" body="Start one by hand, or wait for a trigger alert." />}
          </section>
        </div>
        {setup.some((s) => !s.done) ? (
          <section>
            <Eyebrow className="mb-2">Finish setup</Eyebrow>
            <ul className="divide-y divide-line-faint rounded-md border border-line-faint bg-surface">
              {setup.filter((s) => !s.done).map((s) => <li key={s.href}><Link className="block p-3 text-sm font-medium text-ink hover:bg-tint" href={s.href}>{s.text}</Link></li>)}
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
                <Td label="Started">{fmtLocal(s.started_at, tz)}</Td>
                <Td label="Status"><Badge tone={stormStatus(s.status).tone}>{stormStatus(s.status).word}</Badge></Td>
                <Td><Link className="text-link underline" href={`/billing?storm=${s.id}`}>Billing</Link></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : <p className="text-sm text-muted">None yet.</p>}
    </>
  );
}
