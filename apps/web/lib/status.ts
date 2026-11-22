import { serviceDb, sql } from '@flake/db';
import { isProd } from './env';
import { getSetting } from './providers';

/**
 * The public status page (issue 231): how the app, driver links and weather alerts are doing right now, and outages in
 * the last 90 days. Now is checked live, the way /api/health is. History comes from the uptime monitor, which opens a
 * GitHub issue labeled "outage" when production fails twice in a row and closes it when it's back: only their open and
 * close times are shown, never their text.
 */
export type Health = 'up' | 'degraded' | 'down';
export interface StatusPart { key: string; name: string; state: Health; note: string }
export interface Incident { start: string; end: string | null }

const minutesAgo = (d: string | Date | null | undefined) => (d ? Math.round((Date.now() - new Date(d).getTime()) / 60000) : null);

export async function currentStatus(): Promise<StatusPart[]> {
  let db = true;
  let queueLate: number | null = null;
  let weather: number | null = null;
  try {
    const [q] = (await serviceDb().execute(sql`select min(run_at) as oldest from job where done_at is null and dead_at is null and run_at <= now()`)) as unknown as { oldest: string | null }[];
    queueLate = minutesAgo(q?.oldest);
    const [w] = (await serviceDb().execute(sql`select max(done_at) as last from job where kind like 'weather.%' and done_at is not null`)) as unknown as { last: string | null }[];
    weather = minutesAgo(w?.last);
  } catch {
    db = false;
  }
  const runs = db ? ((await getSetting<string[]>('worker.runs').catch(() => null)) ?? []) : [];
  const worker = minutesAgo(runs.at(-1));
  const workerOk = !isProd() || (worker !== null && worker <= 7);
  const queueOk = queueLate === null || queueLate <= 15;
  return [
    { key: 'app', name: 'Office app', state: db ? 'up' : 'down', note: db ? 'Working' : 'Not answering' },
    { key: 'driver', name: 'Driver route links', state: db ? 'up' : 'down', note: db ? 'Working. Phones keep work saved offline either way and send it when they can.' : 'Not answering. Phones keep work saved and send it when it is back.' },
    { key: 'background', name: 'Texts, alerts and billing in the background', state: !db ? 'down' : workerOk && queueOk ? 'up' : 'degraded', note: !db ? 'Not answering' : workerOk && queueOk ? 'Running on time' : 'Running behind' },
    { key: 'weather', name: 'Weather and snow alerts', state: !db ? 'down' : weather === null || weather <= 120 ? 'up' : 'degraded', note: !db ? 'Not answering' : weather === null || weather <= 120 ? 'Forecasts updating' : 'Forecasts are late; the weather service may be slow' },
  ];
}

/** Outages in the last 90 days, from the uptime monitor's GitHub issues. Cached 10 minutes; empty if GitHub can't be read. */
export async function incidents(repo = '216LABS/flake'): Promise<Incident[] | null> {
  const since = new Date(Date.now() - 90 * 86400000).toISOString();
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/issues?labels=outage&state=all&per_page=100&since=${since}`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'flake-status' }, next: { revalidate: 600 } });
    if (!res.ok) return null;
    const rows = (await res.json()) as { created_at: string; closed_at: string | null; pull_request?: unknown }[];
    return rows.filter((r) => !r.pull_request && (r.closed_at ?? new Date().toISOString()) >= since).map((r) => ({ start: r.created_at, end: r.closed_at })).sort((a, b) => b.start.localeCompare(a.start));
  } catch {
    return null;
  }
}

/** Minutes each day was down, for the 90-day bar. Days are UTC. */
export function downByDay(list: Incident[], days = 90, now = Date.now()): { day: string; down: number }[] {
  const out: { day: string; down: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const start = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate()) - i * 86400000;
    const end = start + 86400000;
    const down = list.reduce((m, x) => {
      const a = Math.max(start, Date.parse(x.start));
      const b = Math.min(end, x.end ? Date.parse(x.end) : now);
      return m + Math.max(0, b - a);
    }, 0);
    out.push({ day: new Date(start).toISOString().slice(0, 10), down: Math.round(down / 60000) });
  }
  return out;
}
