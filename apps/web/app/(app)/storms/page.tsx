import { and, crew_member, desc, eq, invoice_draft, isNull, ne, route, site, sql, storm } from '@flake/db';
import { fmtLocal, stormWhen } from '@flake/core/time';
import { Badge, buttonVariants, Card, cn, EmptyState, Eyebrow, PageHeader } from '@flake/ui';
import Link from 'next/link';
import { asUser, requirePage } from '@/lib/auth';
import { stormStatus } from '@/lib/labels';
import { NewStorm } from './new-storm';
import { LiveBanner } from './live-banner';
import { Fold } from '@/components/fold';
import { liveStorms } from '@/lib/live';
import { FilterTabs } from '@/components/links';

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
    live: await liveStorms(tx, ctx.tenant.timezone),
    // On a route but the customer declined the quote, with nothing signed: a storm leaves them out (issue 218).
    declined: await tx.select({ id: site.id, label: site.label }).from(site).where(and(eq(site.active, true), sql`exists (select 1 from route_stop rs join route r on r.id = rs.route_id where rs.site_id = ${site.id} and r.archived_at is null)`, sql`exists (select 1 from contract k where k.site_id = ${site.id} and k.status = 'declined')`, sql`not exists (select 1 from contract k where k.site_id = ${site.id} and k.status = 'accepted')`)).orderBy(site.label),
    unrouted: await tx.select({ id: site.id, label: site.label }).from(site).where(and(eq(site.active, true), sql`not exists (select 1 from route_stop rs join route r on r.id = rs.route_id where rs.site_id = ${site.id} and r.archived_at is null)`)).orderBy(site.label),
  }));
  // Live and Ready to bill storms always show; billed ones only the newest few until asked.
  const billed = data.storms.filter((s) => s.status === 'billed');
  const hidden = showOlder ? [] : billed.slice(RECENT_BILLED).map((s) => s.id);
  const listed = data.storms.filter((s) => !hidden.includes(s.id));
  return (
    <>
      <PageHeader title="Storms" subtitle="When snow comes, start a storm: each truck gets its route on the driver's phone, and you can move stops while it runs." actions={ctx.role !== 'viewer' ? <a href="#start" className={cn(buttonVariants({ variant: 'accent' }), 'lg:hidden')} data-testid="jump-start-storm">Start a storm</a> : null} />
      <LiveBanner storms={data.live} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {(() => {
            // The live storm on its own, then every past storm in one Past storms section, folded while a storm is
            // live so the one being worked is all that shows (issue 187, Flip's clarification).
            const card = (s: (typeof listed)[number]) => (
              <li key={s.id}>
                <Link href={`/storms/${s.id}`}>
                  <Card className={cn('flex items-center justify-between transition-colors hover:border-ink', s.status === 'active' && 'border-beacon')}>
                    <div><div className="font-display text-lg font-semibold leading-tight">{s.name}</div><div className="text-sm text-muted">{stormWhen(s.started_at, ctx.tenant.timezone)}</div></div>
                    <Badge tone={stormStatus(s.status, !data.withBills.includes(s.id)).tone}>{stormStatus(s.status, !data.withBills.includes(s.id)).word}</Badge>
                  </Card>
                </Link>
              </li>
            );
            const live = listed.filter((s) => s.status === 'active');
            const toBill = listed.filter((s) => s.status !== 'active' && s.status !== 'billed');
            const billedRows = listed.filter((s) => s.status === 'billed');
            const pastCount = toBill.length + data.billedCount;
            return (
              <>
                {/* The banner above already shows the live storm; a second card for it here only repeated it. */}
                {pastCount ? (
                  <details className="group mb-6" open={!live.length || showOlder} data-testid="storms-past">
                    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-md border border-line-faint bg-surface px-3 py-2 font-semibold [&::-webkit-details-marker]:hidden" data-testid="storms-past-toggle">
                      <span>Past storms <span className="font-normal text-muted">({pastCount}{toBill.length ? `, ${toBill.length} ready to bill` : ''})</span></span>
                      <span aria-hidden="true" className="text-muted transition-transform group-open:rotate-180">▾</span>
                    </summary>
                    {toBill.length ? (
                      <section className="mt-4" data-testid="storms-to-bill">
                        <Eyebrow className="mb-2">Ready to bill</Eyebrow>
                        <ul className="space-y-2">{toBill.map(card)}</ul>
                      </section>
                    ) : null}
                    {data.billedCount ? (
                      <section className="mt-4" data-testid="storms-billed">
                        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
                          <Eyebrow>Billed</Eyebrow>
                          {data.billedCount > RECENT_BILLED ? (
                            <FilterTabs label="Billed storms" className="mb-0 border-b-0" items={[
                              { href: '/storms', label: 'Recent', active: !showOlder },
                              { href: '/storms?older=1', label: `All ${data.billedCount}`, active: showOlder, testId: 'older-storms' },
                            ]} />
                          ) : null}
                        </div>
                        <ul className="space-y-2">{billedRows.map(card)}</ul>
                      </section>
                    ) : null}
                  </details>
                ) : null}
              </>
            );
          })()}
          {data.storms.length ? null : <EmptyState title="No storms yet" body={data.routes.length ? 'Start your first one here when snow is coming. You can try one now and close it: nothing is billed until you approve.' : 'Put your lots on a route first (Routes), then start your first storm here.'} />}
        </div>
        {/* On a phone the form sits below every storm so far; the header button and the dashboard jump here. */}
        <div id="start" className="scroll-mt-20"><Fold folded={data.live.length > 0} label="Start another storm" hash="start" testId="start-fold"><NewStorm defaultName={`Storm ${fmtLocal(new Date(), ctx.tenant.timezone, { month: 'short', day: 'numeric' })}`} routes={data.routes.map((r) => ({ id: r.id, name: r.name, default_crew_id: r.default_crew_id }))} crew={data.crew.map((c) => ({ id: c.id, name: c.name, kind: c.kind }))} unrouted={data.unrouted.map((s) => s.label)} declined={data.declined.map((s) => s.label)} /></Fold></div>
      </div>
    </>
  );
}
