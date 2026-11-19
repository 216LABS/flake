import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { login, SEASON, sql } from './helpers';

/** Issue 129: a brand-new company's first screens say what to do first, instead of "unavailable" and empty pickers. */
test('a new company sees a first-run card, an empty Proof page that explains itself, and an empty crew note', async ({ page }) => {
  const email = `first-${Date.now()}-${randomUUID().slice(0, 4)}@flake.test`;
  const signup = await page.request.post(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/signup`, { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! }, data: { email, password: 'flake-demo-only' } });
  expect(signup.ok()).toBe(true);
  await page.request.post('/api/dev/login', { data: { email } });
  await page.goto('/dashboard');
  await page.waitForURL('**/onboarding');
  await page.getByTestId('company').fill('First Run QA');
  await page.getByTestId('agree-terms').check();
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
  // Issue 139: a company whose only customer is archived is back to the first-run card, worded for it.
  const c = await (await page.request.post('/api/customers', { data: { name: 'Gone Soon', kind: 'residential', billing_mode: 'manual' } })).json();
  await page.goto('/dashboard');
  await expect(page.getByTestId('first-run')).toHaveCount(0);
  expect((await page.request.patch(`/api/customers/${c.id}`, { data: { archived: true } })).ok()).toBe(true);
  await page.goto('/dashboard');
  await expect(page.getByTestId('first-run')).toContainText('No active customers');
  await expect(page.getByRole('main').getByRole('link', { name: 'Start a storm' })).toHaveCount(0);
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

/** The dashboard's waiting-quote count leaves out archived customers' lots, the same as the list it links to. */
test('archiving a customer takes their waiting quote out of the dashboard count', async ({ page }) => {
  await login(page);
  const count = async () => {
    await page.goto('/dashboard');
    const t = await page.getByTestId('quotes-waiting').textContent().catch(() => null);
    return t ? Number(/(\d+) quotes? (is|are) waiting/.exec(t)?.[1] ?? 0) : 0;
  };
  const before = await count();
  const tag = randomUUID().slice(0, 6);
  const c = await (await page.request.post('/api/customers', { data: { name: `Waits ${tag}`, kind: 'commercial', billing_mode: 'manual', email: `${tag}@example.com` } })).json();
  const s = await (await page.request.post('/api/sites', { data: { customer_id: c.id, label: `Lot ${tag}`, address: '9 Wait St, Lakewood, OH', lat: 41.48, lon: -81.8 } })).json();
  const made = await page.request.post('/api/quotes', { data: { site_id: s.id, season: SEASON, services: [{ service: 'plow', trigger_in: 2, pricing: { type: 'per_push', amount_cents: 5000 } }], send: false } });
  expect(made.ok()).toBe(true);
  const quoteUrl = (await made.json()).url as string;
  expect(await count()).toBe(before + 1);
  const quoteRow = (await sql`select status from contract where site_id = ${s.id}`)[0]!;
  expect(quoteRow.status).toBe('draft');
  await page.request.patch(`/api/customers/${c.id}`, { data: { archived: true } });
  expect(await count()).toBe(before);
  // The unsigned quote is withdrawn with the lot, so the link can't sign a contract for a retired lot.
  expect((await sql`select status from contract where site_id = ${s.id}`)[0]!.status).toBe('void');
  // And the customer opening it is told it was withdrawn, and by whom, not shown a bare "not found".
  await page.goto(quoteUrl);
  await expect(page.getByTestId('quote-withdrawn')).toContainText('withdrew this quote');
});
