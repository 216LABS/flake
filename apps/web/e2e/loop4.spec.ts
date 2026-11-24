import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { login, sql, openQuoteForm } from './helpers';

/** Issues from STAR's first done-bar pass (#88), at iPhone 13 and iPhone SE sizes. */
for (const size of [{ width: 390, height: 844 }, { width: 375, height: 667 }]) {
  test(`a quote can be made as a link only, and the customer opts in to emails themselves, ${size.width} wide`, async ({ page, browser, baseURL }, info) => {
    test.skip(info.project.name === 'pixel-7', 'The iPhone sizes cover this');
    await page.setViewportSize(size);
    await login(page);
    const email = `link-only-${randomUUID().slice(0, 6)}@example.com`;
    const c = await (await page.request.post('/api/customers', { data: { name: `Link only ${randomUUID().slice(0, 6)}`, kind: 'residential', email, phone_e164: '+12165550142', billing_mode: 'card_on_file' } })).json();
    const s = await (await page.request.post('/api/sites', { data: { customer_id: c.id, label: 'Link lot', address: '100 Test St, Lakewood, OH', lat: 41.48, lon: -81.8 } })).json();

    // Issue 92: "Get link only" makes the quote and sends nothing.
    await page.goto(`/sites/${s.id}`);
    await openQuoteForm(page);
    await page.getByTestId('q-price').fill('80');
    await page.getByTestId('q-link-only').click();
    const url = await page.getByTestId('q-url').inputValue();
    expect(url).toContain('/q/');
    await expect(page.getByText('Nothing was sent, so share it with the customer.')).toBeVisible();
    // D16: the office texts it from its own phone, to the customer's number, with the link and the company's name.
    const href = (await page.getByTestId('q-text-it').getAttribute('href'))!;
    expect(href).toMatch(/^sms:\+12165550142[&?]body=/);
    expect(decodeURIComponent(href.split('body=')[1]!)).toContain(url);
    expect(decodeURIComponent(href.split('body=')[1]!)).toContain('Lakeshore Plow Co.');
    await page.reload();
    expect(await page.getByTestId('contract-text-it').getAttribute('href')).toContain(encodeURIComponent(url));
    await expect(page.getByTestId('contract-copy')).toBeVisible();
    await page.waitForTimeout(1500);
    expect((await sql`select count(*)::int as n from message_log where to_addr = ${email}`)[0]!.n).toBe(0);
    expect((await sql`select count(*)::int as n from job where payload::text like ${`%${email}%`}`)[0]!.n).toBe(0);
    expect((await sql`select status from contract where site_id = ${s.id}`)[0]!.status).toBe('draft');

    // Issue 94: the customer's quote page asks; it doesn't tick the box for them.
    const guest = await browser.newContext({ baseURL, viewport: size });
    const g = await guest.newPage();
    await g.goto(new URL(url).pathname);
    await expect(g.getByTestId('consent-email')).not.toBeChecked();
    await guest.close();
  });
}

test('a new quote on a measured lot starts from the rate card price, and follows the pricing type until typed over', async ({ page }, info) => {
  test.skip(info.project.name === 'pixel-7', 'once is enough');
  await login(page);
  const [s] = await sql`select s.id from site s join tenant t on t.id = s.tenant_id where t.slug = 'lakeshore-demo' and s.active and coalesce(s.area_confirmed_sqft, s.area_estimate_sqft) > 0 limit 1`;
  test.skip(!s, 'no measured lot in the seed');
  await page.goto(`/sites/${s!.id}`);
  await openQuoteForm(page);
  const price = page.getByTestId('q-price');
  const perPush = await price.inputValue();
  expect(Number(perPush)).toBeGreaterThan(0);
  await expect(page.getByText('suggested from your rate card')).toBeVisible();
  await page.getByTestId('q-type').selectOption('seasonal');
  expect(Number(await price.inputValue())).toBeGreaterThan(Number(perPush));
  await price.fill('123');
  await page.getByTestId('q-type').selectOption('per_push');
  await expect(price).toHaveValue('123');
  await expect(page.getByText('suggested from your rate card')).toHaveCount(0);
});
