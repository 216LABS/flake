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
