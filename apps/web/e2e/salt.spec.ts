import { expect, test } from '@playwright/test';
import { login, sql } from './helpers';

test('salt ordering: add a supplier, two orders fill a shared truck, the supplier delivers, fees show', async ({ page, browser, baseURL }) => {
  await login(page);
  // Suppliers are shared by every company. Earlier runs' suppliers are switched off so this one is the pick.
  await sql`update salt_supplier set active = false`;
  const name = `Lakeshore Salt ${Date.now()}`;

  // 216LABS adds a partner supplier.
  await page.goto('/admin/salt');
  await page.getByTestId('s-name').fill(name);
  await page.getByTestId('s-email').fill('orders@lakeshoresalt.test');
  await page.getByTestId('s-address').fill('2000 Train Ave, Cleveland, OH');
  await page.getByTestId('s-price').fill('78.50');
  await page.getByTestId('s-fee').fill('3.00');
  await page.getByTestId('s-add').click();
  await expect(page.getByTestId('supplier-row').filter({ hasText: name })).toBeVisible();
  const [sup] = await sql`select id from salt_supplier where name = ${name}`;
  const { suppliers } = await (await page.request.get('/api/admin/salt/suppliers')).json();
  const link = suppliers.find((s: { id: string }) => s.id === sup!.id).link as string;

  // A contractor checks the price for 8 tons and joins a shared load.
  await page.goto('/reports');
  const card = page.getByTestId('salt-order');
  await card.getByTestId('order-tons').fill('8');
  await card.getByTestId('salt-address').fill('14701 Detroit Ave, Lakewood, OH');
  await card.getByTestId('salt-quote').click();
  const quote = card.getByTestId('salt-quote-result');
  await expect(quote).toContainText(name);
  await expect(quote).toContainText('$78.50 a ton');
  await expect(quote).toContainText('8 of 22 tons');
  await card.getByTestId('salt-place').click();
  await expect(card.getByTestId('salt-msg')).toContainText("You're in a shared load, 8 of 22 tons");
  const row = card.getByTestId('salt-order-row').first();
  await expect(row).toHaveAttribute('data-status', 'pooling');
  await expect(row).toContainText('8 of 22 tons in this load so far');

  // A second order fills the truck, and it goes to the supplier.
  await card.getByTestId('order-tons').fill('14');
  await card.getByTestId('salt-address').fill('13600 Madison Ave, Lakewood, OH');
  await card.getByTestId('salt-quote').click();
  await expect(card.getByTestId('salt-quote-result')).toContainText('fills the shared load');
  await card.getByTestId('salt-place').click();
  await expect(card.getByTestId('salt-msg')).toContainText('filled the truck');
  await expect.poll(async () => (await sql`select count(*)::int as n from message_log where template = 'salt_supplier' and to_addr = 'orders@lakeshoresalt.test' and body like '%2 stops%'`)[0]!.n, { timeout: 30000 }).toBe(1);

  // The supplier opens their link: one full load with both stops. They set a date, then mark the first delivered.
  const guest = await browser.newContext({ baseURL });
  const s = await guest.newPage();
  await s.goto(link);
  const load = s.getByTestId('supplier-load');
  await expect(load.getByTestId('supplier-stop')).toHaveCount(2);
  const first = load.getByTestId('supplier-stop').first();
  await first.getByTestId('supplier-date').fill('2026-12-03');
  await first.getByTestId('supplier-schedule').click();
  await expect(first).toHaveAttribute('data-status', 'scheduled');
  await first.getByTestId('supplier-tons').fill('7.5');
  await first.getByTestId('supplier-delivered').click();
  await expect(s.getByText(/: 7\.5 tons on 2026-12-03/)).toBeVisible();

  // The contractor's salt count has the delivery, and 216LABS's fee shows on the admin page.
  await page.goto('/reports');
  await expect(page.getByText(`Delivered by ${name}`).first()).toBeVisible();
  await page.goto('/admin/salt');
  await expect(page.getByTestId('supplier-row').filter({ hasText: name })).toContainText('$22.50');

  // A bad supplier link goes nowhere; a viewer can't order.
  expect((await guest.request.get('/supplier/nonsense')).status()).toBe(404);
  expect((await guest.request.post('/api/salt/orders', { data: { tons: 5, address: '1 Main St, Lakewood, OH' } })).status()).toBe(401);
  await guest.close();
  await sql`update salt_supplier set active = false where id = ${sup!.id}`;
});

test('salt ordering where no supplier delivers records the request for 216LABS', async ({ page }) => {
  await login(page);
  await sql`update salt_supplier set active = false`;
  await page.goto('/reports');
  const card = page.getByTestId('salt-order');
  await card.getByTestId('order-tons').fill('12');
  await card.getByTestId('salt-address').fill('500 Remote Rd, Lakewood, OH');
  await card.getByTestId('salt-quote').click();
  await expect(card.getByTestId('salt-quote-result')).toContainText('No partner supplier delivers');
  await card.getByTestId('salt-request').click();
  await expect(card.getByTestId('salt-msg')).toContainText("We've noted your request");
  await page.goto('/admin/salt');
  await expect(page.getByTestId('waitlist')).toContainText('12 tons to 500 Remote Rd');
});
