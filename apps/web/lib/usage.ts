import { serviceDb, sql } from '@flake/db';
import { isTestEnv } from './env';

const MB = 1024 * 1024;

export interface Usage { files_mb: number; files_limit_mb: number; db_mb: number; db_limit_mb: number; near_limit: boolean }

/** Files and database against the plan limits, which default to Supabase Free. Only for whoever runs this deployment. */
export async function deploymentUsage(): Promise<Usage> {
  const [row] = (await serviceDb().execute(sql`
    select (select coalesce(sum((metadata->>'size')::bigint), 0) from storage.objects)::bigint as files,
           pg_database_size(current_database())::bigint as db`)) as unknown as { files: string; db: string }[];
  const files_limit_mb = Number(process.env.STORAGE_LIMIT_MB ?? 1024);
  const db_limit_mb = Number(process.env.DB_LIMIT_MB ?? 500);
  const files_mb = Math.round(Number(row!.files) / MB);
  const db_mb = Math.round(Number(row!.db) / MB);
  return { files_mb, files_limit_mb, db_mb, db_limit_mb, near_limit: files_mb >= files_limit_mb * 0.8 || db_mb >= db_limit_mb * 0.8 };
}

export function canSeeUsage(email: string | null) {
  if (isTestEnv()) return true;
  const admins = (process.env.ADMIN_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return Boolean(email && admins.includes(email.toLowerCase()));
}

export interface CronCalls { total: number; failed: number; last_error: string | null; last_failed_at: string | null }

/**
 * The scheduler's calls into the app, from pg_net's response log (pg_net keeps about 6 hours of it). pg_cron marks a run
 * succeeded as soon as the request is queued, so a call that died in transit only shows up here. Null when pg_net isn't
 * installed or this role can't read it, as on a laptop.
 */
export async function cronCalls(): Promise<CronCalls | null> {
  try {
    const [row] = (await serviceDb().execute(sql`
      select count(*)::int as total,
             count(*) filter (where error_msg is not null or status_code is null or status_code >= 400)::int as failed,
             (select coalesce(error_msg, 'HTTP ' || status_code) from net._http_response
               where error_msg is not null or status_code is null or status_code >= 400 order by created desc limit 1) as last_error,
             (select created from net._http_response
               where error_msg is not null or status_code is null or status_code >= 400 order by created desc limit 1) as last_failed_at
      from net._http_response`)) as unknown as { total: number; failed: number; last_error: string | null; last_failed_at: string | Date | null }[];
    if (!row) return null;
    return { total: row.total, failed: row.failed, last_error: row.last_error, last_failed_at: row.last_failed_at ? new Date(row.last_failed_at).toISOString() : null };
  } catch {
    return null;
  }
}
