import { asc, contract, crew_member, eq, isNotNull, isNull, route, route_stop, site } from '@flake/db';
import { Card, EmptyState, PageHeader } from '@flake/ui';
import Link from 'next/link';
import { asUser, requirePage } from '@/lib/auth';
import { RestoreRoute } from './restore-route';
import { RoutesEditor } from './routes-editor';

export const metadata = { title: 'Routes' };

export default async function Routes({ searchParams }: { searchParams: Promise<{ archived?: string }> }) {
  const showArchived = (await searchParams).archived === '1';
  const ctx = await requirePage();
  const data = await asUser(ctx, async (tx) => ({
    routes: await tx.select().from(route).where(isNull(route.archived_at)).orderBy(asc(route.name)),
    archived: await tx.select().from(route).where(isNotNull(route.archived_at)).orderBy(asc(route.name)),
    stops: await tx.select().from(route_stop).orderBy(asc(route_stop.seq)),
    // Retired lots too, so one still on a route shows its name and "(retired)" instead of a blank.
    sites: await tx.select({ id: site.id, label: site.label, active: site.active }).from(site).orderBy(asc(site.label)),
    crew: await tx.select({ id: crew_member.id, name: crew_member.name }).from(crew_member).where(eq(crew_member.active, true)),
    contracted: await tx.selectDistinct({ site_id: contract.site_id }).from(contract).where(eq(contract.status, 'accepted')),
  }));
  if (showArchived) {
    // Archived routes, the same way archived customers work (issue 52).
    return (
      <>
        <PageHeader title="Archived routes" subtitle="Restore one to put it back on Routes and the storm form, with its stops and driver." />
        {data.archived.length ? (
          <ul className="max-w-2xl space-y-2">
            {data.archived.map((r) => (
              <li key={r.id}>
                <Card className="flex flex-wrap items-center justify-between gap-2" data-testid="archived-route">
                  <div>
                    <div className="font-semibold">{r.name}</div>
                    <div className="text-sm text-muted">{data.stops.filter((s) => s.route_id === r.id).length} stops</div>
                  </div>
                  {ctx.role !== 'viewer' ? <RestoreRoute id={r.id} name={r.name} /> : null}
                </Card>
              </li>
            ))}
          </ul>
        ) : <EmptyState title="No archived routes" />}
        <Link className="mt-4 inline-block text-sm text-link underline" href="/routes">Back to routes</Link>
      </>
    );
  }
  return (
    <>
      <PageHeader title="Routes" subtitle="Master routes. Each storm snapshots these, so changes here never disturb a running storm." />
      <RoutesEditor yard={ctx.tenant.yard?.address ?? null} sites={data.sites.map((s) => ({ ...s, active: Boolean(s.active), contracted: data.contracted.some((c) => c.site_id === s.id) }))} crew={data.crew} routes={data.routes.map((r) => ({ id: r.id, name: r.name, default_crew_id: r.default_crew_id, yard_trip: r.yard_trip, site_ids: data.stops.filter((s) => s.route_id === r.id).map((s) => s.site_id) }))} />
      {data.archived.length ? <Link className="mt-4 inline-block text-sm text-link underline" href="/routes?archived=1" data-testid="show-archived-routes">Archived routes ({data.archived.length})</Link> : null}
    </>
  );
}
