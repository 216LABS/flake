import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { login, sql } from './helpers';

/** A customer signs knowing how they'll pay, and a quote page doesn't pull in Stripe until a card form opens. */
test('the quote says how the customer pays, and viewing or declining it loads nothing from Stripe', async ({ page, browser, baseURL }) => {
  await login(page);
  const cases = [
    ['invoice_net30', 'Invoiced after each storm, due within 30 days.'],
    ['card_on_file', 'Charged to a card on file after each storm. You add the card after accepting.'],
  ] as const;
  for (const [mode, text] of cases) {
    const tag = randomUUID().slice(0, 6);
    const c = await (await page.request.post('/api/customers', { data: { name: `Terms ${tag}`, kind: 'hoa', billing_mode: mode, email: `${tag}@example.com` } })).json();
    const s = await (await page.request.post('/api/sites', { data: { customer_id: c.id, label: `Drive ${tag}`, address: '1 Terms St, Lakewood, OH', lat: 41.48, lon: -81.8 } })).json();
    const q = await (await page.request.post('/api/quotes', { data: { site_id: s.id, season: '2026-27', services: [{ service: 'plow', trigger_in: 2, pricing: { type: 'per_event', amount_cents: 40000 } }], send: false } })).json();
    const guest = await browser.newContext({ baseURL });
    const stripe: string[] = [];
    guest.on('request', (r) => { if (/stripe\.(com|network)/.test(r.url())) stripe.push(r.url()); });
    const g = await guest.newPage();
    await g.goto(q.url);
    await expect(g.getByTestId('payment-line')).toHaveText(`Payment: ${text}`);
    if (mode === 'invoice_net30') {
      await g.getByTestId('decline').click();
      await g.getByTestId('decline-send').click();
      await expect(g.getByTestId('declined')).toBeVisible();
    }
    await g.waitForLoadState('networkidle');
    expect(stripe, 'Stripe loaded on a quote with no card form open').toEqual([]);
    await guest.close();
  }
});

/** An older quote link, after the office sent a new one, says so instead of offering the old price (issue 113). */
test('a replaced quote link tells the customer a newer quote was sent, and cannot be signed', async ({ page, browser, baseURL }) => {
  await login(page);
  const tag = randomUUID().slice(0, 6);
  const c = await (await page.request.post('/api/customers', { data: { name: `Requote ${tag}`, kind: 'commercial', billing_mode: 'invoice_net30', email: `${tag}@example.com` } })).json();
  const s = await (await page.request.post('/api/sites', { data: { customer_id: c.id, label: `Lot ${tag}`, address: '2 Requote St, Lakewood, OH', lat: 41.48, lon: -81.8 } })).json();
  const quote = async (cents: number) => (await page.request.post('/api/quotes', { data: { site_id: s.id, season: '2026-27', services: [{ service: 'plow', trigger_in: 2, pricing: { type: 'per_push', amount_cents: cents } }], send: false } })).json();
  const old = await quote(6500);
  const current = await quote(9000);
  const guest = await browser.newContext({ baseURL, viewport: { width: 375, height: 667 } });
  const g = await guest.newPage();
  await g.goto(old.url);
  await expect(g.getByTestId('quote-replaced')).toContainText(`sent you a newer quote for Lot ${tag}`);
  await expect(g.getByTestId('accept')).toHaveCount(0);
  const token = new URL(old.url).pathname.split('/').pop();
  expect((await g.request.post(`/api/q/${token}/accept`, { data: { name: 'Pat Example', agree: true, consentSms: false, consentEmail: true, phone_e164: null } })).status()).toBe(410);
  await g.goto(current.url);
  await expect(g.getByText('$90.00').first()).toBeVisible();
  await guest.close();
});

