import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { login, sql } from './helpers';

/** A company paid by check says where checks go, once, and every customer who owes it sees that on their records page. */
test('payment details saved in Settings show on the records page of a customer who owes a bill', async ({ page, browser, baseURL }) => {
  await login(page);
  const tag = randomUUID().slice(0, 6);
  try {
    await page.goto('/settings?tab=payments');
    await page.getByTestId('pay-instructions-input').fill(`Checks to Lakeshore ${tag}, 12 Main St, Lakewood OH.`);
    await page.getByTestId('pay-instructions-save').click();
    await expect(page.getByTestId('pay-instructions-msg')).toHaveText('Saved');
    await page.reload();
    await expect(page.getByTestId('pay-instructions-input')).toHaveValue(`Checks to Lakeshore ${tag}, 12 Main St, Lakewood OH.`);

    const c = await (await page.request.post('/api/customers', { data: { name: `Pays ${tag}`, kind: 'commercial', billing_mode: 'manual', email: `${tag}@example.com` } })).json();
    const [s] = await sql`insert into storm (tenant_id, name, started_at, closed_at, status) values (${c.tenant_id}, ${`Pay how ${tag}`}, now() - interval '2 days', now() - interval '1 day', 'billed') returning id`;
    await sql`insert into invoice_draft (tenant_id, storm_id, customer_id, lines, subtotal_cents, flags, status) values (${c.tenant_id}, ${s!.id}, ${c.id}, '[]'::jsonb, 9000, '[]'::jsonb, 'approved')`;
    const { url } = await (await page.request.get(`/api/customers/${c.id}/portal`)).json();
    const guest = await browser.newContext({ baseURL, viewport: { width: 375, height: 667 } });
    const g = await guest.newPage();
    await g.goto(url);
    await expect(g.getByTestId('portal-pay-offline')).toContainText(`Checks to Lakeshore ${tag}, 12 Main St, Lakewood OH.`);
    expect(await g.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await guest.close();
  } finally {
    // The demo company is shared by every test: put it back the way it was.
    await sql`update tenant set pay_instructions = null where slug = 'lakeshore-demo'`;
  }
});
