import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { login } from './helpers';

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
