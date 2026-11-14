import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { login, sql } from './helpers';

/**
 * A company paid by check: the customer's portal shows the bill as due, the customer page shows what they owe, and
 * the office marks it paid when the check comes in.
 */
test('a bill paid by check is owed on the portal and customer page until the office marks it paid', async ({ page, browser, baseURL }) => {
  await login(page);
  const tag = randomUUID().slice(0, 6);
  const c = await (await page.request.post('/api/customers', { data: { name: `Check ${tag}`, kind: 'commercial', billing_mode: 'manual', email: `${tag}@example.com` } })).json();
  const [s] = await sql`insert into storm (tenant_id, name, started_at, closed_at, status) values (${c.tenant_id}, ${`Checks ${tag}`}, now() - interval '2 days', now() - interval '1 day', 'billed') returning id`;
  await sql`insert into invoice_draft (tenant_id, storm_id, customer_id, lines, subtotal_cents, flags, status, status_detail) values (${c.tenant_id}, ${s!.id}, ${c.id}, ${sql.json([{ description: 'Front lot: plow', quantity: 1, amount_cents: 12500, unit_amount_cents: 12500, service: 'plow', site_id: null, source_visit_ids: [] }])}, 12500, '[]'::jsonb, 'approved', 'Manual billing. Use the QuickBooks export.')`;

  await page.goto(`/customers/${c.id}`);
  await expect(page.getByTestId('customer-owed')).toHaveText('Still owed: $125.00');
  await expect(page.getByTestId('customer-invoice')).toContainText('Approved');

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
  await guest.close();
});
