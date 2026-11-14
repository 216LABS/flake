import { and, crew_member, desc, eq, isNull, route, site, sql, storm } from '@flake/db';
import { fmtLocal } from '@flake/core/time';
import { Badge, buttonVariants, Card, cn, EmptyState, PageHeader } from '@flake/ui';
import Link from 'next/link';
import { asUser, requirePage } from '@/lib/auth';
import { stormStatus } from '@/lib/labels';
import { NewStorm } from './new-storm';

export const metadata = { title: 'Storms' };

export default async function Storms() {
  const ctx = await requirePage();
  const data = await asUser(ctx, async (tx) => ({
    storms: await tx.select().from(storm).orderBy(desc(storm.started_at)).limit(50),
    // An archived route's lots stay with it but don't go out on new storms.
    routes: await tx.select().from(route).where(isNull(route.archived_at)),
    crew: await tx.select().from(crew_member).where(eq(crew_member.active, true)),
    // A lot on no route is left out of every storm started here, so say which.
    unrouted: await tx.select({ id: site.id, label: site.label }).from(site).where(and(eq(site.active, true), sql`not exists (select 1 from route_stop rs join route r on r.id = rs.route_id where rs.site_id = ${site.id} and r.archived_at is null)`)).orderBy(site.label),
  }));
  return (
    <>
      <PageHeader title="Storms" subtitle="Start from your master routes, publish once, then move stops." actions={ctx.role !== 'viewer' ? <a href="#start" className={cn(buttonVariants({ variant: 'accent' }), 'lg:hidden')} data-testid="jump-start-storm">Start a storm</a> : null} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {data.storms.length ? (
            <ul className="space-y-2">
              {data.storms.map((s) => (
                <li key={s.id}>
                  <Link href={`/storms/${s.id}`}>
                    <Card className="flex items-center justify-between transition-colors hover:border-ink">
                      <div><div className="font-display text-lg font-semibold leading-tight">{s.name}</div><div className="text-sm text-muted">{fmtLocal(s.started_at, ctx.tenant.timezone)}</div></div>
                      <Badge tone={stormStatus(s.status).tone}>{stormStatus(s.status).word}</Badge>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <EmptyState title="No storms yet" body="Add routes first, then start your first storm here." />}
        </div>
        {/* On a phone the form sits below every storm so far; the header button and the dashboard jump here. */}
        <div id="start" className="scroll-mt-20"><NewStorm defaultName={`Storm ${fmtLocal(new Date(), ctx.tenant.timezone, { month: 'short', day: 'numeric' })}`} routes={data.routes.map((r) => ({ id: r.id, name: r.name, default_crew_id: r.default_crew_id }))} crew={data.crew.map((c) => ({ id: c.id, name: c.name, kind: c.kind }))} unrouted={data.unrouted.map((s) => s.label)} /></div>
      </div>
    </>
  );
}
