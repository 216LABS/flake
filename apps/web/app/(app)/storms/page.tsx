import { crew_member, desc, eq, route, storm } from '@flake/db';
import { fmtLocal } from '@flake/core/time';
import { Badge, Card, EmptyState, PageHeader } from '@flake/ui';
import Link from 'next/link';
import { asUser, requirePage } from '@/lib/auth';
import { NewStorm } from './new-storm';

export const metadata = { title: 'Storms' };

export default async function Storms() {
  const ctx = await requirePage();
  const data = await asUser(ctx, async (tx) => ({
    storms: await tx.select().from(storm).orderBy(desc(storm.started_at)).limit(50),
    routes: await tx.select().from(route),
    crew: await tx.select().from(crew_member).where(eq(crew_member.active, true)),
  }));
  return (
    <>
      <PageHeader title="Storms" subtitle="Start from your master routes, publish once, then move stops." />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {data.storms.length ? (
            <ul className="space-y-2">
              {data.storms.map((s) => (
                <li key={s.id}>
                  <Link href={`/storms/${s.id}`}>
                    <Card className="flex items-center justify-between transition-colors hover:border-ink">
                      <div><div className="font-display text-lg font-semibold leading-tight">{s.name}</div><div className="text-sm text-muted">{fmtLocal(s.started_at, ctx.tenant.timezone)}</div></div>
                      <Badge tone={s.status === 'active' ? 'blue' : s.status === 'billed' ? 'green' : 'amber'}>{s.status}</Badge>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <EmptyState title="No storms yet" body="Add routes first, then start your first storm here." />}
        </div>
        <NewStorm defaultName={`Storm ${fmtLocal(new Date(), ctx.tenant.timezone, { month: 'short', day: 'numeric' })}`} routes={data.routes.map((r) => ({ id: r.id, name: r.name, default_crew_id: r.default_crew_id }))} crew={data.crew.map((c) => ({ id: c.id, name: c.name, kind: c.kind }))} />
      </div>
    </>
  );
}
