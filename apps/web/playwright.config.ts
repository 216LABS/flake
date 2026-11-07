import { defineConfig, devices } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const file = resolve(process.cwd(), '.env.local');
const fromFile = existsSync(file)
  ? Object.fromEntries(readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.match(/^([A-Z_0-9]+)=(.*)$/)).filter(Boolean).map((m) => [m![1]!, m![2]!]))
  : {};
const PORT = 3100;
const env = { ...process.env, ...fromFile, APP_ENV: 'test', NEXT_PUBLIC_APP_ENV: 'test', PROVIDERS_MODE: 'mock', APP_BASE_URL: `http://localhost:${PORT}` } as Record<string, string>;
for (const [k, v] of Object.entries(env)) process.env[k] = v;

/**
 * Runs against next build + next start with mocks and the local Supabase. Viewports are iPhone 13 and Pixel 7 in
 * Chromium, plus the driver's offline run in WebKit, the closest thing here to Safari on an iPhone.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  retries: 0,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'iphone-13', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium', browserName: 'chromium' } },
    { name: 'pixel-7', use: { ...devices['Pixel 7'] } },
    { name: 'webkit-driver', testMatch: /driver\.spec/, grep: /offline: 3 stops/, use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: 'pnpm build && pnpm exec next start -p 3100',
    url: `http://localhost:${PORT}/api/tiles/mock/0/0/0`,
    timeout: 480_000,
    reuseExistingServer: false,
    env,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
