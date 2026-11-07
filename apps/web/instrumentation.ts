/**
 * Local and test only: there is no Vercel Cron on a laptop, so this drains the job table every 2 seconds.
 * Production uses /api/cron/jobs. Sentry starts only when a DSN is configured.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.SENTRY_DSN) {
    const Sentry = await import('@sentry/nextjs');
    Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0.05 });
  }
  const env = process.env.APP_ENV ?? 'local';
  if (env === 'production' || env === 'staging' || process.env.DISABLE_JOB_TICKER === '1') return;
  const { runJobs } = await import('./lib/handlers');
  let running = false;
  setInterval(() => {
    if (running) return;
    running = true;
    runJobs(50)
      .catch((err) => console.error('job ticker failed', err instanceof Error ? err.message : err))
      .finally(() => {
        running = false;
      });
  }, 2000);
}
