import { asc, crew_member, eq, inArray, route, route_stop, site, trigger_alert } from '@flake/db';
import { fmtLocal } from '@flake/core/time';
import { Badge, Card, PageHeader } from '@flake/ui';
import { notFound } from 'next/navigation';
import { asUser, requirePage } from '@/lib/auth';
import { isUuid } from '@/lib/http';
import { AlertActions } from './alert-actions';

export const metadata = { title: 'Trigger alert' };

export default async function AlertPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requirePage();
  const data = await asUser(ctx, async (tx) => {
    const [a] = await tx.select().from(trigger_alert).where(eq(trigger_alert.id, id));
    if (!a) return null;
    const sites = a.site_ids.length ? await tx.select().from(site).where(inArray(site.id, a.site_ids)) : [];
    const stops = a.site_ids.length ? await tx.select().from(route_stop).where(inArray(route_stop.site_id, a.site_ids)).orderBy(asc(route_stop.seq)) : [];
    const routes = await tx.select({ route, crew: crew_member }).from(route).leftJoin(crew_member, eq(crew_member.id, route.default_crew_id));
    return { a, sites, stops, routes };
  });
  if (!data) notFound();
  const { a, sites, stops, routes } = data;
  const grouped = routes.map((r) => ({ ...r, sites: stops.filter((s) => s.route_id === r.route.id).map((s) => sites.find((x) => x.id === s.site_id)!).filter(Boolean) })).filter((g) => g.sites.length);
  const unrouted = sites.filter((s) => !stops.some((x) => x.site_id === s.id));
  const siteDetail = (a.detail.sites ?? []) as { site_id: string; value_in: number | null; label?: string }[];
  return (
    <>
      <PageHeader title={a.detail.headline} subtitle={`${a.kind === 'nws_alert' ? 'National Weather Service alert' : 'Trigger alert'}, ${fmtLocal(a.created_at!, ctx.tenant.timezone)}`} actions={<Badge tone={a.status === 'open' ? 'amber' : 'gray'}>{a.status}</Badge>} />
      <p className="mb-4 text-sm text-slate-600">Flake never dispatches by itself. Nothing happens until you tap Start storm.</p>
      <AlertActions alertId={a.id} status={a.status!} routeIds={grouped.map((g) => g.route.id)} siteIds={a.site_ids} name={`Storm ${fmtLocal(new Date(), ctx.tenant.timezone, { month: 'short', day: 'numeric' })}`} />
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {grouped.map((g) => (
          <Card key={g.route.id}>
            <h2 className="font-semibold">{g.route.name}</h2>
            <p className="text-sm text-slate-600">Suggested crew: {g.crew?.name ?? 'none assigned'}</p>
            <ul className="mt-2 space-y-1 text-sm">
              {g.sites.map((s) => {
                const d = siteDetail.find((x) => x.site_id === s.id);
                return <li key={s.id}>{s.label}{d?.value_in != null ? `: ${d.value_in}"` : d?.label ? `: ${d.label}` : ''}</li>;
              })}
            </ul>
          </Card>
        ))}
        {unrouted.length ? (
          <Card>
            <h2 className="font-semibold text-amber-800">Not on any route</h2>
            <ul className="mt-2 space-y-1 text-sm">{unrouted.map((s) => <li key={s.id}>{s.label}</li>)}</ul>
          </Card>
        ) : null}
      </div>
      <p className="mt-6 text-xs text-slate-500">Forecast snapshots attached: {a.snapshot_ids.length}. They go on the storm record when you start it.</p>
    </>
  );
}
