import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { login } from './helpers';

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
