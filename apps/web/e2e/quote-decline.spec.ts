import { expect, test } from '@playwright/test';
import { login, sql } from './helpers';

/** Issue 59: the customer can say no on the quote page, and the office sees it. */
test.use({ viewport: { width: 390, height: 844 } });
test.beforeEach(() => test.skip(test.info().project.name === 'pixel-7', 'Covered once, at iPhone size'));

test('a customer can decline a quote, and the office sees it with the reason', async ({ page, browser, baseURL }) => {
  await login(page);
  const [s] = await sql`select id from site where active and tenant_id = (select tenant_id from route where name = 'Rocky River' limit 1) order by created_at limit 1`;
  const res = await page.request.post('/api/quotes', { data: { site_id: s!.id, season: '2031-32', services: [{ service: 'plow', trigger_in: 2, pricing: { type: 'per_push', amount_cents: 7500 } }], send: false } });
  expect(res.ok(), await res.text()).toBe(true);
  const q = await res.json();
  const ctx = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
  const c = await ctx.newPage();
  await c.goto(q.url);
  await c.getByTestId('decline').click();
  await c.getByTestId('decline-reason').fill('Went with a neighbor this year');
  await c.getByTestId('decline-send').click();
  await expect(c.getByTestId('declined')).toBeVisible();
  await c.reload();
  await expect(c.getByTestId('declined')).toBeVisible();
  await ctx.close();
  await page.goto(`/sites/${s!.id}`);
  await expect(page.getByTestId('declined-note').first()).toContainText('Went with a neighbor this year');
  await sql`update contract set status = 'void' where season = '2031-32'`;
});

