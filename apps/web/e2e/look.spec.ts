import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { closeRunningStorms, login, sql, startStorm } from './helpers';

/** The look: dark mode that still reads, small choices as one-tap segments, and storm stops that stay compact. */

const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

async function seriousProblems(page: Page) {
  await page.evaluate(axeSource);
  return page.evaluate(async () => {
    const { violations } = await (window as unknown as { axe: { run: (d: Document, o: object) => Promise<{ violations: { id: string; impact: string | null; nodes: { target: string[] }[] }[] }> } }).axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa'] });
    return violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(', ')}`);
  });
}

test('in dark mode every screen turns dark and still passes contrast', async ({ page, browser, baseURL }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  for (const url of ['/', '/pricing', '/login']) {
    await page.goto(url);
    expect(await seriousProblems(page), `${url} in dark`).toEqual([]);
  }
  await login(page);
  const { id } = await startStorm(page.request, `Dark ${Date.now()}`, ['West Lakewood', 'Rocky River']);
  for (const url of ['/dashboard', '/storms', `/storms/${id}`, '/customers', '/customers/new', '/routes', '/billing', '/proof', '/reports', '/settings?tab=rate', '/settings?tab=crew', '/settings?tab=team', '/settings?tab=system']) {
    await page.goto(url);
    await page.waitForLoadState('networkidle');
    // The page really is dark, not a light page with a dark header.
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg, url).toBe('rgb(15, 26, 34)');
    expect(await seriousProblems(page), `${url} in dark`).toEqual([]);
  }
  const [c] = await sql`select c.id from customer c join tenant t on t.id = c.tenant_id where t.slug = 'lakeshore-demo' limit 1`;
  const { url } = await (await page.request.get(`/api/customers/${c!.id}/portal`)).json();
  const guest = await browser.newContext({ baseURL, colorScheme: 'dark' });
  const g = await guest.newPage();
  await g.goto(url);
  expect(await seriousProblems(g), 'records page in dark').toEqual([]);
  await guest.close();
  await closeRunningStorms();
});

test('a light setting keeps the office light', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await login(page);
  await page.goto('/dashboard');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(246, 245, 241)');
});

test('kind is one tap, and the arrow keys move between kinds', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await login(page);
  await page.goto('/customers/new');
  const kind = page.getByTestId('kind');
  await expect(kind.getByRole('radio', { name: 'Commercial' })).toBeChecked();
  await kind.getByText('Residential').click();
  await expect(kind.getByRole('radio', { name: 'Residential' })).toBeChecked();
  await page.keyboard.press('ArrowRight');
  await expect(kind.getByRole('radio', { name: 'HOA' })).toBeChecked();
  // All three fit side by side on a small phone.
  const boxes = await kind.locator('label').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
  expect(new Set(boxes.map(Math.round)).size).toBe(1);
});

for (const width of [390, 375]) {
  test(`storm stops keep their controls on one row, each named for its stop, at ${width} wide`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await login(page);
    const { id, runs } = await startStorm(page.request, `Rows ${width} ${Date.now()}`, ['West Lakewood', 'Rocky River']);
    await page.goto(`/storms/${id}`);
    const open = page.locator('[data-testid="stop-card"][data-status="open"]');
    await expect(open.first()).toBeVisible();
    for (const card of (await open.all()).slice(0, 4)) {
      const tops = await card.locator('[data-testid="move-up"], [data-testid="move-down"], [data-testid="move-to"], [data-testid="skip-toggle"]').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
      expect(new Set(tops).size, 'controls wrapped onto a second row').toBe(1);
    }
    const label = runs[0]!.stops[0]!.label;
    await expect(page.getByRole('button', { name: `Skip ${label}`, exact: true })).toHaveCount(1);
    await closeRunningStorms();
  });
}

test('a master route lists each stop on one line with icon controls named for the stop', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await login(page);
  await page.goto('/routes');
  const row = page.getByTestId('route-up').nth(1).locator('xpath=..');
  const tops = await row.locator('button').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);
  // Under 60px: a short name used to wrap onto three lines beside wordy buttons.
  expect((await row.boundingBox())!.height).toBeLessThan(60);
  await expect(row.getByTestId('route-remove')).toHaveAttribute('aria-label', /^Remove .+/);
});

test('customers can be found by a street, and each phone card is one summary line', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await login(page);
  const tag = `Zq${Date.now().toString(36)}`;
  const c = await (await page.request.post('/api/customers', { data: { name: `Search ${tag}`, kind: 'hoa', email: `${tag.toLowerCase()}@example.com`, billing_mode: 'invoice_net30' } })).json();
  await page.request.post('/api/sites', { data: { customer_id: c.id, label: 'Front lot', address: `12 ${tag} Ave, Lakewood, OH`, lat: 41.48, lon: -81.8 } });
  await page.goto('/customers');
  await page.getByTestId('customer-search').fill(`${tag} ave`);
  await page.getByTestId('customer-search').press('Enter');
  await expect(page.getByTestId('customer-search-count')).toContainText('1 customer matches');
  const row = page.getByTestId('customer-row');
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId('customer-summary')).toHaveText('HOA · 1 site · Net-30 invoice · no payment on file');
  await page.getByTestId('customer-search').fill('no such customer anywhere');
  await page.getByTestId('customer-search').press('Enter');
  await expect(page.getByText('No customers match')).toBeVisible();
  await sql`update customer set archived_at = now() where id = ${c.id}`;
});

test('on a phone, Start a storm jumps past the storm list to the form, and statuses say what is next', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto('/dashboard');
  await page.getByRole('link', { name: 'Start a storm' }).click();
  await page.waitForURL(/\/storms#start$/);
  await expect(page.getByTestId('storm-name')).toBeInViewport();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByTestId('jump-start-storm').click();
  await expect(page.getByTestId('storm-name')).toBeInViewport();
  const words = await page.locator('main li span.font-display').allTextContents();
  for (const w of words) expect(['Live', 'Ready to bill', 'Billed']).toContain(w);
});
