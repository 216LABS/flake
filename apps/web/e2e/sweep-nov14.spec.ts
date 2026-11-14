import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { login, sql } from './helpers';

/** Issue 129: a brand-new company's first screens say what to do first, instead of "unavailable" and empty pickers. */
test('a new company sees a first-run card, an empty Proof page that explains itself, and an empty crew note', async ({ page }) => {
  const email = `first-${Date.now()}-${randomUUID().slice(0, 4)}@flake.test`;
  const signup = await page.request.post(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/signup`, { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! }, data: { email, password: 'flake-demo-only' } });
  expect(signup.ok()).toBe(true);
  await page.request.post('/api/dev/login', { data: { email } });
  await page.goto('/dashboard');
  await page.waitForURL('**/onboarding');
  await page.getByTestId('company').fill('First Run QA');
  await page.getByTestId('create-company').click();
  await page.waitForURL('**/dashboard');
  await expect(page.getByTestId('first-run')).toContainText('Add your first customer');
  await expect(page.getByTestId('conditions')).toHaveCount(0);
  // Nothing to plow yet, so no Start a storm up top.
  await expect(page.getByRole('main').getByRole('link', { name: 'Start a storm' })).toHaveCount(0);
  await expect(page.getByText('unavailable')).toHaveCount(0);
  await page.goto('/proof');
  await expect(page.getByText('No lots yet')).toBeVisible();
  await expect(page.getByTestId('proof-site')).toHaveCount(0);
  await page.goto('/settings?tab=crew');
  await expect(page.getByTestId('crew-empty')).toBeVisible();
});

/** Issue 130: an unknown packet id is a 404, not "pending" forever; a real one is pending or ready. */
test('proof status: unknown ids are 404, a packet this company queued is pending or ready', async ({ page }) => {
  await login(page);
  expect((await page.request.get(`/api/proof/${randomUUID()}`)).status()).toBe(404);
  expect((await page.request.get('/api/proof/not-a-uuid')).status()).toBe(404);
  const [s] = await sql`select s.id from site s join tenant t on t.id = s.tenant_id where t.slug = 'lakeshore-demo' and s.active limit 1`;
  const made = await page.request.post('/api/proof', { data: { siteId: s!.id, from: new Date(Date.now() - 30 * 86400000).toISOString(), to: new Date().toISOString() } });
  expect(made.status()).toBe(202);
  const { id } = await made.json();
  expect([200, 202]).toContain((await page.request.get(`/api/proof/${id}`)).status());
});

/** Issue 135: the same customer sent twice at once is one customer, and a storm whose bills were all voided says so. */
test('a double-sent customer is created once, and a storm with every bill voided reads "Closed, no bills"', async ({ page }) => {
  await login(page);
  const tag = randomUUID().slice(0, 6);
  const body = { data: { name: `Burst ${tag}`, kind: 'commercial', billing_mode: 'manual' } };
  const codes = (await Promise.all([1, 2, 3].map(() => page.request.post('/api/customers', body)))).map((r) => r.status()).sort();
  expect(codes).toEqual([201, 409, 409]);
  expect((await sql`select count(*)::int as n from customer where name = ${`Burst ${tag}`}`)[0]!.n).toBe(1);
  const [c] = await sql`select id, tenant_id from customer where name = ${`Burst ${tag}`}`;
  const [s] = await sql`insert into storm (tenant_id, name, started_at, closed_at, status) values (${c!.tenant_id}, ${`Voided ${tag}`}, now() - interval '3 hours', now() - interval '2 hours', 'billed') returning id`;
  await sql`insert into invoice_draft (tenant_id, storm_id, customer_id, lines, subtotal_cents, flags, status) values (${c!.tenant_id}, ${s!.id}, ${c!.id}, '[]'::jsonb, 4000, '[]'::jsonb, 'void')`;
  await page.goto('/storms');
  await expect(page.getByRole('link', { name: new RegExp(`Voided ${tag}`) })).toContainText('Closed, no bills');
});

/** Issue 127: keyboard users can skip the nav, and list links and the flagged-only filter are big enough to tap. */
test('skip link, tap targets of at least 24 px on list links, and a tappable flagged-only filter', async ({ page }) => {
  await login(page);
  await page.goto('/customers');
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('skip-link')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
  const heights = await page.getByTestId('customer-row').first().getByRole('link').first().evaluate((a) => a.getBoundingClientRect().height);
  expect(heights).toBeGreaterThanOrEqual(24);
  // Issue 138: inline links in a banner line, and standalone links, are as tall as list links.
  await page.goto('/dashboard');
  for (const h of await page.locator('main p a, main a.inline-block').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) expect(h).toBeGreaterThanOrEqual(24);
  await page.goto('/billing');
  const label = page.getByTestId('flagged-only').locator('xpath=..');
  if (await label.count()) expect((await label.boundingBox())!.height).toBeGreaterThanOrEqual(24);
});
