import { expect, test } from '@playwright/test';
import { login, sql } from './helpers';

test('new customer in steps 1 to 6, then the customer accepts and saves a card', async ({ page, browser }) => {
  const started = Date.now();
  await login(page);
  const name = `E2E Retail ${Date.now()}`;
  await page.goto('/customers');
  await page.getByTestId('new-customer').click();

  // 1. Customer
  await page.getByTestId('c-name').fill(name);
  await page.getByTestId('c-email').fill('e2e-customer@flake.test');
  await page.getByTestId('next').click();
  // 2. Address and estimate
  await page.getByTestId('address').fill('14701 Detroit Ave, Lakewood, OH');
  await page.getByTestId('find').click();
  await expect(page.getByTestId('estimate-label')).toContainText('Estimate');
  await expect(page.getByTestId('sqft')).toContainText('sq ft');
  await page.getByTestId('next').click();
  // 3. Pricing, suggested from the rate card and editable
  await expect(page.getByTestId('price')).not.toHaveValue('');
  await page.getByTestId('price').fill('150.00');
  await page.getByTestId('next').click();
  // 4. Pins
  await page.getByTestId('add-pin').click();
  await page.getByTestId('next').click();
  // 5. Route
  await page.getByTestId('route-select').selectOption({ index: 1 });
  await page.getByTestId('next').click();
  // 6. Send
  await page.getByTestId('send-quote').click();
  await expect(page.getByTestId('quote-sent')).toBeVisible();
  const url = await page.getByTestId('quote-url').inputValue();
  expect(Date.now() - started).toBeLessThan(180000);

  const fresh = await browser.newContext();
  const q = await fresh.newPage();
  await q.goto(url);
  await expect(q.getByTestId('scope-line').first()).toContainText('$150.00 per push');
  await expect(q.getByTestId('consent-sms')).not.toBeChecked();
  await q.getByTestId('sign-name').fill('Pat Example');
  await q.getByTestId('agree').check();
  await q.getByTestId('accept').click();
  await expect(q.getByTestId('accepted')).toBeVisible();
  await q.getByTestId('add-payment').click();
  await q.getByTestId('mock-save').click();
  await expect(q.getByTestId('payment-saved')).toBeVisible();
  await fresh.close();

  const [row] = await sql`select k.status, k.accepted_name, k.accepted_at, k.pdf_path, c.stripe_payment_method_id as pm from contract k join site s on s.id = k.site_id join customer c on c.id = s.customer_id where c.name = ${name}`;
  expect(row).toMatchObject({ status: 'accepted', accepted_name: 'Pat Example', pm: 'pm_mock_4242' });
  expect(row!.accepted_at).toBeTruthy();
  expect(row!.pdf_path).toBeTruthy();
  const pins = await sql`select count(*)::int as n from site_pin p join site s on s.id = p.site_id join customer c on c.id = s.customer_id where c.name = ${name}`;
  expect(pins[0]!.n).toBe(1);
});
