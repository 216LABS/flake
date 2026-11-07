import { and, contract, customer, desc, eq, message_log, run_stop, serviceDb, sql, storm, storm_run, trigger_alert } from '@flake/db';
import { fmtLocal } from '@flake/core/time';
import { Badge, buttonVariants, Card, EmptyState, Eyebrow, PageHeader, Progress, Stat, Table, Td, Th } from '@flake/ui';
import Link from 'next/link';
import { asUser, requirePage } from '@/lib/auth';
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
    progress: await tx.select({ storm_id: storm_run.storm_id, finished: sql<number>`count(*) filter (where ${run_stop.status} in ('done', 'skipped'))::int`, total: sql<number>`count(*)::int` }).from(run_stop).innerJoin(storm_run, eq(storm_run.id, run_stop.storm_run_id)).innerJoin(storm, eq(storm.id, storm_run.storm_id)).where(eq(storm.status, 'active')).groupBy(storm_run.storm_id),
    pendingQuotes: await tx.select({ n: sql<number>`count(*)::int` }).from(contract).where(and(eq(contract.status, 'sent'))),
  }));
  const w = await tenantWeatherHeader(ctx.tenantId);
  const [{ failedMessages } = { failedMessages: 0 }] = await serviceDb().select({ failedMessages: sql<number>`count(*)::int` }).from(message_log).where(and(eq(message_log.tenant_id, ctx.tenantId), eq(message_log.status, 'failed'), sql`${message_log.created_at} > now() - interval '24 hours'`));
  const usage = canSeeUsage(ctx.email) ? await deploymentUsage() : null;
  const fmt = (v: number | null, unit = '"') => (v === null ? 'unavailable' : `${v}${unit}`);
  const canEdit = ctx.role !== 'viewer';
  const setup = ctx.role !== 'owner' ? [] : [
    { done: data.customers[0]!.n > 0, text: 'Add your first customer', href: '/customers/new' },
    { done: Boolean(ctx.tenant.stripe_charges_enabled), text: 'Connect Stripe to get paid', href: '/settings?tab=payments' },
    { done: ctx.tenant.sms_status === 'approved', text: 'Verify your text number. Links go by email and QR until then.', href: '/settings?tab=sms' },
  ];
  return (
    <>
      <PageHeader title="Dashboard" subtitle={ctx.tenant.name} actions={canEdit ? <Link href="/storms" className={buttonVariants({ variant: 'accent' })}>Start a storm</Link> : null} />
      {usage?.near_limit ? <p className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-800" data-testid="usage-warning">Storage is nearly full ({usage.files_mb} of {usage.files_limit_mb} MB of files, {usage.db_mb} of {usage.db_limit_mb} MB of database). <Link className="underline" href="/settings?tab=system">See details</Link></p> : null}
      {failedMessages ? <p className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-800" data-testid="messages-failed">{failedMessages === 1 ? '1 message' : `${failedMessages} messages`} could not be sent in the last 24 hours. Flake keeps retrying. <Link className="underline" href="/settings?tab=system">See why</Link></p> : null}
      <section className="overflow-hidden rounded-md bg-slate-950 text-white" data-testid="conditions">
        <div className="flex flex-wrap items-end gap-x-10 gap-y-4 p-5">
          <Stat label="Next 12 h" value={fmt(w.forecast_in)} />
          <Stat label="Elapsed this event" value={fmt(w.elapsed_in)} />
          <Stat label="Temperature" value={fmt(w.temp_f, ' F')} />
          <p className="ml-auto text-xs text-slate-300">{w.breaker_open ? 'Weather unavailable. Polling is paused after repeated errors. ' : ''}Source: {w.source}{w.fetched_at ? `, ${fmtLocal(w.fetched_at, tz)}` : ''}</p>
        </div>
      </section>
      <div className={`mt-6 grid grid-cols-1 gap-6 ${setup.some((s) => !s.done) ? 'lg:grid-cols-3' : ''}`}>
        <div className={`space-y-6 ${setup.some((s) => !s.done) ? 'lg:col-span-2' : ''}`}>
          <section>
            <Eyebrow className="mb-2">Trigger alerts</Eyebrow>
            {data.alerts.length ? (
              <ul className="divide-y divide-slate-200 rounded-md border border-beacon bg-white">
                {data.alerts.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                    <span className="min-w-0 text-sm font-medium">{a.detail.headline}</span>
                    <Link href={`/alerts/${a.id}`} className={buttonVariants({ size: 'sm', variant: 'accent' })} data-testid="alert-review">Review</Link>
                  </li>
                ))}
              </ul>
            ) : <p className="rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-600">No open alerts.</p>}
          </section>
          <section>
            <Eyebrow className="mb-2">Active storms</Eyebrow>
            {data.active.length ? (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {data.active.map((s) => {
                  const p = data.progress.find((x) => x.storm_id === s.id);
                  return (
                    <Link key={s.id} href={`/storms/${s.id}`} data-testid="active-storm">
                      <Card className="transition-colors hover:border-slate-900">
                        <div className="flex items-start justify-between gap-2"><div className="font-display text-lg font-semibold leading-tight">{s.name}</div><Badge tone="amber">Live</Badge></div>
                        <div className="mt-0.5 text-xs text-slate-600">Started {fmtLocal(s.started_at, tz)}</div>
                        <Progress className="mt-3" value={p?.finished ?? 0} max={p?.total ?? 0} label={`Stops finished in ${s.name}`} />
                        <div className="tabular mt-1.5 text-sm font-medium text-slate-900" data-testid="storm-progress">{p ? `${p.finished} of ${p.total} stops finished` : 'No stops yet'}</div>
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
            <ul className="divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
              {setup.filter((s) => !s.done).map((s) => <li key={s.href}><Link className="block p-3 text-sm font-medium text-slate-900 hover:bg-slate-50" href={s.href}>{s.text}</Link></li>)}
            </ul>
          </section>
        ) : null}
      </div>
      <Eyebrow className="mb-2 mt-6">Recent storms</Eyebrow>
      {data.recent.length ? (
        <Table>
          <thead><tr><Th>Storm</Th><Th>Started</Th><Th>Status</Th><Th></Th></tr></thead>
          <tbody>
            {data.recent.map((s) => (
              <tr key={s.id}>
                <Td><Link className="text-sky-800 underline" href={`/storms/${s.id}`}>{s.name}</Link></Td>
                <Td>{fmtLocal(s.started_at, tz)}</Td>
                <Td><Badge tone={s.status === 'billed' ? 'green' : 'amber'}>{s.status}</Badge></Td>
                <Td><Link className="text-sky-800 underline" href={`/billing?storm=${s.id}`}>Billing</Link></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : <p className="text-sm text-slate-600">None yet.</p>}
    </>
  );
}
