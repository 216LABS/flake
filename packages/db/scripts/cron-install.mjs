// Schedules Flake's cron routes from inside Supabase with pg_cron and pg_net, which are on the free plan.
// This replaces Vercel Cron, because Vercel Hobby rejects any schedule more frequent than daily.
// Safe to re-run: schedules are upserted by name. Needs DATABASE_URL, APP_BASE_URL and CRON_SECRET in the environment.
// `--remove` takes them all out.
import postgres from 'postgres';

const { DATABASE_URL, APP_BASE_URL, CRON_SECRET, CRON_JOBS_EVERY_MINUTES = '2' } = process.env;
if (!DATABASE_URL) throw new Error('DATABASE_URL is required');
const sql = postgres(DATABASE_URL, { prepare: false, max: 1, onnotice: () => {} });

const PREFIX = 'flake_';
try {
  if (process.argv.includes('--remove')) {
    const jobs = await sql`select jobname from cron.job where jobname like ${`${PREFIX}%`}`;
    for (const j of jobs) await sql`select cron.unschedule(${j.jobname})`;
    console.log(`Removed ${jobs.length} schedules.`);
  } else {
    if (!APP_BASE_URL || !CRON_SECRET) throw new Error('APP_BASE_URL and CRON_SECRET are required');
    await sql`create extension if not exists pg_cron`;
    await sql`create extension if not exists pg_net`;
    const base = APP_BASE_URL.replace(/\/$/, '');
    const routes = [
      // Every 2 minutes by default. Each run uses a little of Vercel Hobby's monthly CPU allowance, and a route
      // link arriving a minute later doesn't matter. Set CRON_JOBS_EVERY_MINUTES=1 on a paid plan.
      ['jobs', `*/${Number(CRON_JOBS_EVERY_MINUTES)} * * * *`, '/api/cron/jobs'],
      ['weather', '*/15 * * * *', '/api/cron/weather'],
      ['nohrsc', '7 */6 * * *', '/api/cron/nohrsc'],
      ['late_check', '*/5 * * * *', '/api/cron/late-check'],
      ['reports', '*/15 * * * *', '/api/cron/reports'],
    ];
    const headers = JSON.stringify({ Authorization: `Bearer ${CRON_SECRET}` });
    for (const [name, schedule, path] of routes) {
      await sql`select cron.schedule(${PREFIX + name}, ${schedule}, format('select net.http_get(url := %L, headers := %L::jsonb, timeout_milliseconds := 60000)', ${base + path}::text, ${headers}::text))`;
    }
    // The run log gets a row per run and would slowly eat a 500 MB database.
    await sql`select cron.schedule(${`${PREFIX}prune_log`}, '30 3 * * *', 'delete from cron.job_run_details where end_time < now() - interval ''3 days''')`;
    console.log(`Scheduled ${routes.length + 1} jobs against ${base}.`);
  }
} finally {
  await sql.end();
}