/** Before a company turns on online payments, a card customer isn't promised a card form that never shows up. */
test('with payments not set up yet, a card quote says a secure link comes later, and shows no card form after accepting', async ({ page, browser, baseURL }) => {
  await login(page);
  const tag = randomUUID().slice(0, 6);
  const c = await (await page.request.post('/api/customers', { data: { name: `NoStripe ${tag}`, kind: 'residential', billing_mode: 'card_on_file', email: `${tag}@example.com` } })).json();
  const s = await (await page.request.post('/api/sites', { data: { customer_id: c.id, label: `Drive ${tag}`, address: '3 Card St, Lakewood, OH', lat: 41.48, lon: -81.8 } })).json();
  const q = await (await page.request.post('/api/quotes', { data: { site_id: s.id, season: '2026-27', services: [{ service: 'plow', trigger_in: 2, pricing: { type: 'per_push', amount_cents: 4500 } }], send: false } })).json();
  await sql`update tenant set stripe_charges_enabled = false where slug = 'lakeshore-demo'`;
  try {
    const guest = await browser.newContext({ baseURL, viewport: { width: 375, height: 667 } });
    const g = await guest.newPage();
    await g.goto(q.url);
    await expect(g.getByTestId('payment-line')).toHaveText('Payment: Charged to a card on file after each storm. Lakeshore Plow Co. (Demo) will send you a secure link to add your card.');
    await g.getByTestId('sign-name').fill('Pat Example');
    await g.getByTestId('agree').check();
    await g.getByTestId('accept').click();
    await expect(g.getByTestId('accepted')).toBeVisible();
    await expect(g.getByText('Card or bank account on file')).toHaveCount(0);
    await guest.close();
  } finally {
    await sql`update tenant set stripe_charges_enabled = true where slug = 'lakeshore-demo'`;
  }
});

/** An HOA with two drives signs once (issue 101): the second lot's quote joins the first one's link. */
test('a customer with two lots sees both on one quote and accepts both with one signature', async ({ page, browser, baseURL }) => {
  await login(page);
  const tag = randomUUID().slice(0, 6);
  const c = await (await page.request.post('/api/customers', { data: { name: `HOA ${tag}`, kind: 'hoa', billing_mode: 'invoice_net30', email: `${tag}@example.com` } })).json();
  const lot = async (label: string) => (await page.request.post('/api/sites', { data: { customer_id: c.id, label: `${label} ${tag}`, address: '4 Board St, Lakewood, OH', lat: 41.48, lon: -81.8 } })).json();
  const [south, north] = [await lot('South drive'), await lot('North drive')];
  const quote = async (siteId: string, cents: number) => (await page.request.post('/api/quotes', { data: { site_id: siteId, season: '2027-28', services: [{ service: 'plow', trigger_in: 2, pricing: { type: 'per_push', amount_cents: cents } }], send: false } })).json();
  const first = await quote(south.id, 7000);
  const second = await quote(north.id, 5500);
  expect(second.url).toBe(first.url);
  expect(second.lots).toBe(2);
  await page.goto('/customers?waiting=1');
  await expect(page.locator('[data-testid="customer-row"]', { hasText: `HOA ${tag}` }).getByTestId('quote-waiting')).toBeVisible();
  const guest = await browser.newContext({ baseURL, viewport: { width: 375, height: 667 } });
  const g = await guest.newPage();
  await g.goto(first.url);
  await expect(g.getByRole('heading', { level: 1 })).toHaveText('Snow service for 2 properties');
  await expect(g.getByTestId('quote-lot')).toHaveCount(2);
  await expect(g.getByText('$70.00').first()).toBeVisible();
  await expect(g.getByText('$55.00').first()).toBeVisible();
  await g.getByTestId('sign-name').fill('Pat Board');
  await g.getByTestId('agree').check();
  await expect(g.getByTestId('accept')).toHaveText('Accept all 2');
  await g.getByTestId('accept').click();
  await expect(g.getByTestId('accepted')).toBeVisible();
  await g.reload();
  await expect(g.getByTestId('accepted')).toContainText('Pat Board');
  await guest.close();
  await page.reload();
  await expect(page.getByText(`HOA ${tag}`)).toHaveCount(0);
});
