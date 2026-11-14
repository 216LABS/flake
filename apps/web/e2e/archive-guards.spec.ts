import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { login, sql } from './helpers';

/** Archived things stay archived: no new lots for an archived customer, no archived route on a new storm. */
test('an archived customer gets no new lots, and an archived route is not offered or accepted for a storm', async ({ page }) => {
  await login(page);
  const tag = randomUUID().slice(0, 6);
  const c = await (await page.request.post('/api/customers', { data: { name: `Gone ${tag}`, kind: 'residential', billing_mode: 'manual', email: `${tag}@example.com` } })).json();
  const s = await (await page.request.post('/api/sites', { data: { customer_id: c.id, label: `Gone lot ${tag}`, address: '5 Gone St, Lakewood, OH', lat: 41.48, lon: -81.8 } })).json();
  expect((await page.request.patch(`/api/customers/${c.id}`, { data: { archived: true } })).ok()).toBe(true);
  const add = await page.request.post('/api/sites', { data: { customer_id: c.id, label: `Another ${tag}`, address: '6 Gone St, Lakewood, OH', lat: 41.48, lon: -81.8 } });
  expect(add.status()).toBe(409);
  expect((await page.request.patch(`/api/sites/${s.id}`, { data: { active: true } })).status()).toBe(409);

  const r = await (await page.request.post('/api/routes', { data: { name: `Old route ${tag}`, site_ids: [] } })).json();
  expect((await page.request.patch(`/api/routes/${r.id}`, { data: { archived: true } })).ok()).toBe(true);
  await page.goto('/storms');
  await expect(page.getByTestId('create-storm')).toBeVisible();
  await expect(page.getByText(`Old route ${tag}`)).toHaveCount(0);
  const start = await page.request.post('/api/storms', { data: { name: `Old ${tag}`, routeIds: [r.id], crewAssignments: {} } });
  expect(start.status()).toBe(409);
});

/** A season typed some other way (2026/27, Winter 26) can't be told apart from others, so renewals would misfire. */
test('a quote season must be written like 2026-27', async ({ page }) => {
  await login(page);
  const tag = randomUUID().slice(0, 6);
  const c = await (await page.request.post('/api/customers', { data: { name: `Season ${tag}`, kind: 'residential', billing_mode: 'manual', email: `${tag}@example.com` } })).json();
  const s = await (await page.request.post('/api/sites', { data: { customer_id: c.id, label: `Season lot ${tag}`, address: '7 Season St, Lakewood, OH', lat: 41.48, lon: -81.8 } })).json();
  const quote = (season: string) => page.request.post('/api/quotes', { data: { site_id: s.id, season, services: [{ service: 'plow', trigger_in: 2, pricing: { type: 'per_push', amount_cents: 5000 } }], send: false } });
  for (const bad of ['2026/27', 'Winter 26', '2026-28']) {
    const r = await quote(bad);
    expect(r.status()).toBe(422);
    expect((await r.json()).error).toContain('like 2026-27');
  }
  expect((await quote('2026-27')).status()).toBe(201);
});

/** Issue 124: a season of billed storms waits behind Show older, and the billing picker puts storms to bill first. */
test('the storms list keeps live and unbilled storms up top and older billed ones behind a link', async ({ page }) => {
  await login(page);
  const tag = randomUUID().slice(0, 6);
  const t = (await sql`select id from tenant where slug = 'lakeshore-demo'`)[0]!.id;
  for (let i = 0; i < 7; i++) await sql`insert into storm (tenant_id, name, started_at, closed_at, status) values (${t}, ${`Billed ${tag} ${i}`}, now() - make_interval(days => ${400 + i}), now() - make_interval(days => ${399 + i}), 'billed')`;
  const [old] = await sql`insert into storm (tenant_id, name, started_at, closed_at, status) values (${t}, ${`Unbilled ${tag}`}, now() - interval '500 days', now() - interval '499 days', 'closed') returning id`;
  await page.goto('/storms');
  await expect(page.getByText(`Unbilled ${tag}`)).toBeVisible();
  await expect(page.getByText(`Billed ${tag} 6`)).toHaveCount(0);
  await page.getByTestId('older-storms').click();
  await expect(page.getByText(`Billed ${tag} 6`)).toBeVisible();
  await page.goto('/billing');
  await expect(page.getByTestId('storm-picker').locator('optgroup[label="Ready to bill"] option', { hasText: `Unbilled ${tag}` })).toHaveCount(1);
  await sql`update storm set status = 'billed' where id = ${old!.id}`;
});
