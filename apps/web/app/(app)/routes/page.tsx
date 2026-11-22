import { asc, contract, crew_member, customer, eq, isNotNull, isNull, route, route_stop, site, truck } from '@flake/db';
import { buttonVariants, Card, EmptyState, PageHeader } from '@flake/ui';
import Link from 'next/link';
import { FilterTabs } from '@/components/links';
import { asUser, requirePage } from '@/lib/auth';
import { lotOptions } from '@/lib/lots';
import { getProviders } from '@/lib/providers';
import { RestoreRoute } from './restore-route';
import { RoutesEditor } from './routes-editor';
import { UnroutedLots } from './unrouted-lots';

export const metadata = { title: 'Routes' };

export default async function Routes({ searchParams }: { searchParams: Promise<{ archived?: string }> }) {
  const showArchived = (await searchParams).archived === '1';
  const ctx = await requirePage();
  const data = await asUser(ctx, async (tx) => ({
    routes: await tx.select().from(route).where(isNull(route.archived_at)).orderBy(asc(route.name)),
    archived: await tx.select().from(route).where(isNotNull(route.archived_at)).orderBy(asc(route.name)),
    stops: await tx.select().from(route_stop).orderBy(asc(route_stop.seq)),
    // Retired lots too, so one still on a route shows its name and "(retired)" instead of a blank.
    // The customer's name, shown when two lots share a label like "North lot" (issue 225).
    sites: await tx.select({ id: site.id, label: site.label, active: site.active, customer: customer.name }).from(site).innerJoin(customer, eq(customer.id, site.customer_id)).orderBy(asc(site.label)),
    crew: await tx.select({ id: crew_member.id, name: crew_member.name }).from(crew_member).where(eq(crew_member.active, true)),
    trucks: await tx.select({ id: truck.id, name: truck.name }).from(truck).where(eq(truck.active, true)).orderBy(asc(truck.name)),
    lots: await lotOptions(tx),
    contracted: await tx.selectDistinct({ site_id: contract.site_id }).from(contract).where(eq(contract.status, 'accepted')),
    declined: await tx.selectDistinct({ site_id: contract.site_id }).from(contract).where(eq(contract.status, 'declined')),
  }));
  if (showArchived) {
    // Archived routes, the same way archived customers work (issue 52).
    return (
      <>
        <PageHeader title="Archived routes" subtitle="Restore one to put it back on Routes and the storm form, with its stops and driver." />
        <FilterTabs label="Which routes" items={[{ href: '/routes', label: 'Active', active: false }, { href: '/routes?archived=1', label: `Archived (${data.archived.length})`, active: true }]} />
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
      </>
    );
  }
  return (
    <>
      <PageHeader title="Routes" subtitle="Your usual routes, one per truck. A storm copies them when it starts, so edits here never change a storm that is running." actions={data.routes.length >= 2 && ctx.role !== 'viewer' ? <Link className={buttonVariants({ variant: 'outline' })} href="/routes/plan" data-testid="plan-all-link">Plan all routes</Link> : null} />
      {data.archived.length ? <FilterTabs label="Which routes" items={[{ href: '/routes', label: 'Active', active: true }, { href: '/routes?archived=1', label: `Archived (${data.archived.length})`, active: false, testId: 'show-archived-routes' }]} /> : null}
      {ctx.role !== 'viewer' ? <UnroutedLots routes={data.routes.map((r) => ({ id: r.id, name: r.name }))} lots={data.sites.filter((s) => s.active && !data.stops.some((x) => x.site_id === s.id && data.routes.some((r) => r.id === x.route_id)) && !(data.declined.some((c) => c.site_id === s.id) && !data.contracted.some((c) => c.site_id === s.id))).map((s) => ({ id: s.id, label: s.label }))} /> : null}
      <fieldset disabled={ctx.role === 'viewer'} className={ctx.role === 'viewer' ? 'view-only contents' : 'contents'}><RoutesEditor key={data.routes.map((r) => r.id).join()} lots={data.lots} layers={(await getProviders()).tiles.layers()} yard={ctx.tenant.yard?.address ?? null} sites={data.sites.map((s) => ({ ...s, active: Boolean(s.active), contracted: data.contracted.some((c) => c.site_id === s.id), declined: data.declined.some((c) => c.site_id === s.id), customer: data.sites.some((o) => o.id !== s.id && o.active && o.label.trim().toLowerCase() === s.label.trim().toLowerCase()) ? s.customer : undefined }))} crew={data.crew} trucks={data.trucks} routes={data.routes.map((r) => ({ id: r.id, name: r.name, default_crew_id: r.default_crew_id, default_truck_id: r.default_truck_id, yard_trip: r.yard_trip, site_ids: data.stops.filter((s) => s.route_id === r.id).map((s) => s.site_id) }))} /></fieldset>
    </>
  );
}
