import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { finishStops, login, sql, startStorm } from './helpers';

/**
 * A company paid by check: the customer's portal shows the bill as due, the customer page shows what they owe, and
 * the office marks it paid when the check comes in.
 */
test('a bill paid by check is owed on the portal and customer page until the office marks it paid', async ({ page, browser, baseURL }) => {
  await login(page);
  const tag = randomUUID().slice(0, 6);
  const c = await (await page.request.post('/api/customers', { data: { name: `Check ${tag}`, kind: 'commercial', billing_mode: 'manual', email: `${tag}@example.com` } })).json();
  const [s] = await sql`insert into storm (tenant_id, name, started_at, closed_at, status) values (${c.tenant_id}, ${`Checks ${tag}`}, now() - interval '2 days', now() - interval '1 day', 'billed') returning id`;
  await sql`insert into invoice_draft (tenant_id, storm_id, customer_id, lines, subtotal_cents, flags, status, status_detail) values (${c.tenant_id}, ${s!.id}, ${c.id}, ${sql.json([{ description: 'Front lot: plow', quantity: 1, amount_cents: 12500, unit_amount_cents: 12500, service: 'plow', site_id: null, source_visit_ids: [] }])}, 12500, '[]'::jsonb, 'approved', 'Manual billing: send the customer a bill, then press Mark paid when it is paid.')`;

  await page.goto(`/customers/${c.id}`);
  await expect(page.getByTestId('customer-owed')).toHaveText('Still owed: $125.00');
  await expect(page.getByTestId('customer-invoice')).toContainText('Approved');

  await page.goto('/dashboard');
  await expect(page.getByTestId('waiting-on')).toContainText(`Check ${tag}: $125.00`);

  const { url } = await (await page.request.get(`/api/customers/${c.id}/portal`)).json();
  const guest = await browser.newContext({ baseURL, viewport: { width: 375, height: 667 } });
  const g = await guest.newPage();
  await g.goto(url);
  await expect(g.getByTestId('portal-due')).toContainText('$125.00');
  await expect(g.getByTestId('portal-pay-offline')).toBeVisible();

  await page.goto(`/billing?storm=${s!.id}`);
  const row = page.locator('[data-testid="draft"]', { hasText: `Check ${tag}` });
  await row.getByTestId('mark-paid').click();
  await page.getByTestId('confirm-yes').click();
  await expect(row.getByTestId('draft-status')).toHaveText('Paid');

  await page.goto(`/customers/${c.id}`);
  await expect(page.getByTestId('customer-owed')).toHaveCount(0);
  await expect(page.getByTestId('customer-invoice')).toContainText('Paid outside Stripe');
  await g.reload();
  await expect(g.getByTestId('portal-due')).toHaveCount(0);
  await page.goto('/dashboard');
  await expect(page.getByText(`Check ${tag}`)).toHaveCount(0);
  await guest.close();
});

/** The phone died on site: billing review lets the office enter the time and bill the lot (found in the season walk). */
test('a lot with an Arrive and no Done is finished from billing review and bills', async ({ page }) => {
  await login(page);
  const { id, runs } = await startStorm(page.request, `Dead phone ${Date.now()}`, ['West Lakewood']);
  const run = runs[0]!;
  const [stop, ...rest] = run.stops;
  await finishStops(page.request, run, rest);
  const token = new URL(run.link).pathname.split('/').pop()!;
  const [site] = await sql`select lat, lon, label from site where id = ${stop!.site_id}`;
  expect((await page.request.post(`/api/d/${token}/actions`, { data: { actions: [{ client_uuid: randomUUID(), at: new Date(Date.now() - 1800_000).toISOString(), kind: 'arrive', run_stop_id: stop!.id, visit_client_uuid: randomUUID(), gps: { lat: site!.lat, lon: site!.lon, acc: 5 } }] } })).ok()).toBe(true);
  expect((await page.request.post(`/api/storms/${id}/close`, { data: { force: true } })).ok()).toBe(true);
  await page.goto(`/billing?storm=${id}`);
  const flag = page.locator('[data-testid="flag"][data-code="missing_visit"]', { hasText: site!.label as string });
  await expect(flag).toContainText('never tapped Done');
  await flag.getByTestId('finish-minutes').fill('30');
  await flag.getByTestId('fix-finish').click();
  await expect(page.locator('[data-testid="flag"][data-code="missing_visit"]', { hasText: site!.label as string })).toHaveCount(0);
});
