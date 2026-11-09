import { devices, expect, test, type Browser, type Page } from '@playwright/test';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { login, sql } from './helpers';

/**
 * A brand new plow company runs a storm the way a real one would, through the screens only: sign up, connect
 * payments, invite two drivers, build routes, sign up customers who accept quotes, get a weather alert, start
 * the storm, drivers work their phones, the office handles a problem, closes, bills, and the customer sees
 * their records. Each step checks what the people involved would see.
 */
test.setTimeout(300_000);

const photo = async () => ({
  name: 'p.jpg', mimeType: 'image/jpeg',
  buffer: await sharp({ create: { width: 1600, height: 1200, channels: 3, background: { r: 150, g: 170, b: 190 } } }).withExif({ IFD0: { Make: 'Season', Model: randomUUID().slice(0, 6) } }).jpeg().toBuffer(),
});

async function inviteDriver(page: Page, browser: Browser, name: string, phone: string) {
  await page.goto('/settings?tab=crew');
  await page.getByTestId('crew-name').fill(name);
  await page.getByLabel('Mobile').fill(phone);
  await expect(page.getByTestId('crew-email-hint')).toBeVisible();
  await page.getByTestId('crew-invite').click();
  const invite = await page.getByTestId('invite-url').inputValue();
  const ctx = await browser.newContext();
  const join = await ctx.newPage();
  await join.goto(invite);
  // Texting isn't approved for a new company, so Join waits for an email.
  await expect(join.getByTestId('join')).toBeDisabled();
  await join.getByTestId('join-email').fill(`${name.split(' ')[0]!.toLowerCase()}-${phone.slice(-4)}@flake.test`);
  await join.getByTestId('crew-consent').check();
  await join.getByTestId('join').click();
  await expect(join.getByTestId('joined')).toBeVisible();
  await ctx.close();
}

interface NewCustomer { name: string; email: string; billing: string; address: string; pricing: string; price?: string; route: string }

async function addCustomer(page: Page, c: NewCustomer) {
  await page.goto('/customers/new');
  await page.getByTestId('c-name').fill(c.name);
  await page.getByLabel('Billing').selectOption(c.billing);
  await page.getByTestId('c-email').fill(c.email);
  await page.getByTestId('next').click();
  await page.getByTestId('address').fill(c.address);
  await page.getByTestId('find').click();
  await expect(page.getByTestId('sqft')).toContainText('sq ft');
  await page.getByTestId('next').click();
  await page.getByTestId('pricing-type').selectOption(c.pricing);
  if (c.price) await page.getByTestId('price').fill(c.price);
  await page.getByTestId('next').click();
  await page.getByTestId('next').click(); // no pins
  const routeId = await page.getByTestId('route-select').locator('option', { hasText: `${c.route} (` }).getAttribute('value');
  await page.getByTestId('route-select').selectOption(routeId!);
  await page.getByTestId('next').click();
  await page.getByTestId('send-quote').click();
  await expect(page.getByTestId('quote-sent')).toBeVisible();
  return page.getByTestId('quote-url').inputValue();
}

async function acceptQuote(browser: Browser, url: string, signer: string, card: boolean) {
  const ctx = await browser.newContext();
  const q = await ctx.newPage();
  await q.goto(url);
  await q.getByTestId('sign-name').fill(signer);
  await q.getByTestId('agree').check();
  await q.getByTestId('accept').click();
  await expect(q.getByTestId('accepted')).toBeVisible();
  if (card) {
    await q.getByTestId('add-payment').click();
    await q.getByTestId('mock-save').click();
    await expect(q.getByTestId('payment-saved')).toBeVisible();
  }
  await ctx.close();
}

