import { and, asc, eq, isNull, route, route_stop, site, sql } from '@flake/db';
import { PageHeader } from '@flake/ui';
import { Breadcrumb } from '@/components/links';
import { asUser, requirePage } from '@/lib/auth';
import { getProviders } from '@/lib/providers';
import { PlanAll } from './plan-all';

export const metadata = { title: 'Plan all routes' };

export default async function PlanAllPage() {
  const ctx = await requirePage();
  const data = await asUser(ctx, async (tx) => ({
    routes: await tx.select({ id: route.id, name: route.name }).from(route).where(isNull(route.archived_at)).orderBy(asc(route.name)),
    stops: await tx.select({ route_id: route_stop.route_id, site_id: route_stop.site_id }).from(route_stop).innerJoin(route, eq(route.id, route_stop.route_id)).where(isNull(route.archived_at)),
    // Lots whose customer declined, with nothing signed, aren't offered for placing (issue 218).
    active: await tx.select({ id: site.id }).from(site).where(and(eq(site.active, true), sql`not (exists (select 1 from contract k where k.site_id = ${site.id} and k.status = 'declined') and not exists (select 1 from contract k where k.site_id = ${site.id} and k.status = 'accepted'))`)),
  }));
  const routed = new Set(data.stops.map((s) => s.site_id));
  return (
    <>
      <Breadcrumb href="/routes">Routes</Breadcrumb>
      <PageHeader title="Plan all routes" subtitle="Split your lots across your trucks so each truck has about the same night, then order each one. Nothing changes until you save." />
      <PlanAll
        layers={(await getProviders()).tiles.layers()}
        readOnly={ctx.role === 'viewer'}
        yard={ctx.tenant.yard?.address ?? null}
        routes={data.routes.map((r) => ({ ...r, stops: data.stops.filter((s) => s.route_id === r.id).length }))}
        unrouted={data.active.filter((s) => !routed.has(s.id)).length}
      />
    </>
  );
}
