import { isLate } from '@flake/core/time';
import { and, eq, inArray, isNull, problem_report, run_stop, site, storm, storm_run, sql, type Tx } from '@flake/db';

export interface LiveStorm {
  id: string;
  name: string;
  started_at: string;
  total: number;
  finished: number;
  trucks: number;
  problems: number;
  late: number;
}

/**
 * Every storm running now, with what the office wants at a glance (issue 187): stops finished, trucks out, problems
 * waiting and stops past their open-by time. Read as the signed-in user.
 */
export async function liveStorms(tx: Tx, tz: string, now = Date.now()): Promise<LiveStorm[]> {
  const storms = await tx.select().from(storm).where(eq(storm.status, 'active')).orderBy(storm.started_at);
  if (!storms.length) return [];
  const ids = storms.map((s) => s.id);
  const stops = await tx.select({ storm_id: storm_run.storm_id, run_id: storm_run.id, published: storm_run.published_at, status: run_stop.status, window: site.service_window })
    .from(run_stop).innerJoin(storm_run, eq(storm_run.id, run_stop.storm_run_id)).innerJoin(site, eq(site.id, run_stop.site_id))
    .where(inArray(storm_run.storm_id, ids));
  const runIds = [...new Set(stops.map((s) => s.run_id))];
  const problems = runIds.length ? await tx.select({ run_id: problem_report.storm_run_id, n: sql<number>`count(*)::int` }).from(problem_report)
    .where(and(inArray(problem_report.storm_run_id, runIds), isNull(problem_report.resolved_at))).groupBy(problem_report.storm_run_id) : [];
  return storms.map((s) => {
    const mine = stops.filter((x) => x.storm_id === s.id);
    const runs = new Set(mine.map((x) => x.run_id));
    return {
      id: s.id,
      name: s.name,
      started_at: s.started_at,
      total: mine.length,
      finished: mine.filter((x) => x.status === 'done' || x.status === 'skipped').length,
      trucks: new Set(mine.filter((x) => x.published).map((x) => x.run_id)).size,
      problems: problems.filter((p) => p.run_id && runs.has(p.run_id)).reduce((n, p) => n + p.n, 0),
      late: mine.filter((x) => (x.status === 'open' || x.status === 'enroute') && isLate(x.window, Date.parse(s.started_at), now, tz)).length,
    };
  });
}

/** How long a storm has run, in words: "2 h 15 min", "40 min". */
export function runningFor(startedAt: string, now = Date.now()) {
  const min = Math.max(0, Math.round((now - Date.parse(startedAt)) / 60000));
  const h = Math.floor(min / 60);
  return h ? `${h} h${min % 60 ? ` ${min % 60} min` : ''}` : `${min} min`;
}
