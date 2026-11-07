// `pnpm cron:install` is the older name. Scheduling is packages/db/sql/schedule_jobs.sql,
// which reads app_base_url and cron_secret from Vault instead of storing them in cron.job.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./schedule.mjs', import.meta.url));
const result = spawnSync(process.execPath, [script, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
});
process.exit(result.status ?? 1);
