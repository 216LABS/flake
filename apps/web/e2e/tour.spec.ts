import { devices, expect, test, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { sql } from './helpers';

/** Screenshot tour of a real day. Only runs with TOUR_DIR set; not part of the suite. */
const DIR = process.env.TOUR_DIR;
test.skip(!DIR, 'tour only');
test.setTimeout(400_000);

let n = 0;
const shot = async (p: Page, name: string, full = false) => {
  await p.waitForLoadState('networkidle').catch(() => {});
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${DIR}/${String(++n).padStart(2, '0')}-${name}.png`, fullPage: full });
};
const photo = async (shade: number) => ({
  name: 'p.jpg', mimeType: 'image/jpeg',
  buffer: await sharp({ create: { width: 1600, height: 1200, channels: 3, background: { r: shade, g: shade + 15, b: shade + 30 } } }).withExif({ IFD0: { Make: 'Tour', Model: randomUUID().slice(0, 6) } }).jpeg().toBuffer(),
});
const phone = (b: Browser) => b.newContext({ ...devices['iPhone 13'] });

test('a real day', async ({ browser }) => {
  test.skip(test.info().project.name !== 'iphone-13', 'once');
  mkdirSync(DIR!, { recursive: true });
  const stamp = Date.now();
  const company = 'Northcoast Snow Co.';
  const office = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await office.newPage();

  // Sign up
  const email = `tour-${stamp}@flake.test`;
  await page.request.post(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/signup`, { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! }, data: { email, password: 'flake-demo-only' } });
  await page.goto('/login');
  await shot(page, 'login');
  await page.request.post('/api/dev/login', { data: { email } });
  await page.goto('/dashboard');
  await page.waitForURL('**/onboarding');
  await page.getByTestId('company').fill(company);
  await shot(page, 'onboarding');
  await page.getByTestId('create-company').click();
  await page.waitForURL('**/dashboard');
  const [t] = await sql`select id from tenant where id = (select tenant_id from membership m join auth.users u on u.id = m.user_id where u.email = ${email})`;
  const tenantId = t!.id as string;
  await shot(page, 'dashboard-empty');

  await page.goto('/settings?tab=payments');
  await page.getByTestId('stripe-connect').click();
  await page.getByTestId('mock-finish').click();
  await expect(page.getByTestId('stripe-status')).toHaveText('Charges enabled');
  await shot(page, 'settings-payments');
  await page.goto('/settings?tab=rate');
  await shot(page, 'settings-rate-card', true);

  // Drivers
  for (const [name, ph] of [['Dana Kowalski', '+12165550181'], ['Luis Ortega', '+12165550182']] as const) {
    await page.goto('/settings?tab=crew');
    await page.getByTestId('crew-name').fill(name);
    await page.getByLabel('Mobile').fill(ph);
    await page.getByTestId('crew-invite').click();
    const invite = await page.getByTestId('invite-url').inputValue();
    if (name.startsWith('Dana')) await shot(page, 'settings-crew-invite');
    const ctx = await phone(browser);
    const j = await ctx.newPage();
    await j.goto(invite);
    if (name.startsWith('Dana')) await shot(j, 'phone-driver-join');
    await j.getByTestId('crew-consent').check();
    await j.getByTestId('join').click();
    await expect(j.getByTestId('joined')).toBeVisible();
    if (name.startsWith('Dana')) await shot(j, 'phone-driver-joined');
    await ctx.close();
  }

  // Routes
  await page.goto('/routes');
  for (const [route, driver] of [['Lakewood', 'Dana Kowalski'], ['Rocky River', 'Luis Ortega']] as const) {
    await page.getByLabel('New route').fill(route);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    const card = page.getByTestId('route-card').filter({ has: page.getByLabel(`Add a site to ${route}`) });
    await card.getByLabel('Default driver').selectOption({ label: driver });
  }
  await page.waitForTimeout(500);

  // Customers
  const customers = [
    { name: 'Detroit Ave Plaza', email: 'plaza@flake.test', billing: 'card_on_file', address: '14701 Detroit Ave, Lakewood, OH', pricing: 'per_push', price: '185.00', route: 'Lakewood', card: true, signer: 'Maria Chen' },
    { name: 'Madison Family Clinic', email: 'clinic@flake.test', billing: 'card_on_file', address: '13600 Madison Ave, Lakewood, OH', pricing: 'per_inch_tier', route: 'Lakewood', card: true, signer: 'Dr. Patel' },
    { name: 'Clifton Shores Condos', email: 'condos@flake.test', billing: 'invoice_net30', address: '11800 Clifton Blvd, Lakewood, OH', pricing: 'per_event', route: 'Rocky River', card: false, signer: 'HOA Board' },
    { name: 'St. Christopher Parish', email: 'parish@flake.test', billing: 'card_on_file', address: '20141 Detroit Rd, Rocky River, OH', pricing: 'per_push', price: '95.00', route: 'Rocky River', card: true, signer: 'Fr. Novak' },
  ];
  for (const [i, c] of customers.entries()) {
    const first = i === 0;
    await page.goto('/customers/new');
    await page.getByTestId('c-name').fill(c.name);
    await page.getByLabel('Billing').selectOption(c.billing);
    await page.getByTestId('c-email').fill(c.email);
    if (first) await shot(page, 'wizard-1-customer');
    await page.getByTestId('next').click();
    await page.getByTestId('address').fill(c.address);
    await page.getByTestId('find').click();
    await expect(page.getByTestId('sqft')).toContainText('sq ft');
    if (first) await shot(page, 'wizard-2-measure');
    await page.getByTestId('next').click();
    await page.getByTestId('pricing-type').selectOption(c.pricing);
    if (c.price) await page.getByTestId('price').fill(c.price);
    if (first) await shot(page, 'wizard-3-price');
    await page.getByTestId('next').click();
    await page.getByTestId('next').click();
    const routeId = await page.getByTestId('route-select').locator('option', { hasText: `${c.route} (` }).getAttribute('value');
    await page.getByTestId('route-select').selectOption(routeId!);
    await page.getByTestId('next').click();
    await page.getByTestId('send-quote').click();
    await expect(page.getByTestId('quote-sent')).toBeVisible();
    if (first) await shot(page, 'wizard-6-sent');
    const url = await page.getByTestId('quote-url').inputValue();
    const ctx = await phone(browser);
    const q = await ctx.newPage();
    await q.goto(url);
    if (first) await shot(q, 'phone-customer-quote', true);
    await q.getByTestId('sign-name').fill(c.signer);
    await q.getByTestId('agree').check();
    await q.getByTestId('accept').click();
    await expect(q.getByTestId('accepted')).toBeVisible();
    if (c.card) {
      await q.getByTestId('add-payment').click();
      await q.getByTestId('mock-save').click();
      await expect(q.getByTestId('payment-saved')).toBeVisible();
    }
    if (first) await shot(q, 'phone-customer-accepted');
    await ctx.close();
  }
  await page.goto('/customers');
  await shot(page, 'customers');
  await page.goto('/routes');
  await page.getByTestId('route-card').first().getByTestId('suggest-open').count();
  await shot(page, 'routes');

  // The storm
  await page.goto('/dev/weather');
  await page.getByTestId('load-fixture').click();
  await expect(page.getByTestId('clock')).toHaveText('2025-12-12T12:00:00.000Z');
  await page.getByTestId('advance-6').click();
  await page.getByTestId('advance-1').click();
  await expect(page.getByTestId('clock')).toHaveText('2025-12-12T19:00:00.000Z');
  await page.getByTestId('poll').click();
  await expect(page.getByTestId('polled')).toHaveText('Polls run: 1');
  await expect.poll(async () => (await sql`select count(*)::int as n from trigger_alert where tenant_id = ${tenantId} and status = 'open'`)[0]!.n, { timeout: 30000 }).toBeGreaterThan(0);
  await page.goto('/dashboard');
  await shot(page, 'dashboard-alert');
  await page.getByTestId('alert-review').first().click();
  await shot(page, 'alert-review', true);
  await page.getByTestId('start-storm').click();
  await shot(page, 'storm-ready');
  await page.getByTestId('publish').click();
  await page.waitForURL(/\/storms\/[0-9a-f-]+$/);
  const stormId = page.url().split('/').pop()!;
  await expect(page.getByTestId('run-column')).toHaveCount(2);
  await shot(page, 'storm-board-start', true);
  const links: Record<string, string> = {};
  for (const route of ['Lakewood', 'Rocky River']) {
    const col = page.getByTestId('run-column').filter({ hasText: new RegExp(`^${route}[0-9]`) });
    await col.getByTestId('show-link').click();
    const panel = page.getByTestId('link-panel');
    await expect(panel.getByRole('img', { name: /QR code/ })).toBeVisible();
    if (route === 'Lakewood') await shot(page, 'storm-board-qr');
    links[route] = await panel.getByTestId('run-link').inputValue();
  }

  // Dana's phone, every step
  const dctx = await phone(browser);
  const d = await dctx.newPage();
  await d.goto(links.Lakewood!);
  await expect(d.getByTestId('next-stop')).toBeVisible();
  await shot(d, 'phone-driver-next-stop');
  await d.getByTestId('arrive').click();
  await expect(d.getByTestId('onsite')).toBeVisible();
  await shot(d, 'phone-driver-on-site');
  await d.getByTestId('before-photo').setInputFiles(await photo(140));
  await d.getByTestId('depth-3').click();
  if (await d.getByTestId('salt-plus').count()) { await d.getByTestId('salt-plus').click(); await d.getByTestId('salt-plus').click(); }
  await d.getByTestId('after-photo').setInputFiles(await photo(190));
  await expect(d.getByText('✓ After photo')).toBeVisible();
  await shot(d, 'phone-driver-ready-to-finish', true);
  await d.getByTestId('done').click();
  await expect(d.getByTestId('progress')).toContainText('1');
  await shot(d, 'phone-driver-second-stop');

  // Luis hits a blocked lot
  const lctx = await phone(browser);
  const l = await lctx.newPage();
  await l.goto(links['Rocky River']!);
  await l.getByTestId('arrive').click();
  await l.getByTestId('problem').click();
  await shot(l, 'phone-driver-problem');
  await l.getByTestId('problem-blocked').click();

  await page.reload();
  await shot(page, 'storm-board-midstorm', true);

  // Everyone finishes
  const finish = async (p: Page, firstDone: boolean) => {
    while (!(await p.getByTestId('all-done').count())) {
      await p.getByTestId('arrive').click();
      await expect(p.getByTestId('onsite')).toBeVisible();
      await p.getByTestId('before-photo').setInputFiles(await photo(140));
      if (!firstDone && (await p.getByTestId('depth-3').count())) await p.getByTestId('depth-3').click();
      firstDone = true;
      await p.getByTestId('after-photo').setInputFiles(await photo(190));
      await expect(p.getByText('✓ After photo')).toBeVisible();
      const before = await p.getByTestId('progress').textContent();
      await p.getByTestId('done').click();
      await expect(p.getByTestId('progress')).not.toHaveText(before!);
    }
  };
  await Promise.all([finish(d, true), finish(l, false)]);
  await shot(d, 'phone-driver-all-done');
  await dctx.close();
  await lctx.close();
  await expect.poll(async () => (await sql`select count(*)::int as n from message_log where tenant_id = ${tenantId} and template = 'done'`)[0]!.n, { timeout: 60000 }).toBe(4);

  await page.reload();
  await shot(page, 'storm-board-finished', true);
  await page.goto('/dev/inbox');
  await shot(page, 'messages-sent', true);
  await page.goto(`/storms/${stormId}`);
  if (await page.getByTestId('resolve-problem').count()) await page.getByTestId('resolve-problem').first().click();
  await page.getByTestId('close-storm').click();
  await page.waitForURL(/\/billing/);
  await page.goto(`/billing?storm=${stormId}`);
  await page.getByTestId('generate').click();
  await expect(page.getByTestId('draft').first()).toBeVisible();
  await page.getByTestId('flagged-only').uncheck();
  await shot(page, 'billing-review', true);
  const depthFlag = page.locator('[data-code="missing_depth"]');
  if (await depthFlag.count()) {
    await depthFlag.getByTestId('depth-in').fill('4');
    await depthFlag.getByTestId('fix-depth').click();
    await expect(depthFlag).toHaveCount(0);
  }
  const open = page.locator('[data-testid="flag"]').filter({ has: page.getByTestId('fix-waive') });
  for (let left = await open.count(); left > 0; left--) {
    await open.first().getByTestId('fix-waive').click();
    await expect(open).toHaveCount(left - 1);
  }
  await page.getByTestId('approve-clean').click();
  await expect.poll(async () => (await sql`select count(*)::int as n from invoice_draft where storm_id = ${stormId} and status in ('paid','sent')`)[0]!.n, { timeout: 60000 }).toBe(4);
  await page.reload();
  await shot(page, 'billing-done', true);

  // The morning after
  const [plaza] = await sql`select id from customer where tenant_id = ${tenantId} and name = 'Detroit Ave Plaza'`;
  await page.goto(`/customers/${plaza!.id}`);
  await page.getByTestId('portal-copy').click();
  await shot(page, 'customer-page', true);
  const portal = await page.getByTestId('portal-url').inputValue();
  const cctx = await phone(browser);
  const cp = await cctx.newPage();
  await cp.goto(portal);
  await expect(cp.getByTestId('portal-visit').first()).toBeVisible();
  await shot(cp, 'phone-customer-records', true);
  await cctx.close();

  await page.goto('/reports');
  await shot(page, 'reports', true);
  await page.goto('/proof');
  const clinicSite = await page.getByTestId('proof-site').locator('option', { hasText: 'Madison Family Clinic' }).getAttribute('value');
  await page.getByTestId('proof-site').selectOption(clinicSite!);
  await page.getByTestId('proof-generate').click();
  await expect(page.getByTestId('proof-ready')).toBeVisible({ timeout: 90000 });
  await shot(page, 'proof');
  await page.goto('/storms');
  await shot(page, 'storms-list');
  await page.goto('/dashboard');
  await shot(page, 'dashboard-after');
  await office.close();
});
