import { execSync } from 'node:child_process';

/** The seed is idempotent, so this is safe whatever state the database is in. */
export default function globalSetup() {
  execSync('pnpm seed:demo', { stdio: 'inherit' });
}
