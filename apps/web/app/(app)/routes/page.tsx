import { asc, crew_member, eq, route, route_stop, site } from '@flake/db';
import { PageHeader } from '@flake/ui';
import { asUser, requirePage } from '@/lib/auth';
import { RoutesEditor } from './routes-editor';

export const metadata = { title: 'Routes' };

export default async function Routes() {
  const ctx = await requirePage();
  const data = await asUser(ctx, async (tx) => ({
    routes: await tx.select().from(route).orderBy(asc(route.name)),
    stops: await tx.select().from(route_stop).orderBy(asc(route_stop.seq)),
    sites: await tx.select({ id: site.id, label: site.label }).from(site).where(eq(site.active, true)).orderBy(asc(site.label)),
    crew: await tx.select({ id: crew_member.id, name: crew_member.name }).from(crew_member).where(eq(crew_member.active, true)),
  }));
  return (
    <>
      <PageHeader title="Routes" subtitle="Master routes. Each storm snapshots these, so changes here never disturb a running storm." />
      <RoutesEditor sites={data.sites} crew={data.crew} routes={data.routes.map((r) => ({ id: r.id, name: r.name, default_crew_id: r.default_crew_id, site_ids: data.stops.filter((s) => s.route_id === r.id).map((s) => s.site_id) }))} />
    </>
  );
}