test('a new plow company runs a whole storm from sign up to paid invoices', async ({ page, browser }) => {
  test.skip(test.info().project.name !== 'iphone-13', 'one full run is enough');
  const stamp = Date.now();
  const company = `Season Plow ${stamp}`;

  // 1. Sign up and set up the company.
  const email = `owner-${stamp}@flake.test`;
  const signup = await page.request.post(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/signup`, { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! }, data: { email, password: 'flake-demo-only' } });
  expect(signup.ok()).toBe(true);
  await page.request.post('/api/dev/login', { data: { email } });
  await page.goto('/dashboard');
  await page.waitForURL('**/onboarding');
  await page.getByTestId('company').fill(company);
  await page.getByTestId('create-company').click();
  await page.waitForURL('**/dashboard');
  const [t] = await sql`select id from tenant where name = ${company}`;
  const tenantId = t!.id as string;

  await page.goto('/settings?tab=payments');
  await page.getByTestId('stripe-connect').click();
  await page.getByTestId('mock-finish').click();
  await expect(page.getByTestId('stripe-status')).toHaveText('Charges enabled');

  // 2. Two drivers join from their invite links.
  await inviteDriver(page, browser, 'Dana North', `+1216555${String(stamp).slice(-4)}`);
  await inviteDriver(page, browser, 'Sam South', `+1440555${String(stamp).slice(-4)}`);

  // 3. Two routes, each with a default driver.
  await page.goto('/routes');
  for (const [route, driver] of [['North', 'Dana North'], ['South', 'Sam South']] as const) {
    await page.getByLabel('New route').fill(route);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    const card = page.getByTestId('route-card').filter({ has: page.getByLabel(`Add a site to ${route}`) });
    await expect(card).toBeVisible();
    await card.getByLabel('Default driver').selectOption({ label: driver });
  }
  await expect.poll(async () => (await sql`select count(*)::int as n from route where tenant_id = ${tenantId} and default_crew_id is not null`)[0]!.n).toBe(2);

  // 4. Four customers, quoted from the wizard, accept on their own phones.
  const customers: (NewCustomer & { card: boolean })[] = [
    { name: `Plaza ${stamp}`, email: `plaza-${stamp}@flake.test`, billing: 'card_on_file', address: `${stamp % 9000} Detroit Ave, Lakewood, OH`, pricing: 'per_push', price: '185.00', route: 'North', card: true },
    { name: `Clinic ${stamp}`, email: `clinic-${stamp}@flake.test`, billing: 'card_on_file', address: `${(stamp + 7) % 9000} Madison Ave, Lakewood, OH`, pricing: 'per_inch_tier', route: 'North', card: true },
    { name: `Condos ${stamp}`, email: `condos-${stamp}@flake.test`, billing: 'invoice_net30', address: `${(stamp + 13) % 9000} Clifton Blvd, Lakewood, OH`, pricing: 'per_event', route: 'South', card: false },
    { name: `Church ${stamp}`, email: `church-${stamp}@flake.test`, billing: 'card_on_file', address: `${(stamp + 21) % 9000} Hilliard Blvd, Rocky River, OH`, pricing: 'per_push', price: '95.00', route: 'South', card: true },
  ];
  for (const c of customers) {
    const url = await addCustomer(page, c);
    await acceptQuote(browser, url, `Signer for ${c.name}`, c.card);
  }
  const contracts = await sql`select k.status, c.name, c.stripe_payment_method_id as pm from contract k join site s on s.id = k.site_id join customer c on c.id = s.customer_id where c.tenant_id = ${tenantId}`;
  expect(contracts).toHaveLength(4);
  expect(contracts.every((k) => k.status === 'accepted')).toBe(true);
  expect(contracts.filter((k) => k.pm).length).toBe(3);
  const stops = await sql`select r.name, count(*)::int as n from route_stop rs join route r on r.id = rs.route_id where r.tenant_id = ${tenantId} group by r.name order by r.name`;
  expect(stops.map((r) => `${r.name}:${r.n}`)).toEqual(['North:2', 'South:2']);
  // 5. Overnight the forecast crosses the trigger and the owner gets an alert.
  await page.goto('/dev/weather');
  await page.getByTestId('load-fixture').click();
  await expect(page.getByTestId('clock')).toHaveText('2025-12-12T12:00:00.000Z');
  await page.getByTestId('advance-6').click();
  await page.getByTestId('advance-1').click();
  await expect(page.getByTestId('clock')).toHaveText('2025-12-12T19:00:00.000Z');
  await page.getByTestId('poll').click();
  await expect(page.getByTestId('polled')).toHaveText('Polls run: 1');
  await expect.poll(async () => (await sql`select count(*)::int as n from trigger_alert where tenant_id = ${tenantId} and status = 'open'`)[0]!.n, { timeout: 30000 }).toBeGreaterThan(0);
  await expect.poll(async () => (await sql`select count(*)::int as n from message_log where tenant_id = ${tenantId} and template = 'owner_alert'`)[0]!.n, { timeout: 30000 }).toBeGreaterThan(0);

  // 6. Two taps: review the alert, start the storm. Both drivers get their links.
  await page.goto('/dashboard');
  await page.getByTestId('alert-review').first().click();
  await page.getByTestId('start-storm').click();
  await page.getByTestId('publish').click();
  await page.waitForURL(/\/storms\/[0-9a-f-]+$/);
  const stormId = page.url().split('/').pop()!;
  await expect(page.getByTestId('run-column')).toHaveCount(2);
  // Texting isn't approved yet, but the drivers gave an email when they joined, so their links go by email.
  await expect(page.getByTestId('no-reach')).toHaveCount(0);
  await expect.poll(async () => (await sql`select count(*)::int as n from message_log where tenant_id = ${tenantId} and template = 'crew_link' and channel = 'email'`)[0]!.n, { timeout: 30000 }).toBe(2);
  const links: Record<string, string> = {};
  for (const route of ['North', 'South']) {
    const col = page.getByTestId('run-column').filter({ hasText: new RegExp(`^${route}[0-9]`) });
    await col.getByTestId('show-link').click();
    const panel = page.getByTestId('link-panel');
    await expect(panel).toContainText(route);
    await expect(panel.getByRole('img', { name: /QR code/ })).toBeVisible();
    links[route] = await panel.getByTestId('run-link').inputValue();
  }

  // 7. Drivers work their routes on their phones. South's first lot is blocked by a parked car; it reports and carries on.
  const work = async (route: string, problemFirst: boolean) => {
    const ctx = await browser.newContext({ ...devices['iPhone 13'] });
    const d = await ctx.newPage();
    await d.goto(links[route]!);
    await expect(d.getByTestId('next-stop')).toBeVisible();
    for (let i = 0; i < 2; i++) {
      await d.getByTestId('arrive').click();
      await expect(d.getByTestId('onsite')).toBeVisible();
      if (problemFirst && i === 0) {
        await d.getByTestId('problem').click();
        await d.getByTestId('problem-blocked').click();
        // The car gets moved; the driver comes back to the same lot and starts again.
        await d.getByTestId('arrive').click();
        await expect(d.getByTestId('onsite')).toBeVisible();
      }
      await d.getByTestId('before-photo').setInputFiles(await photo());
      await expect(d.getByText('✓ Before photo')).toBeVisible();
      if (i === 0) await d.getByTestId('depth-3').click();
      if (await d.getByTestId('salt-plus').count()) await d.getByTestId('salt-plus').click();
      await d.getByTestId('after-photo').setInputFiles(await photo());
      await expect(d.getByText('✓ After photo')).toBeVisible();
      const before = await d.getByTestId('progress').textContent();
      await d.getByTestId('done').click();
      await expect(d.getByTestId('progress')).not.toHaveText(before!);
    }
    await expect(d.getByTestId('all-done')).toBeVisible();
    // A driver who closes the page before it syncs leaves the last stop on the phone; the screen says so.
    await expect(d.getByTestId('sync-badge')).toHaveAttribute('data-state', 'synced', { timeout: 60000 });
    await expect(d.getByTestId('keep-open')).toHaveCount(0);
    await ctx.close();
  };
  await Promise.all([work('North', false), work('South', true)]);
  await expect.poll(async () => (await sql`select count(*)::int as n from visit where storm_id = ${stormId} and departed_device_at is not null`)[0]!.n, { timeout: 60000 }).toBe(4);
  await expect.poll(async () => (await sql`select count(*)::int as n from visit_photo p join visit v on v.id = p.visit_id where v.storm_id = ${stormId}`)[0]!.n, { timeout: 60000 }).toBe(8);

  // 8. The office sees the problem and resolves it; every customer hears their lot is done.
  await page.reload();
  await expect(page.getByTestId('resolve-problem').first()).toBeVisible();
  await page.getByTestId('resolve-problem').first().click();
  await expect(page.getByTestId('resolve-problem')).toHaveCount(0);
  await expect.poll(async () => (await sql`select count(*)::int as n from message_log m where m.tenant_id = ${tenantId} and m.template = 'done'`)[0]!.n, { timeout: 60000 }).toBe(4);

  // 9. Close the storm and bill it.
  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('close-storm').click();
  // Closing takes the office straight to billing for this storm.
  await page.waitForURL(/\/billing/);
  expect((await sql`select status from storm where id = ${stormId}`)[0]!.status).not.toBe('active');
  await page.goto(`/billing?storm=${stormId}`);
  await page.getByTestId('generate').click();
  await expect(page.getByTestId('draft').first()).toBeVisible();
  await page.getByTestId('flagged-only').uncheck();
  await expect(page.getByTestId('draft')).toHaveCount(4);
  // No depth reached the clinic's lot (the driver only enters it at the first stop and the demo snowfall data
  // doesn't cover it). It can't be waived to $0; the office enters the depth instead.
  const depthFlag = page.locator('[data-code="missing_depth"]');
  await expect(depthFlag).toHaveCount(1);
  await expect(depthFlag.getByTestId('fix-waive')).toHaveCount(0);
  await depthFlag.getByTestId('depth-in').fill('5');
  await depthFlag.getByTestId('fix-depth').click();
  await expect(page.locator('[data-code="missing_depth"]')).toHaveCount(0);
  // Phones in a test browser have no GPS, so location flags are expected; waive those.
  const open = page.locator('[data-testid="flag"]').filter({ has: page.getByTestId('fix-waive') });
  for (let left = await open.count(); left > 0; left--) {
    await open.first().getByTestId('fix-waive').click();
    await expect(open).toHaveCount(left - 1);
  }
  await expect(page.getByText(/0 flagged, 4 clean/)).toBeVisible();
  await page.getByTestId('approve-clean').click();
  await expect.poll(async () => (await sql`select count(*)::int as n from invoice_draft where storm_id = ${stormId} and status in ('paid','sent')`)[0]!.n, { timeout: 60000 }).toBe(4);
  const bills = await sql`select c.name, d.status, d.subtotal_cents as total, d.pay_link from invoice_draft d join customer c on c.id = d.customer_id where d.storm_id = ${stormId}`;
  const bill = (n: string) => bills.find((b) => (b.name as string).startsWith(n))!;
  expect(bill('Plaza')).toMatchObject({ status: 'paid', total: 18500 });
  expect(bill('Church')).toMatchObject({ status: 'paid', total: 9500 });
  expect(bill('Condos').status).toBe('sent');
  expect(bill('Condos').pay_link).toBeTruthy();
  expect(bill('Clinic').status).toBe('paid');
  expect(bill('Clinic').total).toBeGreaterThan(0);
  const csv = await page.request.get(`/api/billing/export.csv?storm=${stormId}`);
  expect(await csv.text()).toContain(`Plaza ${stamp}`);

  // 10. The customer opens their records: the visit, both photos and the bill.
  const [plaza] = await sql`select id from customer where name = ${`Plaza ${stamp}`}`;
  await page.goto(`/customers/${plaza!.id}`);
  await page.getByTestId('portal-copy').click();
  const portal = await page.getByTestId('portal-url').inputValue();
  const cctx = await browser.newContext();
  const cp = await cctx.newPage();
  await cp.goto(portal);
  const visitCard = cp.getByTestId('portal-visit').first();
  await expect(visitCard).toContainText('3" of snow');
  await expect(visitCard.getByRole('img')).toHaveCount(2);
  await expect(cp.getByText('$185.00').first()).toBeVisible();
  await cctx.close();

  // 11. Payroll hours for both drivers, and a proof packet for the clinic.
  await page.goto('/reports');
  await expect(page.getByText('Dana North').first()).toBeVisible();
  await expect(page.getByText('Sam South').first()).toBeVisible();
  const hours = await (await page.request.get('/api/reports/hours.csv')).text();
  expect(hours).toContain('Dana North');
  await page.goto('/proof');
  const clinicSite = await page.getByTestId('proof-site').locator('option', { hasText: `Clinic ${stamp}` }).getAttribute('value');
  await page.getByTestId('proof-site').selectOption(clinicSite!);
  await page.getByTestId('proof-generate').click();
  await expect(page.getByTestId('proof-ready')).toBeVisible({ timeout: 90000 });

  // Nothing this company did shows up for the demo company.
  await login(page);
  await page.goto('/customers');
  await expect(page.getByText(`Plaza ${stamp}`)).toHaveCount(0);
});
