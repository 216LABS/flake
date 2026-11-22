import type { Metadata } from 'next';
import { currentStatus, downByDay, incidents } from '@/lib/status';

export const metadata: Metadata = { title: 'Flake status', description: 'Whether the Flake app, driver links and snow alerts are working right now, and outages in the last 90 days.', alternates: { canonical: '/status' } };
export const dynamic = 'force-dynamic';

const TONE = { up: 'bg-ok-tint text-ok-ink', degraded: 'bg-warn-tint text-warn-ink', down: 'bg-danger-tint text-danger-ink' } as const;
const WORD = { up: 'Working', degraded: 'Slow', down: 'Down' } as const;

/** Public status (issue 231). Nothing private: component states, and outage start and end times. */
export default async function Status() {
  const [parts, list] = await Promise.all([currentStatus(), incidents()]);
  const worst = parts.some((p) => p.state === 'down') ? 'down' : parts.some((p) => p.state === 'degraded') ? 'degraded' : 'up';
  const days = list ? downByDay(list) : null;
  const totalDown = days?.reduce((a, d) => a + d.down, 0) ?? 0;
  const uptime = days ? Math.max(0, 100 - (totalDown / (90 * 1440)) * 100) : null;
  const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York', timeZoneName: 'short' });
  return (
    <section className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-bold text-ink">Flake status</h1>
      <p className={`mt-4 rounded-md p-3 font-semibold ${TONE[worst]}`} data-testid="status-overall">{worst === 'up' ? 'Everything is working.' : worst === 'degraded' ? 'Some background work is running behind.' : 'Part of Flake is down. We are on it.'}</p>
      <ul className="mt-6 divide-y divide-line-faint rounded-md border border-line-faint bg-surface" data-testid="status-parts">
        {parts.map((p) => (
          <li key={p.key} className="flex flex-wrap items-center justify-between gap-2 p-3" data-testid="status-part" data-state={p.state}>
            <span><span className="font-medium text-ink">{p.name}</span><span className="block text-sm text-muted">{p.note}</span></span>
            <span className={`rounded-sm px-2 py-0.5 text-xs font-semibold uppercase ${TONE[p.state]}`}>{WORD[p.state]}</span>
          </li>
        ))}
      </ul>
      <h2 className="mt-10 text-xl font-semibold text-ink">Last 90 days</h2>
      {days ? (
        <>
          <p className="mt-1 text-sm text-muted" data-testid="status-uptime">{uptime!.toFixed(uptime! >= 99.995 ? 2 : 3)}% up, measured every 15 minutes from outside.</p>
          <div className="mt-2 flex h-8 gap-px" aria-label="Each bar is one day">
            {days.map((d) => <span key={d.day} title={`${d.day}: ${d.down ? `${d.down} min down` : 'no outage'}`} className={`flex-1 rounded-[1px] ${d.down === 0 ? 'bg-ok-ink/60' : d.down < 30 ? 'bg-warn-strong' : 'bg-danger'}`} />)}
          </div>
          <h3 className="mt-6 font-semibold text-ink">Outages</h3>
          {list!.length ? (
            <ul className="mt-2 space-y-1 text-sm text-ink-2" data-testid="status-incidents">
              {list!.map((x) => <li key={x.start}>{when(x.start)} to {x.end ? when(x.end) : 'now'}</li>)}
            </ul>
          ) : <p className="mt-1 text-sm text-ink-2" data-testid="status-incidents">None in the last 90 days.</p>}
        </>
      ) : <p className="mt-1 text-sm text-muted">The outage history couldn&apos;t be loaded just now. Try again in a few minutes.</p>}
      <p className="mt-10 text-sm text-muted">Times are Eastern. An outage starts when our monitor sees Flake fail twice, a minute apart, and ends when the next check passes. During a storm, drivers&apos; phones keep their work and send it once Flake answers again.</p>
    </section>
  );
}
