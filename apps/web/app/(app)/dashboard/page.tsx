import { and, contract, customer, desc, eq, message_log, serviceDb, sql, storm, trigger_alert } from '@flake/db';
import { fmtLocal } from '@flake/core/time';
import { Badge, buttonVariants, Card, EmptyState, PageHeader, Table, Td, Th } from '@flake/ui';
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
    pendingQuotes: await tx.select({ n: sql<number>`count(*)::int` }).from(contract).where(and(eq(contract.status, 'sent'))),
  }));
  const w = await tenantWeatherHeader(ctx.tenantId);
  const [{ failedMessages } = { failedMessages: 0 }] = await serviceDb().select({ failedMessages: sql<number>`count(*)::int` }).from(message_log).where(and(eq(message_log.tenant_id, ctx.tenantId), eq(message_log.status, 'failed'), sql`${message_log.created_at} > now() - interval '24 hours'`));
  const usage = canSeeUsage(ctx.email) ? await deploymentUsage() : null;
  const fmt = (v: number | null, unit = '"') => (v === null ? 'unavailable' : `${v}${unit}`);
  const setup = [
    { done: data.customers[0]!.n > 0, text: 'Add your first customer', href: '/customers/new' },
    { done: Boolean(ctx.tenant.stripe_charges_enabled), text: 'Connect Stripe to get paid', href: '/settings?tab=payments' },
    { done: ctx.tenant.sms_status === 'approved', text: 'Verify your text number. Links go by email and QR until then.', href: '/settings?tab=sms' },
  ];
  return (
    <>
      <PageHeader title="Dashboard" subtitle={ctx.tenant.name} actions={<Link href="/storms" className={buttonVariants({ variant: 'accent' })}>Start a storm</Link>} />
      {usage?.near_limit ? <p className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-800" data-testid="usage-warning">Storage is nearly full ({usage.files_mb} of {usage.files_limit_mb} MB of files, {usage.db_mb} of {usage.db_limit_mb} MB of database). <Link className="underline" href="/settings?tab=system">See details</Link></p> : null}
      {failedMessages ? <p className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-800" data-testid="messages-failed">{failedMessages === 1 ? '1 message' : `${failedMessages} messages`} could not be sent in the last 24 hours. Flake keeps retrying. <Link className="underline" href="/settings?tab=system">See why</Link></p> : null}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <h2 className="text-sm font-medium text-slate-500">Weather</h2>
          {w.breaker_open ? <p className="mt-2 text-sm text-red-700">Weather unavailable. Polling is paused after repeated errors.</p> : null}
          <p className="mt-2 text-sm">Next 12 h: <b>{fmt(w.forecast_in)}</b></p>
          <p className="text-sm">Elapsed this event: <b>{fmt(w.elapsed_in)}</b></p>
          <p className="text-sm">Temperature: <b>{fmt(w.temp_f, ' F')}</b></p>
          <p className="mt-2 text-xs text-slate-500">Source: {w.source}{w.fetched_at ? `, ${fmtLocal(w.fetched_at, tz)}` : ''}</p>
        </Card>
        <Card className="md:col-span-2">
          <h2 className="text-sm font-medium text-slate-500">Trigger alerts</h2>
          {data.alerts.length ? (
            <ul className="mt-2 divide-y divide-slate-100">
              {data.alerts.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-sm">{a.detail.headline}</span>
                  <Link href={`/alerts/${a.id}`} className={buttonVariants({ size: 'sm', variant: 'accent' })} data-testid="alert-review">Review</Link>
                </li>
              ))}
            </ul>
          ) : <p className="mt-2 text-sm text-slate-600">No open alerts.</p>}
        </Card>
      </div>
      {setup.some((s) => !s.done) ? (
        <Card className="mt-4">
          <h2 className="text-sm font-medium text-slate-500">Finish setup</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {setup.filter((s) => !s.done).map((s) => <li key={s.href}><Link className="text-sky-800 underline" href={s.href}>{s.text}</Link></li>)}
          </ul>
        </Card>
      ) : null}
      <h2 className="mb-2 mt-6 font-semibold">Active storms</h2>
      {data.active.length ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {data.active.map((s) => (
            <Link key={s.id} href={`/storms/${s.id}`} data-testid="active-storm"><Card className="hover:border-sky-400"><div className="font-medium">{s.name}</div><div className="text-sm text-slate-600">Started {fmtLocal(s.started_at, tz)}</div></Card></Link>
          ))}
        </div>
      ) : <EmptyState title="No storm is running" body="Start one by hand, or wait for a trigger alert." />}
      <h2 className="mb-2 mt-6 font-semibold">Recent storms</h2>
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
