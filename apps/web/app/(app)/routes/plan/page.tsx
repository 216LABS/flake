import { asc, eq, isNull, route, route_stop, site } from '@flake/db';
import { PageHeader } from '@flake/ui';
import Link from 'next/link';
import { asUser, requirePage } from '@/lib/auth';
import { PlanAll } from './plan-all';

export const metadata = { title: 'Plan all routes' };

export default async function PlanAllPage() {
  const ctx = await requirePage();
  const data = await asUser(ctx, async (tx) => ({
    routes: await tx.select({ id: route.id, name: route.name }).from(route).where(isNull(route.archived_at)).orderBy(asc(route.name)),
    stops: await tx.select({ route_id: route_stop.route_id, site_id: route_stop.site_id }).from(route_stop).innerJoin(route, eq(route.id, route_stop.route_id)).where(isNull(route.archived_at)),
    active: await tx.select({ id: site.id }).from(site).where(eq(site.active, true)),
  }));
  const routed = new Set(data.stops.map((s) => s.site_id));
  return (
    <>
      <PageHeader title="Plan all routes" subtitle="Split your lots across your trucks so each truck has about the same night, then order each one. Nothing changes until you save." />
      <PlanAll
        readOnly={ctx.role === 'viewer'}
        yard={ctx.tenant.yard?.address ?? null}
        routes={data.routes.map((r) => ({ ...r, stops: data.stops.filter((s) => s.route_id === r.id).length }))}
        unrouted={data.active.filter((s) => !routed.has(s.id)).length}
      />
      <Link className="mt-4 inline-block text-sm text-link underline" href="/routes">Back to routes</Link>
    </>
  );
}
