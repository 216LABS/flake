// Applies packages/db/sql/schedule_jobs.sql. Needs a direct Postgres connection
// (port 5432) as a role that can create extensions and read Vault.
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required. Use the Supabase direct connection on port 5432, not the transaction pooler.');
  process.exit(1);
}

const sql = postgres(url, {
  prepare: false,
  max: 1,
  onnotice: (notice) => console.log(notice?.message ?? notice),
});

try {
  if (process.argv.includes('--remove')) {
    const jobs = await sql`select jobid, jobname from cron.job where jobname like 'flake-%' or jobname like 'flake_%'`;
    for (const job of jobs) {
      await sql`select cron.unschedule(${job.jobid}::bigint)`;
      console.log(`removed\t${job.jobname}`);
    }
  } else {
    await sql.file(fileURLToPath(new URL('../sql/schedule_jobs.sql', import.meta.url)));
    const jobs = await sql`select jobname, schedule from cron.job where jobname like 'flake-%' order by jobname`;
    for (const job of jobs) console.log(`${job.jobname}\t${job.schedule}`);
  }
} finally {
  await sql.end({ timeout: 5 });
}
