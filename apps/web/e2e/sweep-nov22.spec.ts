import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { sql } from './helpers';

/**
 * Issues 212-225, from the Nov 22 sweep: a brand-new company that brings its customers over by CSV import, with no
 * payments connected and Flake's sending off, the way a beta company starts.
 */
test('a new company imports its list, quotes it in one go, routes it in one tap, and a declined lot stays home', async ({ page, browser, baseURL }, info) => {
  test.skip(info.project.name !== 'iphone-13', 'once is enough');
  test.setTimeout(240_000);
  const tag = randomUUID().slice(0, 6);
  const email = `sweep-${tag}@flake.test`;
  await page.request.post(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/signup`, { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! }, data: { email, password: 'flake-demo-only' } });
  await page.request.post('/api/dev/login', { data: { email } });
  await page.goto('/dashboard');
  await page.waitForURL('**/onboarding');
  await page.getByTestId('company').fill(`Sweep ${tag}`);
  await page.getByTestId('agree-terms').check();
  await page.getByTestId('create-company').click();
  await page.waitForURL('**/dashboard');
  const [t] = await sql`select t.id from tenant t join membership m on m.tenant_id = t.id join auth.users u on u.id = m.user_id where u.email = ${email}`;
  const tenantId = t!.id as string;

  // Issue 216: without Stripe, setup asks how customers should pay.
  await expect(page.getByTestId('setup-step').filter({ hasText: 'how to pay you' })).toHaveAttribute('data-done', 'no');

  // Issue 217: import, then quote every new lot in one go, one link per customer to copy or text.
  await page.goto('/customers/import');
  await page.getByTestId('csv-text').fill(`name,address,label,kind,billing,phone\nHarbor ${tag},14701 Detroit Ave Lakewood OH,North lot,HOA,invoice,216-555-0181\nHarbor ${tag},14801 Detroit Ave Lakewood OH,South lot,HOA,invoice,216-555-0181\nAna ${tag},1400 Clarence Ave Lakewood OH,Driveway,residential,manual,216-555-0183\nPine ${tag},20100 Detroit Rd Rocky River OH,North lot,commercial,invoice,216-555-0184`);
  await page.getByTestId('csv-import').click();
  await expect(page.getByTestId('import-results')).toContainText('4 lots added');
  await page.getByTestId('import-quote-all').click();
  await expect(page.getByTestId('import-quote-all-done')).toContainText('4 quotes made');
  const rows = page.getByTestId('import-quote-all-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.filter({ hasText: `Harbor ${tag}` })).toContainText('(2 lots)');
  expect(await rows.filter({ hasText: `Harbor ${tag}` }).getByTestId('import-quote-all-text').getAttribute('href')).toMatch(/^sms:\+12165550181[&?]body=.*%2Fq%2F/);
  // Nothing is left unquoted, so Customers doesn't offer it again.
  await page.goto('/customers');
  await expect(page.getByTestId('unquoted-lots')).toHaveCount(0);

  // Ana declines; Harbor signs.
  const quotes = await sql`select distinct on (c.name) c.name, k.id from contract k join site s on s.id = k.site_id join customer c on c.id = s.customer_id where c.tenant_id = ${tenantId} order by c.name`;
  expect(quotes).toHaveLength(3);
  const linkFor = async (name: string) => (await sql`select k.id from contract k join site s on s.id = k.site_id join customer c on c.id = s.customer_id where c.name = ${name} limit 1`)[0]!.id as string;
  for (const [name, decline] of [[`Ana ${tag}`, true], [`Harbor ${tag}`, false]] as const) {
    const { url } = await (await page.request.post(`/api/contracts/${await linkFor(name)}/resend`)).json();
    const ctx = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
    const q = await ctx.newPage();
    await q.goto(url);
    if (decline) {
      await q.getByTestId('decline').click();
      await q.getByTestId('decline-reason').fill('Doing it myself');
      await q.getByTestId('decline-send').click();
      await expect(q.getByTestId('declined')).toBeVisible();
    } else {
      await q.getByTestId('sign-name').fill('Board Chair');
      await q.getByTestId('agree').check();
      await q.getByTestId('accept').click();
      await expect(q.getByTestId('accepted')).toBeVisible();
    }
    await ctx.close();
  }

  // Issue 212: an imported company has no route; one tap makes Route 1 with the lots that should go on it.
  await page.goto('/routes');
  const card = page.getByTestId('unrouted-lots');
  await expect(card).toContainText('3 lots aren\'t on a route yet');
  await expect(card).not.toContainText('Driveway');
  await card.getByTestId('unrouted-new-route').click();
  await expect(page.getByTestId('route-card')).toHaveCount(1);
  await expect(page.getByTestId('route-card').getByTestId('route-stop')).toHaveCount(3);
  // Issue 225: two lots called "North lot" say whose they are; a label no one else uses doesn't.
  await expect(page.getByTestId('route-stop-customer')).toHaveCount(2);
  expect((await page.getByTestId('route-stop-customer').allInnerTexts()).sort()).toEqual([`Harbor ${tag}`, `Pine ${tag}`]);
  await expect(page.getByTestId('unrouted-lots')).toHaveCount(0);

  // Issue 218: put the declined lot on the route by hand; it's flagged, and a storm leaves it out and says so.
  const [r] = await sql`select id from route where tenant_id = ${tenantId}`;
  const [ana] = await sql`select s.id from site s join customer c on c.id = s.customer_id where c.name = ${`Ana ${tag}`}`;
  expect((await page.request.post(`/api/routes/${r!.id}/stops`, { data: { site_id: ana!.id } })).ok()).toBe(true);
  await page.reload();
  await expect(page.getByTestId('route-declined')).toContainText('Quote declined');
  await page.goto('/storms');
  await expect(page.getByTestId('declined-note')).toContainText('Driveway');
  await page.getByTestId('create-storm').click();
  await page.waitForURL(/\/storms\/[0-9a-f-]{36}/);
  const stormId = page.url().split('/storms/')[1]!.split(/[?#]/)[0]!;
  const onStorm = await sql`select s.label from run_stop rs join storm_run sr on sr.id = rs.storm_run_id join site s on s.id = rs.site_id where sr.storm_id = ${stormId}`;
  expect(onStorm.map((x) => x.label).sort()).toEqual(['North lot', 'North lot', 'South lot']);

  // Issue 219: the send dialog doesn't promise email to drivers.
  if (await page.getByTestId('publish').count()) {
    await page.getByTestId('publish').click();
    await expect(page.getByTestId('send-routes-list')).not.toContainText('email');
    await page.getByTestId('confirm-no').click();
  }

  // Issue 213: an approved bill with no Stripe and sending off has no dead Charge now and no Send bill.
  await sql`update storm set status = 'closed', closed_at = now() where id = ${stormId}`;
  const [harbor] = await sql`select id from customer where name = ${`Harbor ${tag}`}`;
  await sql`insert into invoice_draft (tenant_id, storm_id, customer_id, lines, subtotal_cents, flags, status, status_detail) values (${tenantId}, ${stormId}, ${harbor!.id}, '[]'::jsonb, 17000, '[]'::jsonb, 'approved', 'Payments are not connected: send the customer their link, then Mark paid when it is paid.')`;
  await page.goto(`/billing?storm=${stormId}`);
  const bill = page.locator('[data-testid="draft"]', { hasText: `Harbor ${tag}` });
  await expect(bill.getByTestId('mark-paid')).toBeVisible();
  await expect(bill.getByTestId('retry')).toHaveCount(0);
  await expect(bill.getByTestId('send-bill')).toHaveCount(0);
  await expect(bill.getByTestId('status-detail')).toHaveCount(0);
  await expect(page.getByTestId('stripe-not-connected')).not.toContainText('Charge now');

  // Issues 222 and 223: a part payment reads "Nov 21" style, and the statement doesn't repeat the method.
  await page.goto('/receivables');
  await page.getByTestId('record-payment').first().click();
  await page.getByTestId('payment-amount').fill('20');
  await page.getByTestId('payment-save').click();
  await expect(page.getByTestId('recent-payments')).toContainText(/[A-Z][a-z]{2} \d{1,2}, \d{4}/);
  await expect(page.getByTestId('recent-payments')).not.toContainText(/\d{4}-\d{2}-\d{2}/);
  await page.goto(`/customers/${harbor!.id}/statement`);
  const payRow = page.getByRole('row', { name: /Payment, check/ });
  await expect(payRow).toBeVisible();
  expect(((await payRow.innerText()).match(/check/g) ?? []).length).toBe(1);
});

/** Issues 214 and 221: at the lot the driver reads "You're here", and a toast never covers the lot's name. */
test('the driver sees "You\'re here" at the lot, and a toast stays over the header', async ({ browser, baseURL, page }, info) => {
  test.skip(info.project.name !== 'iphone-13', 'once is enough');
  const { login, startStorm } = await import('./helpers');
  await login(page);
  const { id, runs } = await startStorm(page.request, `Here ${Date.now()}`, ['West Lakewood']);
  const [first] = await sql`select s.lat, s.lon from run_stop rs join site s on s.id = rs.site_id where rs.id = ${runs[0]!.stops[0]!.id}`;
  const ctx = await browser.newContext({ baseURL, viewport: { width: 390, height: 664 }, geolocation: { latitude: Number(first!.lat), longitude: Number(first!.lon) }, permissions: ['geolocation'] });
  try {
    const d = await ctx.newPage();
    await d.goto(runs[0]!.link);
    await expect(d.getByTestId('away')).toHaveText("You're here", { timeout: 20000 });
    await d.getByTestId('arrive').click();
    await d.getByTestId('before-photo').setInputFiles({ name: 'p.jpg', mimeType: 'image/jpeg', buffer: await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 120, g: 130, b: 150 } } }).jpeg().toBuffer() });
    const toast = d.getByTestId('toast-region');
    await expect(toast).not.toBeEmpty();
    const tb = (await toast.locator('div').first().boundingBox())!;
    const hb = (await d.locator('header').boundingBox())!;
    expect(tb.y + tb.height).toBeLessThanOrEqual(hb.y + hb.height + 4);
  } finally {
    await ctx.close();
    await sql`update storm set status = 'closed', closed_at = now() where id = ${id}`;
  }
});
