import { serviceDb, sql } from '@flake/db';
import { NextResponse } from 'next/server';
import { isProd } from '@/lib/env';
import { clientIp, rateLimit } from '@/lib/http';
import { getSetting } from '@/lib/providers';

export const dynamic = 'force-dynamic';

/** The background worker runs every minute in production. Five missed runs means texts and bills are stuck. */
const WORKER_LATE_MIN = 5;
/** A job that could have run this long ago and still hasn't means the queue is backed up. */
const QUEUE_LATE_MIN = 15;

/**
 * For a free uptime monitor (UptimeRobot, Better Stack) to poll. 200 when the database answers and background work
 * is moving, 503 otherwise, so the monitor can text the owner at 4 AM. It reports timings only, nothing private.
 */
export async function GET(req: Request) {
  try {
    rateLimit(`health:${clientIp(req) ?? 'unknown'}`, 60, 60_000);
  } catch {
    return NextResponse.json({ ok: false, error: 'Too many requests' }, { status: 429 });
  }
  const minutesAgo = (iso: string | null | undefined) => (iso ? Math.round((Date.now() - Date.parse(iso)) / 60000) : null);
  let db = false;
  let oldest: number | null = null;
  try {
    const [row] = (await serviceDb().execute(sql`select min(run_at) as oldest from job where done_at is null and dead_at is null and run_at <= now()`)) as unknown as { oldest: string | Date | null }[];
    db = true;
    oldest = minutesAgo(row?.oldest ? new Date(row.oldest).toISOString() : null);
  } catch {
    // The database didn't answer; db stays false.
  }
  const runs = db ? ((await getSetting<string[]>('worker.runs').catch(() => null)) ?? []) : [];
  const worker = minutesAgo(runs[runs.length - 1]);
  // Only production has the every-minute schedule; a laptop drains the queue with its own ticker.
  const workerOk = !isProd() || (worker !== null && worker <= WORKER_LATE_MIN);
  const queueOk = oldest === null || oldest <= QUEUE_LATE_MIN;
  const ok = db && workerOk && queueOk;
  return NextResponse.json(
    { ok, database: db ? 'up' : 'down', worker_last_run_min: worker, oldest_waiting_job_min: oldest, checked_at: new Date().toISOString() },
    { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
