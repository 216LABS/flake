import { job, serviceDb, sql, type Conn } from '@flake/db';
import { log } from './log';

const LEASE = sql`interval '2 minutes'`;

export async function enqueue(kind: string, payload: Record<string, unknown>, opts: { dedupeKey?: string; runAt?: Date; db?: Conn } = {}) {
  await (opts.db ?? serviceDb())
    .insert(job)
    .values({ kind, payload, dedupe_key: opts.dedupeKey ?? null, run_at: (opts.runAt ?? new Date()).toISOString() })
    .onConflictDoNothing({ target: job.dedupe_key });
}

interface JobRow {
  id: number;
  kind: string;
  payload: Record<string, any>;
  attempts: number;
  max_attempts: number;
}

export type JobHandler = (payload: Record<string, any>) => Promise<void>;

/** Claims one ready job with FOR UPDATE SKIP LOCKED and a 2 minute lease. */
async function claim(): Promise<JobRow | null> {
  const rows = (await serviceDb().execute(sql`
    update job set attempts = attempts + 1, locked_until = now() + ${LEASE}
    where id = (
      select id from job
      where done_at is null and dead_at is null and run_at <= now() and (locked_until is null or locked_until < now())
      order by run_at, id limit 1 for update skip locked
    )
    returning id, kind, payload, attempts, max_attempts`)) as unknown as JobRow[];
  return rows[0] ?? null;
}

/** Exponential backoff with jitter, capped at 30 minutes. */
export const backoffSeconds = (attempts: number) => Math.min(1800, 2 ** attempts * 5) * (0.75 + Math.random() * 0.5);

export async function drainJobs(handlers: Record<string, JobHandler>, opts: { limit?: number; deadlineMs?: number } = {}): Promise<{ ran: number; failed: number }> {
  const limit = opts.limit ?? 25;
  const deadline = Date.now() + (opts.deadlineMs ?? 50_000);
  let ran = 0;
  let failed = 0;
  while (ran < limit && Date.now() < deadline) {
    const row = await claim();
    if (!row) break;
    ran++;
    try {
      const handler = handlers[row.kind];
      if (!handler) throw new Error(`No handler for job kind ${row.kind}`);
      await handler(row.payload);
      await serviceDb().execute(sql`update job set done_at = now(), locked_until = null, last_error = null where id = ${row.id}`);
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      log.error('job failed', err, { job_id: row.id, kind: row.kind, tenant_id: row.payload.tenantId });
      if (row.attempts >= row.max_attempts) {
        await serviceDb().execute(sql`update job set dead_at = now(), locked_until = null, last_error = ${message} where id = ${row.id}`);
      } else {
        const delay = backoffSeconds(row.attempts);
        await serviceDb().execute(sql`update job set run_at = now() + make_interval(secs => ${delay}), locked_until = null, last_error = ${message} where id = ${row.id}`);
      }
    }
  }
  return { ran, failed };
}
