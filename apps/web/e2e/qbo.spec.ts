import { expect, test } from '@playwright/test';
import { login, sql } from './helpers';

/** Issue 162: connect the test QuickBooks company, pick items, match a customer, disconnect. */
test('accounting: connect QuickBooks, pick items, match a customer, disconnect', async ({ page }) => {
  await login(page);
  const reset = async () => {
    await sql`update integration set status = 'disconnected', token_enc = null, refresh_enc = null where tenant_id = (select id from tenant where slug = 'lakeshore-demo')`;
    await sql`update customer set qbo_customer_id = null where tenant_id = (select id from tenant where slug = 'lakeshore-demo')`;
    await sql`delete from qbo_item_map where tenant_id = (select id from tenant where slug = 'lakeshore-demo')`;
  };
  await reset();
  try {
    await page.goto('/settings?tab=accounting');
    await expect(page.getByTestId('qbo-status')).toHaveText('Not connected');
    await page.getByTestId('qbo-connect').click();
    await expect(page).toHaveURL(/tab=accounting&qbo=connected/);
    await expect(page.getByTestId('qbo-note')).toHaveText('QuickBooks is connected.');
    await expect(page.getByTestId('qbo-status')).toHaveText('Connected');

    // Tokens never reach the browser.
    const overview = await page.request.get('/api/integrations/qbo');
    expect(await overview.text()).not.toMatch(/mock-access|mock-refresh|token_enc/);

    await page.getByTestId('qbo-item-plow').selectOption({ label: 'Snow Plowing' });
    await page.getByTestId('qbo-item-salt').selectOption({ label: 'Salt' });
    await page.getByTestId('qbo-items-save').click();
    await expect(page.getByTestId('qbo-done')).toHaveText('Items saved.');
    expect((await sql`select count(*)::int as n from qbo_item_map where tenant_id = (select id from tenant where slug = 'lakeshore-demo')`)[0]!.n).toBe(2);

    const first = page.getByTestId('qbo-unmatched').first();
    const name = ((await first.locator('span').first().textContent()) ?? '').replace(/suggested by.*/, '').trim();
    await first.getByTestId('qbo-pick').selectOption('new');
    await page.getByTestId('qbo-match-save').click();
    await expect(page.getByTestId('qbo-done')).toContainText('1 created in QuickBooks');
    await expect(page.getByTestId('qbo-matched').filter({ hasText: name })).toBeAttached();

    await page.getByTestId('qbo-disconnect').click();
    await page.getByTestId('confirm-yes').click();
    await expect(page.getByTestId('qbo-status')).toHaveText('Not connected');
    expect((await sql`select count(*)::int as n from customer where qbo_customer_id is not null and tenant_id = (select id from tenant where slug = 'lakeshore-demo')`)[0]!.n).toBe(0);
  } finally {
    await reset();
  }
});
