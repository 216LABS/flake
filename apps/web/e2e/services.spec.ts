import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { closeRunningStorms, login, SEASON, sql } from './helpers';

/** Issue 192: where a lot's services come from, said on screen, and walks and haul can be quoted. */
test('a lot shows its services; with no contract it says plow only, and a quote can add salt by the ton and walks', async ({ page, browser, baseURL }) => {
  await login(page);
  const tag = randomUUID().slice(0, 6);
  const c = await (await page.request.post('/api/customers', { data: { name: `Services ${tag}`, kind: 'commercial', billing_mode: 'manual', email: `${tag}@example.com` } })).json();
  const s = await (await page.request.post('/api/sites', { data: { customer_id: c.id, label: `Services lot ${tag}`, address: '1 Service St, Lakewood, OH', lat: 41.48, lon: -81.8 } })).json();

  // No signed contract: plow only, not billed, with a way to fix it.
  await page.goto(`/customers/${c.id}`);
  await expect(page.getByTestId('site-row').first().getByTestId('no-contract-chip')).toBeVisible();
  await expect(page.getByTestId('site-row').first()).not.toContainText('unavailable');
  await page.goto(`/sites/${s.id}`);
  await expect(page.getByTestId('lot-services')).toContainText('No signed contract: plow only, not billed');
  await expect(page.getByTestId('lot-services')).toContainText('Services come from the signed contract');

  // Quote plow, salt per ton and walks from the form.
  await page.getByTestId('make-quote').click();
  await page.getByTestId('q-price').fill('95');
  await page.getByTestId('q-salt').check();
  await page.getByTestId('q-salt-unit').selectOption('ton');
  await page.getByTestId('q-salt-price').fill('140');
  await page.getByTestId('q-walks').check();
  // Walks ticked with no price: it says so, and Send waits for it.
  await expect(page.getByTestId('q-problem')).toContainText('price for walks');
  await expect(page.getByTestId('q-send')).toBeDisabled();
  await page.getByTestId('q-walks-price').fill('35');
  await page.getByTestId('q-link-only').click();
  await expect(page.getByTestId('q-url')).toBeVisible();
  const [k] = await sql`select id, services, salt_pricing from contract where site_id = ${s.id}`;
  expect((k!.services as { service: string }[]).map((x) => x.service)).toEqual(['plow', 'salt', 'walks']);
  expect(k!.salt_pricing).toEqual({ unit: 'ton', amount_cents: 14000 });

  // Signed: the lot lists them, and the driver gets a Walks button.
  await sql`update contract set status = 'accepted', accepted_at = now(), season = ${SEASON} where id = ${k!.id}`;
  await page.reload();
  await expect(page.getByTestId('lot-services').getByTestId('chip-walks')).toBeVisible();
  await expect(page.getByTestId('lot-services').getByTestId('chip-salt')).toBeVisible();
  await expect(page.getByTestId('lot-services').getByTestId('chip-plow')).toContainText('2" trigger');

  await closeRunningStorms();
  const [crew] = await sql`select c.id from crew_member c join tenant t on t.id = c.tenant_id where t.slug = 'lakeshore-demo' and c.active limit 1`;
  const route = await (await page.request.post('/api/routes', { data: { name: `Services ${tag}`, default_crew_id: crew!.id, site_ids: [s.id] } })).json();
  const { id } = await (await page.request.post('/api/storms', { data: { name: `Services ${tag}`, routeIds: [route.id] } })).json();
  expect((await page.request.post(`/api/storms/${id}/publish`)).ok()).toBe(true);
  const live = await (await page.request.get(`/api/storms/${id}/live`)).json();
  const ctx = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
  const phone = await ctx.newPage();
  try {
    await phone.goto(live.runs[0].link);
    await phone.getByTestId('arrive').click();
    await expect(phone.getByTestId('service-walks')).toBeVisible();
    await expect(phone.getByTestId('service-salt')).toBeVisible();
  } finally {
    await ctx.close();
    await closeRunningStorms();
    await page.request.patch(`/api/routes/${route.id}`, { data: { archived: true } }).catch(() => null);
  }
});
