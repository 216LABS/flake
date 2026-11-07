import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const file = resolve(__dirname, '.env.local');
const fromFile = existsSync(file)
  ? Object.fromEntries(readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.match(/^([A-Z_0-9]+)=(.*)$/)).filter(Boolean).map((m) => [m![1]!, m![2]!]))
  : {};

export default defineConfig({
  resolve: { alias: { '@': resolve(__dirname) } },
  test: {
    include: ['test/**/*.test.ts'],
    env: { ...fromFile, APP_ENV: 'test', PROVIDERS_MODE: 'mock', APP_BASE_URL: 'http://localhost:3999', DB_POOL_MAX: '5' },
    testTimeout: 60000,
    hookTimeout: 60000,
    pool: 'forks',
    fileParallelism: false,
  },
});
