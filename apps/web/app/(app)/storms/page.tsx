import { and, crew_member, desc, eq, invoice_draft, isNull, ne, route, site, sql, storm } from '@flake/db';
import { fmtLocal, stormWhen } from '@flake/core/time';
import { Badge, buttonVariants, Card, cn, EmptyState, PageHeader } from '@flake/ui';
import Link from 'next/link';
import { asUser, requirePage } from '@/lib/auth';
import { stormStatus } from '@/lib/labels';
import { NewStorm } from './new-storm';

export const metadata = { title: 'Storms' };

/** Billed storms beyond this many wait behind Show older, so a season's list stays short (issue 124). */
const RECENT_BILLED = 5;

export default async function Storms({ searchParams }: { searchParams: Promise<{ older?: string }> }) {
  const showOlder = (await searchParams).older === '1';
  const ctx = await requirePage();
  const data = await asUser(ctx, async (tx) => ({
    // Every storm still live or to bill, however old, and the billed ones newest first.
    storms: [
      ...(await tx.select().from(storm).where(ne(storm.status, 'billed')).orderBy(desc(storm.started_at))),
      ...(await tx.select().from(storm).where(eq(storm.status, 'billed')).orderBy(desc(storm.started_at)).limit(showOlder ? 500 : RECENT_BILLED + 1)),
    ].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at)),
    billedCount: (await tx.select({ n: sql<number>`count(*)::int` }).from(storm).where(eq(storm.status, 'billed')))[0]!.n,
    // Storms with at least one bill that wasn't voided.
    withBills: (await tx.selectDistinct({ id: invoice_draft.storm_id }).from(invoice_draft).where(ne(invoice_draft.status, 'void'))).map((r) => r.id),
    // An archived route's lots stay with it but don't go out on new storms.
    routes: await tx.select().from(route).where(isNull(route.archived_at)),
    crew: await tx.select().from(crew_member).where(eq(crew_member.active, true)),
    // A lot on no route is left out of every storm started here, so say which.
    unrouted: await tx.select({ id: site.id, label: site.label }).from(site).where(and(eq(site.active, true), sql`not exists (select 1 from route_stop rs join route r on r.id = rs.route_id where rs.site_id = ${site.id} and r.archived_at is null)`)).orderBy(site.label),
  }));
  // Live and Ready to bill storms always show; billed ones only the newest few until asked.
  const billed = data.storms.filter((s) => s.status === 'billed');
  const hidden = showOlder ? [] : billed.slice(RECENT_BILLED).map((s) => s.id);
  const listed = data.storms.filter((s) => !hidden.includes(s.id));
  const olderCount = showOlder ? 0 : Math.max(0, data.billedCount - RECENT_BILLED);
  return (
    <>
      <PageHeader title="Storms" subtitle="Start from your master routes, publish once, then move stops." actions={ctx.role !== 'viewer' ? <a href="#start" className={cn(buttonVariants({ variant: 'accent' }), 'lg:hidden')} data-testid="jump-start-storm">Start a storm</a> : null} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {data.storms.length ? (
            <ul className="space-y-2">
              {listed.map((s) => (
                <li key={s.id}>
                  <Link href={`/storms/${s.id}`}>
                    <Card className="flex items-center justify-between transition-colors hover:border-ink">
                      <div><div className="font-display text-lg font-semibold leading-tight">{s.name}</div><div className="text-sm text-muted">{stormWhen(s.started_at, ctx.tenant.timezone)}</div></div>
                      <Badge tone={stormStatus(s.status, !data.withBills.includes(s.id)).tone}>{stormStatus(s.status, !data.withBills.includes(s.id)).word}</Badge>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          {olderCount ? <Link className="mt-3 inline-block text-sm font-semibold text-link underline" href="/storms?older=1" data-testid="older-storms">Show {olderCount} older billed {olderCount === 1 ? 'storm' : 'storms'}</Link> : null}
          {showOlder && billed.length > RECENT_BILLED ? <Link className="mt-3 inline-block text-sm text-link underline" href="/storms">Show only recent storms</Link> : null}
          {data.storms.length ? null : <EmptyState title="No storms yet" body="Add routes first, then start your first storm here." />}
        </div>
        {/* On a phone the form sits below every storm so far; the header button and the dashboard jump here. */}
        <div id="start" className="scroll-mt-20"><NewStorm defaultName={`Storm ${fmtLocal(new Date(), ctx.tenant.timezone, { month: 'short', day: 'numeric' })}`} routes={data.routes.map((r) => ({ id: r.id, name: r.name, default_crew_id: r.default_crew_id }))} crew={data.crew.map((c) => ({ id: c.id, name: c.name, kind: c.kind }))} unrouted={data.unrouted.map((s) => s.label)} /></div>
      </div>
    </>
  );
}
