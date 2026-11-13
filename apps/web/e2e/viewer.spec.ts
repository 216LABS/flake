import { expect, test } from '@playwright/test';
import { closeRunningStorms, login } from './helpers';

/** Someone with view-only access isn't told to do things they can't. */
test('a viewer with no storm running is told the office starts one, not to start one', async ({ page, browser, baseURL }) => {
  await login(page);
  await closeRunningStorms();
  const email = `viewer-${Date.now()}@flake.test`;
  await page.request.post(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/signup`, { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! }, data: { email, password: 'flake-demo-only' } });
  expect((await page.request.post('/api/settings/team', { data: { email, role: 'viewer' } })).status()).toBe(201);
  const ctx = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
  const v = await ctx.newPage();
  await v.request.post('/api/dev/login', { data: { email } });
  await v.goto('/dashboard');
  await expect(v.getByTestId('view-only')).toBeVisible();
  await expect(v.getByText('The office starts one when snow is coming.')).toBeVisible();
  await expect(v.getByText('Start one by hand')).toHaveCount(0);
  await expect(v.getByRole('link', { name: 'Start a storm' })).toHaveCount(0);
  await ctx.close();
  await page.goto('/dashboard');
  await expect(page.getByText('Start one by hand, or wait for a trigger alert.')).toBeVisible();
});
