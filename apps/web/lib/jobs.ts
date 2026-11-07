import { job, serviceDb, sql, type Conn } from '@flake/db';
import { after } from 'next/server';
import { log } from './log';

const LEASE = sql`interval '2 minutes'`;

/**
 * Work goes in the order people are waiting on it. A big storm queues two reports per visit, and a driver's route link
 * must not sit behind them. Anything not listed is lane 1.
 */
const LANE_NOW = ['storm.publish_links', 'notify.route_changed', 'notify.party', 'notify.push', 'trigger.evaluate'];
const LANE_LATER = ['report.completion', 'billing.installments', 'weather.nohrsc'];
const LANE_HEAVY = ['photo.process', 'proof.render'];
/** Waiting jobs move up a lane this often, so a busy night can't leave the lower lanes waiting forever. */
const AGE_UP_SECONDS = 600;
/** These hold a whole image in memory, so they run one at a time. */
const runsAlone = new Set(LANE_HEAVY);

const list = (kinds: string[]) => sql.join(kinds.map((k) => sql`${k}`), sql`, `);
const laneOf = sql`case when kind in (${list(LANE_NOW)}) then 0 when kind in (${list(LANE_LATER)}) then 2 when kind in (${list(LANE_HEAVY)}) then 3 else 1 end`;

export async function enqueue(kind: string, payload: Record<string, unknown>, opts: { dedupeKey?: string; runAt?: Date; db?: Conn } = {}) {
  await (opts.db ?? serviceDb())
    .insert(job)
    .values({ kind, payload, dedupe_key: opts.dedupeKey ?? null, run_at: (opts.runAt ?? new Date()).toISOString() })
    .onConflictDoNothing({ target: job.dedupe_key });
  if (LANE_NOW.includes(kind) && !opts.runAt) wakeForUrgentWork();
}

let wakeScheduled = false;

/**
 * Runs urgent jobs right after the current response, instead of waiting for the next scheduled run. This also covers
 * jobs queued inside a transaction, which has committed by then. Outside a request there's nothing to attach to, and
 * the schedule picks the job up as usual.
 */
function wakeForUrgentWork() {
  if (wakeScheduled) return;
  try {
    after(async () => {
      wakeScheduled = false;
      try {
        const { runUrgentJobs } = await import('./handlers');
        await runUrgentJobs();
      } catch (err) {
        log.error('urgent job run failed', err, {});
      }
    });
    wakeScheduled = true;
  } catch {
    // Not in a request.
  }
}

interface JobRow {
  id: number;
  kind: string;
  payload: Record<string, any>;
  attempts: number;
  max_attempts: number;
  lane: number;
  turn: number;
}

export type JobHandler = (payload: Record<string, any>) => Promise<void>;

/**
 * Claims the next jobs with FOR UPDATE SKIP LOCKED and a 2 minute lease. Within a lane, companies take turns: every
 * company's first job, then every company's second. A 500 site storm can't hold up someone with five.
 */
async function claim(count: number, maxLane: number): Promise<JobRow[]> {
  const rows = (await serviceDb().execute(sql`
    with ready as (
      select id, run_at, payload->>'tenantId' as tenant,
        greatest(${laneOf} - floor(extract(epoch from now() - run_at) / ${AGE_UP_SECONDS})::int, 0) as lane
      from job
      where done_at is null and dead_at is null and run_at <= now() and (locked_until is null or locked_until < now())
    ), ranked as (
      select id, lane, row_number() over (partition by tenant, lane order by run_at, id) as turn from ready where lane <= ${maxLane}
    ), picked as (
      select id, lane, turn from ranked order by lane, turn, id limit ${count}
    ), locked as (
      -- The choice above was made on a snapshot. Checking again here, on the locked row, stops two runs that chose
      -- the same job a moment apart from both running it.
      select job.id, picked.lane, picked.turn from job join picked on picked.id = job.id
      where job.done_at is null and job.dead_at is null and (job.locked_until is null or job.locked_until < now())
      for update of job skip locked
    )
    update job set attempts = attempts + 1, locked_until = now() + ${LEASE}
    from locked where job.id = locked.id and (job.locked_until is null or job.locked_until < now())
    returning job.id, job.kind, job.payload, job.attempts, job.max_attempts, locked.lane, locked.turn`)) as unknown as JobRow[];
  return [...rows].sort((a, b) => Number(a.lane) - Number(b.lane) || Number(a.turn) - Number(b.turn) || Number(a.id) - Number(b.id));
}

/** Exponential backoff with jitter, capped at 30 minutes. */
export const backoffSeconds = (attempts: number) => Math.min(1800, 2 ** attempts * 5) * (0.75 + Math.random() * 0.5);

/** Runs at once while things go well, and never more than the database pool can serve. */
const mostAtOnce = () => Math.max(1, Math.min(4, Number(process.env.DB_POOL_MAX ?? 10) - 1));

export async function drainJobs(handlers: Record<string, JobHandler>, opts: { limit?: number; deadlineMs?: number; maxLane?: number } = {}): Promise<{ ran: number; failed: number }> {
  // The deadline is what really stops a run. A small limit only made big storms wait, for the same total work.
  const limit = opts.limit ?? 1000;
  const deadline = Date.now() + (opts.deadlineMs ?? 50_000);
  const maxLane = opts.maxLane ?? 3;
  let ran = 0;
  let failed = 0;
  let width = 1;

  const runOne = async (row: JobRow) => {
    try {
      const handler = handlers[row.kind];
      if (!handler) throw new Error(`No handler for job kind ${row.kind}`);
      await handler(row.payload);
      await serviceDb().execute(sql`update job set done_at = now(), locked_until = null, last_error = null where id = ${row.id}`);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const { retryAfterSeconds: wait, notAFailure } = err as { retryAfterSeconds?: number; notAFailure?: boolean };
      if (!notAFailure) log.error('job failed', err, { job_id: row.id, kind: row.kind, tenant_id: row.payload.tenantId });
      if (wait) {
        // The provider said "not yet". That says nothing about the job, so it doesn't use up an attempt.
        await serviceDb().execute(sql`update job set attempts = attempts - 1, run_at = now() + make_interval(secs => ${wait}), locked_until = null, last_error = ${message} where id = ${row.id}`);
      } else if (row.attempts >= row.max_attempts) {
        await serviceDb().execute(sql`update job set dead_at = now(), locked_until = null, last_error = ${message} where id = ${row.id}`);
      } else {
        const delay = backoffSeconds(row.attempts);
        await serviceDb().execute(sql`update job set run_at = now() + make_interval(secs => ${delay}), locked_until = null, last_error = ${message} where id = ${row.id}`);
      }
      return Boolean(notAFailure);
    }
  };

  while (ran < limit && Date.now() < deadline) {
    const rows = await claim(Math.min(width, limit - ran), maxLane);
    if (!rows.length) break;
    ran += rows.length;
    const together = rows.filter((r) => !runsAlone.has(r.kind));
    const results = await Promise.all(together.map(runOne));
    for (const row of rows.filter((r) => runsAlone.has(r.kind))) results.push(await runOne(row));
    const failures = results.filter((ok) => !ok).length;
    failed += failures;
    // Speed up while everything works. Any failure drops to one at a time, so a struggling provider isn't hammered.
    width = failures ? 1 : Math.min(width * 2, mostAtOnce());
  }
  return { ran, failed };
}
