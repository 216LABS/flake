import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { login, sql, startStorm } from './helpers';

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
  await row.getByTestId('send-bill').click();
  await page.getByTestId('confirm-yes').click();
  await expect(row).toContainText(`Bill sent to ${tag}@example.com`);
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
  await page.goto('/reports');
  const moneyRow = page.locator('[data-testid="money-row"]', { hasText: `Checks ${tag}` });
  await expect(moneyRow.locator('[data-label="Paid"]')).toHaveText('$125.00');
  await expect(moneyRow.locator('[data-label="Owed"]')).toHaveText('$0.00');
  await guest.close();
});

/** The phone died on site: billing review lets the office enter the time and bill the lot (found in the season walk). */
test('a lot with an Arrive and no Done is finished from billing review and bills', async ({ page }) => {
  await login(page);
  const { id, runs } = await startStorm(page.request, `Dead phone ${Date.now()}`, ['West Lakewood']);
  const run = runs[0]!;
  // Only this stop: visits on the others would crowd other tests' records pages.
  const [stop] = run.stops;
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

/** The phone stayed home: nothing came from it, but the lot was plowed. The office records the visit. */
test('a lot plowed with no visit from the phone is recorded from the not-plowed card', async ({ page }) => {
  await login(page);
  const { id, runs } = await startStorm(page.request, `No phone ${Date.now()}`, ['West Lakewood']);
  const run = runs[0]!;
  // Only this stop: visits on the others would crowd other tests' records pages.
  const [stop] = run.stops;
  const [site] = await sql`select label from site where id = ${stop!.site_id}`;
  expect((await page.request.post(`/api/storms/${id}/close`, { data: { force: true } })).ok()).toBe(true);
  await page.goto(`/billing?storm=${id}`);
  await expect(page.getByTestId('unplowed')).toContainText('not plowed');
  await page.getByTestId('unplowed-show').click();
  const flag = page.locator('[data-testid="flag"][data-code="missing_visit"]', { hasText: site!.label as string });
  await flag.getByTestId('record-minutes').fill('25');
  await flag.getByTestId('fix-record').click();
  await expect(page.locator('[data-testid="flag"][data-code="missing_visit"]', { hasText: site!.label as string })).toHaveCount(0);
});

/** Without Stripe, a card or invoice customer's fees are only what Stripe would cost, not a cost of approving. */
test('with Stripe off, billing review says the fees apply only if charged through Stripe', async ({ page }) => {
  await login(page);
  const tag = randomUUID().slice(0, 6);
  const c = await (await page.request.post('/api/customers', { data: { name: `Card ${tag}`, kind: 'commercial', billing_mode: 'invoice_net30', email: `${tag}@example.com` } })).json();
  const [s] = await sql`insert into storm (tenant_id, name, started_at, closed_at, status) values (${c.tenant_id}, ${`Fees ${tag}`}, now() - interval '2 days', now() - interval '1 day', 'closed') returning id`;
  await sql`insert into invoice_draft (tenant_id, storm_id, customer_id, lines, subtotal_cents, flags, status, application_fee_cents) values (${c.tenant_id}, ${s!.id}, ${c.id}, '[]'::jsonb, 16000, '[]'::jsonb, 'draft', 160)`;
  await sql`update tenant set stripe_charges_enabled = false where id = ${c.tenant_id}`;
  try {
    await page.goto(`/billing?storm=${s!.id}`);
    await expect(page.getByTestId('stripe-not-connected')).toBeVisible();
    await expect(page.locator('[data-testid="draft"]', { hasText: `Card ${tag}` })).toContainText('charged through Stripe, the Flake fee is');
    await expect(page.getByText(/Flake fees \$[\d.]+ if charged through Stripe\./)).toBeVisible();
  } finally {
    await sql`update tenant set stripe_charges_enabled = true where id = ${c.tenant_id}`;
  }
});

/** Issue 119: a seasonal customer owes installments, not the $0.00 storm bills their lot gets. */
test('the records page lists seasonal installments owed and never calls a $0.00 bill due', async ({ page, browser, baseURL }) => {
  await login(page);
  const tag = randomUUID().slice(0, 6);
  const c = await (await page.request.post('/api/customers', { data: { name: `Season ${tag}`, kind: 'hoa', billing_mode: 'manual' } })).json();
  const [st] = await sql`insert into site (tenant_id, customer_id, label, address, lat, lon) values (${c.tenant_id}, ${c.id}, ${`Pond drive ${tag}`}, '1 Pond Rd, Lakewood, OH', 41.48, -81.8) returning id`;
  const [k] = await sql`insert into contract (tenant_id, site_id, season, status, services) values (${c.tenant_id}, ${st!.id}, '2026-27', 'accepted', ${sql.json([{ service: 'plow', pricing: { type: 'seasonal', total_cents: 90000, installments: 5 } }])}) returning id`;
  await sql`insert into installment_invoice (tenant_id, contract_id, seq, amount_cents, status, period) values (${c.tenant_id}, ${k!.id}, 1, 18000, 'manual', '2026-11')`;
  const [s] = await sql`insert into storm (tenant_id, name, started_at, closed_at, status) values (${c.tenant_id}, ${`Zero ${tag}`}, now() - interval '2 days', now() - interval '1 day', 'billed') returning id`;
  await sql`insert into invoice_draft (tenant_id, storm_id, customer_id, lines, subtotal_cents, flags, status) values (${c.tenant_id}, ${s!.id}, ${c.id}, '[]'::jsonb, 0, '[]'::jsonb, 'approved')`;
  const { url } = await (await page.request.get(`/api/customers/${c.id}/portal`)).json();
  const guest = await browser.newContext({ baseURL, viewport: { width: 375, height: 667 } });
  const g = await guest.newPage();
  await g.goto(url);
  const due = g.getByTestId('portal-due');
  await expect(due).toContainText(`Pond drive ${tag}, 2026-27 installment 1 of 5: $180.00`);
  await expect(due).not.toContainText(`Zero ${tag}`);
  await expect(g.getByTestId('portal-installment')).toContainText('November 2026');
  await expect(g.getByTestId('portal-invoice').filter({ hasText: `Zero ${tag}` })).toContainText('No charge');
  expect(await g.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await guest.close();
  await page.request.delete(`/api/customers/${c.id}`);
});

/** Issue 132: a card or bank payment under way is neither paid nor owed, and the totals still add up. */
test('Reports Money shows a payment in progress, so billed equals paid plus owed plus in progress', async ({ page }) => {
  await login(page);
  const tag = randomUUID().slice(0, 6);
  const c = await (await page.request.post('/api/customers', { data: { name: `Flight ${tag}`, kind: 'commercial', billing_mode: 'card_on_file' } })).json();
  const c2 = await (await page.request.post('/api/customers', { data: { name: `Flight2 ${tag}`, kind: 'commercial', billing_mode: 'manual' } })).json();
  const [s] = await sql`insert into storm (tenant_id, name, started_at, closed_at, status) values (${c.tenant_id}, ${`Flight ${tag}`}, now() - interval '1 day', now() - interval '20 hours', 'billed') returning id`;
  await sql`insert into invoice_draft (tenant_id, storm_id, customer_id, lines, subtotal_cents, flags, status) values (${c.tenant_id}, ${s!.id}, ${c.id}, '[]'::jsonb, 5000, '[]'::jsonb, 'charged'), (${c.tenant_id}, ${s!.id}, ${c2.id}, '[]'::jsonb, 2500, '[]'::jsonb, 'approved')`;
  const day = (d: number) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
  await page.goto(`/reports?from=${day(-3)}&to=${day(1)}`);
  const row = page.locator('[data-testid="money-row"]', { hasText: `Flight ${tag}` });
  await expect(row.locator('[data-label="Billed"]')).toHaveText('$75.00');
  await expect(row.locator('[data-label="Owed"]')).toHaveText('$25.00');
  await expect(row.locator('[data-label="In progress"]')).toHaveText('$50.00');
  await expect(page.getByTestId('money-report')).toContainText('Payment in progress');
  await sql`update invoice_draft set status = 'void' where storm_id = ${s!.id}`;
});
