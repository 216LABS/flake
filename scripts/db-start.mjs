// Starts the local Supabase stack (project id "flake", ports 553xx) and writes apps/web/.env.local.
// Values are local-only defaults from the CLI plus freshly generated secrets. The file is gitignored.
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const run = (cmd, stdio = 'inherit') => execSync(cmd, { stdio, encoding: 'utf8' });
const parseEnv = (text, re) =>
  Object.fromEntries(text.split(/\r?\n/).map((l) => l.match(re)).filter(Boolean).map((m) => [m[1], m[2]]));

// Right after Docker restarts the containers can still be coming back, and on a CI runner a 553xx port can be briefly
// taken by an outgoing connection (it's inside Linux's ephemeral range). Either way a clean stop and another start
// clears it, so try up to three times before failing the run.
for (let attempt = 1; ; attempt++) {
  try {
    run('pnpm --filter @flake/db exec supabase start');
    break;
  } catch (err) {
    if (attempt === 3) throw err;
    console.log(`Supabase did not start (try ${attempt} of 3). Stopping what started, then trying again in ${attempt * 10} seconds.`);
    try { run('pnpm --filter @flake/db exec supabase stop'); } catch { /* nothing was running */ }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, attempt * 10000);
  }
}
const raw = run('pnpm --silent --filter @flake/db exec supabase status -o env', 'pipe');
const status = parseEnv(raw, /^([A-Z_]+)="?([^"]*)"?$/);
const path = 'apps/web/.env.local';
const prior = existsSync(path) ? parseEnv(readFileSync(path, 'utf8'), /^([A-Z_0-9]+)=(.*)$/) : {};
const env = {
  APP_ENV: 'local',
  NEXT_PUBLIC_APP_ENV: 'local',
  APP_BASE_URL: 'http://localhost:3000',
  PROVIDERS_MODE: 'mock',
  NEXT_PUBLIC_PROVIDERS_MODE: 'mock',
  CRON_SECRET: prior.CRON_SECRET ?? randomBytes(24).toString('hex'),
  LINK_TOKEN_SECRET: prior.LINK_TOKEN_SECRET ?? randomBytes(32).toString('hex'),
  NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
  DATABASE_URL: status.DB_URL,
  NWS_USER_AGENT: '(flake.216labs.dev, sam@216labs.dev)',
};
writeFileSync(path, Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
console.log(`Wrote ${path}. Next: pnpm seed:demo && pnpm dev`);
