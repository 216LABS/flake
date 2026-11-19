import { expect, test } from '@playwright/test';

test('the contract builder gives a PDF with no account', async ({ page }) => {
  await page.goto('/tools/snow-removal-contract');
  await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(1);
  await page.getByTestId('t-company').fill('Example Plow');
  await page.getByTestId('t-client').fill('Example Client');
  await page.getByTestId('t-site').fill('1 Main St');
  await page.getByTestId('t-price').fill('$65 per push');
  const download = page.waitForEvent('download');
  await page.getByTestId('t-download').click();
  expect((await download).suggestedFilename()).toBe('snow-removal-contract.pdf');
});

test('the pricing calculator estimates and labels its assumptions', async ({ page }) => {
  await page.goto('/tools/snow-removal-pricing-calculator');
  await expect(page.getByText('Your assumptions, not market data')).toBeVisible();
  await page.getByTestId('calc-sqft').fill('40000');
  await page.getByTestId('calc-run').click();
  await expect(page.getByTestId('calc-push')).toHaveText('$240.00');
  await page.getByTestId('calc-sqft').fill('');
  await page.getByTestId('calc-address').fill('14701 Detroit Ave, Lakewood, OH');
  await page.getByTestId('calc-run').click();
  await expect(page.getByTestId('calc-result')).toContainText('an estimate');
});

test('marketing and legal pages are honest and complete', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Your drivers tap a text link');
  await expect(page.getByText('In early testing')).toBeVisible();
  const home = (await page.locator('body').textContent())!.toLowerCase();
  for (const banned of ['testimonial', 'trusted by', 'customers love', '5 stars', 'as seen on']) expect(home).not.toContain(banned);
  // Issue 182: no plans or prices this season; the old pricing link lands on the free-season page.
  await page.goto('/pricing');
  await page.waitForURL('**/free-season');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Free for the 2026-27 season');
  for (const path of ['/', '/free-season', '/compare', '/login', '/legal/terms']) {
    await page.goto(path);
    const text = (await page.locator('body').textContent())!;
    expect(text, path).not.toMatch(/\$79(?!\d)|\$790|1% fee|0\.5%|Go Pro|up to 25 sites/);
    await expect(page.locator('a[href="/pricing"]'), path).toHaveCount(0);
  }
  await page.goto('/legal/privacy');
  await expect(page.getByText('No mobile information will be shared with third parties')).toBeVisible();
  await page.goto('/legal/sms-terms');
  await expect(page.getByText('Reply STOP', { exact: false })).toBeVisible();
  await page.goto('/legal/terms');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Terms of Service');
});

test('office pages send visitors to sign in, and the API refuses them', async ({ page, request }) => {
  await page.goto('/dashboard');
  await page.waitForURL('**/login');
  expect((await request.get('/api/customers')).status()).toBe(401);
  expect((await request.post('/api/billing/approve', { data: { draftIds: [] } })).status()).toBe(401);
  expect((await request.get('/api/cron/jobs')).status()).toBe(401);
});

test('security headers are present', async ({ request }) => {
  const res = await request.get('/');
  expect(res.headers()['content-security-policy']).toContain("default-src 'self'");
  expect(res.headers()['x-content-type-options']).toBe('nosniff');
});

test('health check answers for an uptime monitor and says nothing private', async ({ request }) => {
  const ok = await request.get('/api/health');
  expect(ok.status()).toBe(200);
  const body = await ok.json();
  expect(body).toMatchObject({ ok: true, database: 'up' });
  expect(JSON.stringify(body)).not.toMatch(/tenant|email|token/i);
});
