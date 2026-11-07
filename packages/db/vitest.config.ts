import { readFileSync, existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const envFile = '../../apps/web/.env.local';
const dbUrl = existsSync(envFile) ? /^DATABASE_URL=(.*)$/m.exec(readFileSync(envFile, 'utf8'))?.[1]?.trim() : undefined;

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    env: { DATABASE_URL: process.env.DATABASE_URL ?? dbUrl ?? '' },
    testTimeout: 30000,
    pool: 'forks',
  },
});
