// Starts the local Supabase stack (project id "flake", ports 553xx) and writes apps/web/.env.local.
// Values are local-only defaults from the CLI plus freshly generated secrets. The file is gitignored.
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const run = (cmd, stdio = 'inherit') => execSync(cmd, { stdio, encoding: 'utf8' });
const parseEnv = (text, re) =>
  Object.fromEntries(text.split(/\r?\n/).map((l) => l.match(re)).filter(Boolean).map((m) => [m[1], m[2]]));

// Right after Docker restarts, the containers can still be coming back, so give it a second try.
try {
  run('pnpm --filter @flake/db exec supabase start');
} catch {
  console.log('Supabase was not ready. Trying once more in 10 seconds.');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10000);
  run('pnpm --filter @flake/db exec supabase start');
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
