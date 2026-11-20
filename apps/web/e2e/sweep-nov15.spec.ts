import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { login, sql } from './helpers';

/** Issue 142: a signed-out deep link comes back to that page after sign-in, not the dashboard. */
test('signing in from a deep link lands on the page that asked for it', async ({ page }) => {
  const [c] = await sql`select c.id from customer c join tenant t on t.id = c.tenant_id where t.slug = 'lakeshore-demo' and c.archived_at is null limit 1`;
  await page.goto(`/customers/${c!.id}`);
  await page.waitForURL(/\/login\?next=/);
  expect(decodeURIComponent(new URL(page.url()).searchParams.get('next')!)).toBe(`/customers/${c!.id}`);
  await page.getByTestId('demo-login').click();
  await page.waitForURL(`**/customers/${c!.id}`);
  // A link that would leave the site is ignored.
  await page.context().clearCookies();
  await page.goto('/login?next=//evil.example/x');
  await page.getByTestId('demo-login').click();
  await page.waitForURL('**/dashboard');
});

/** Issue 144: the browser's Back goes to the wizard's previous step and keeps what was typed. */
test('browser Back and Forward move between wizard steps without losing entries', async ({ page }) => {
  await login(page);
  await page.goto('/customers/new');
  const name = `History ${randomUUID().slice(0, 6)}`;
  await page.getByTestId('c-name').fill(name);
  await page.getByTestId('next').click();
  await expect(page.getByTestId('address')).toBeVisible();
  // Issue 158: the new step has keyboard focus, not the page body.
  await expect(page.getByTestId('address')).toBeFocused();
  await page.getByTestId('address').fill('14701 Detroit Ave, Lakewood, OH');
  await page.goBack();
  await expect(page.getByTestId('c-name')).toHaveValue(name);
  await page.goForward();
  await expect(page.getByTestId('address')).toHaveValue('14701 Detroit Ave, Lakewood, OH');
  // A step not reached yet can't be opened from the address bar.
  await page.goto('/customers/new?step=4');
  await expect(page.getByTestId('c-name')).toBeVisible();
});

/** Issue 145: a storm link that no longer exists says so and shows the newest storm, not "No storms yet". */
test('billing for an unknown storm id names the problem', async ({ page }) => {
  await login(page);
  await page.goto(`/billing?storm=${randomUUID()}`);
  await expect(page.getByTestId('storm-not-found')).toBeVisible();
  await expect(page.getByText('No storms yet')).toHaveCount(0);
});

/** Issue 149: the mailing address is on Settings, Company, and goes on customer emails. */
test('the company mailing address saves from the Company tab', async ({ page }) => {
  await login(page);
  const [before] = await sql`select address, business_legal_name from tenant where slug = 'lakeshore-demo'`;
  try {
    await page.goto('/settings?tab=company');
    await page.getByTestId('co-line1').fill('100 Test Yard Rd');
    await page.getByTestId('co-city').fill('Lakewood');
    await page.getByTestId('co-state').fill('OH');
    await page.getByTestId('co-zip').fill('44107');
    await page.getByTestId('co-save').click();
    await expect(page.getByTestId('co-msg')).toHaveText('Saved');
    const [after] = await sql`select address from tenant where slug = 'lakeshore-demo'`;
    expect(after!.address).toMatchObject({ line1: '100 Test Yard Rd', city: 'Lakewood', state: 'OH', zip: '44107' });
  } finally {
    await sql`update tenant set address = ${before!.address ? sql.json(before!.address) : null}, business_legal_name = ${before!.business_legal_name} where slug = 'lakeshore-demo'`;
  }
});

/** Issue 153: the depth tiers on the rate card are editable. */
test('rate card tiers can be changed and are checked before saving', async ({ page }) => {
  await login(page);
  const [before] = await sql`select rate_card from tenant where slug = 'lakeshore-demo'`;
  try {
    await page.goto('/settings?tab=rate');
    const depths = page.getByTestId('tier-depth');
    await depths.nth(0).fill('6');
    await depths.nth(1).fill('4');
    await expect(page.getByTestId('rate-problem')).toContainText('deeper than the one before');
    await depths.nth(0).fill('2');
    await depths.nth(1).fill('6');
    await page.getByTestId('rate-save').click();
    await expect(page.getByTestId('rate-msg')).toHaveText('Saved');
    const [after] = await sql`select rate_card from tenant where slug = 'lakeshore-demo'`;
    expect((after!.rate_card as { tiers: { up_to_in: number | null }[] }).tiers.slice(0, 2).map((t) => t.up_to_in)).toEqual([2, 6]);
  } finally {
    await sql`update tenant set rate_card = ${sql.json(before!.rate_card)} where slug = 'lakeshore-demo'`;
  }
});

/** Issue 146: a stop moves to a typed position, without tapping Up again and again. */
test('a route stop moves to a typed position', async ({ page }) => {
  await login(page);
  await page.goto('/routes');
  const card = page.getByTestId('route-card').filter({ has: page.getByTestId('route-position').nth(2) }).first();
  const labels = async () => (await card.locator('ol > li').allInnerTexts()).map((t) => t.replace(/^\d+\.?\s*/, '').split('\n')[0]);
  const start = await labels();
  try {
    await card.getByTestId('route-position').nth(2).click();
    await card.getByTestId('route-position-input').fill('1');
    await card.getByTestId('route-position-input').press('Enter');
    await expect.poll(labels).toEqual([start[2], start[0], start[1], ...start.slice(3)]);
  } finally {
    await page.reload();
    if ((await labels())[0] === start[2]) {
      await card.getByTestId('route-position').nth(0).click();
      await card.getByTestId('route-position-input').fill('3');
      await card.getByTestId('route-position-input').press('Enter');
      await expect.poll(labels).toEqual(start);
    }
  }
});

/** Issue 153: the pricing page answers who pays for texts, with the Stripe fee as a footnote under the plans. */
test('the free-season page answers the first questions (issue 182 replaced pricing)', async ({ page }) => {
  await page.goto('/free-season');
  await expect(page.getByTestId('free-season-faq')).toContainText('Who pays for the texts?');
  await expect(page.getByTestId('free-season-faq')).toContainText('a small Flake fee');
});

/** Issue 164: a stale tab's second save doesn't undo another tab's rename. */
test('two tabs on one customer: a rename survives the other tab saving twice', async ({ page, browser, baseURL }) => {
  await login(page);
  const tag = randomUUID().slice(0, 6);
  const c = await (await page.request.post('/api/customers', { data: { name: `Tabs ${tag}`, kind: 'commercial', billing_mode: 'manual' } })).json();
  const b = await (await browser.newContext({ baseURL, storageState: await page.context().storageState() })).newPage();
  await page.goto(`/customers/${c.id}`);
  await b.goto(`/customers/${c.id}`);
  await page.locator('#name').fill(`Tabs ${tag} renamed`);
  await page.getByTestId('customer-save').click();
  await expect(page.getByTestId('customer-msg')).toHaveText('Saved');
  for (const who of ['Pat', 'Sam']) {
    await b.locator('#contact_name').fill(who);
    await b.getByTestId('customer-save').click();
    await expect(b.getByTestId('customer-msg')).toHaveText('Saved');
  }
  // The tab that never touched the name now shows the rename instead of sending its old copy back.
  await expect(b.locator('#name')).toHaveValue(`Tabs ${tag} renamed`);
  const [row] = await sql`select name, contact_name from customer where id = ${c.id}`;
  expect([row!.name, row!.contact_name]).toEqual([`Tabs ${tag} renamed`, 'Sam']);
});

/** Equipment: add a truck, log fuel, set it as a route's default, and see it on Reports. */
test('equipment: a truck, its fuel log, a route default, and the report', async ({ page }) => {
  await login(page);
  const name = `Truck ${randomUUID().slice(0, 4)}`;
  try {
    await page.goto('/settings?tab=equipment');
    await page.getByTestId('truck-name').fill(name);
    await page.getByTestId('truck-add').click();
    await expect(page.getByTestId('truck-row').filter({ hasText: name })).toBeVisible();
    await page.getByTestId('log-truck').selectOption({ label: name });
    await page.getByTestId('log-gallons').fill('18.5');
    await page.getByTestId('log-cost').fill('62.90');
    await page.getByTestId('log-add').click();
    await expect(page.getByTestId('log-summary')).toContainText('18.5 gal, $62.90');
    await page.goto('/reports');
    await expect(page.getByTestId('equipment-row').filter({ hasText: name })).toContainText('18.5 gal');
    await page.goto('/routes');
    const select = page.getByTestId('route-truck').first();
    await select.selectOption({ label: name });
    await expect.poll(async () => (await sql`select count(*)::int as n from route r join truck t on t.id = r.default_truck_id where t.name = ${name}`)[0]!.n).toBe(1);
  } finally {
    await sql`update route set default_truck_id = null where default_truck_id in (select id from truck where name = ${name})`;
    await sql`delete from equipment_log where truck_id in (select id from truck where name = ${name})`;
    await sql`delete from truck where name = ${name}`;
  }
});

/** The site walk: a note on a lot, listed for this season. */
test('site walk: a note saves on the lot page', async ({ page }) => {
  await login(page);
  const [s] = await sql`select s.id from site s join tenant t on t.id = s.tenant_id where t.slug = 'lakeshore-demo' and s.active limit 1`;
  const note = `Cracked curb ${randomUUID().slice(0, 4)}`;
  try {
    await page.goto(`/sites/${s!.id}`);
    await page.getByTestId('walk-note').fill(note);
    await page.getByTestId('walk-add').click();
    await expect(page.getByTestId('walk-item').filter({ hasText: note })).toBeVisible();
  } finally {
    await sql`delete from site_walk_item where note = ${note}`;
  }
});

/** Pilot feedback: sent from any page, kept for the Flake team with the page it came from, and the guide is one tap away. */
test('feedback goes to the Flake team with the page, and the storm-night guide opens', async ({ page }) => {
  await login(page);
  await page.goto('/billing');
  const text = `Could not find the void button ${randomUUID().slice(0, 4)}`;
  await page.getByTestId('feedback-open').click();
  await page.getByTestId('feedback-message').fill(text);
  await page.getByTestId('feedback-send').click();
  await expect(page.getByTestId('feedback-sent')).toBeVisible();
  await page.goto('/admin/feedback');
  await expect(page.getByTestId('feedback-item').filter({ hasText: text })).toContainText('on /billing');
  await page.goto('/dashboard');
  await page.getByTestId('feedback-open').click();
  await page.getByTestId('help-link').click();
  await expect(page.getByRole('heading', { name: 'Storm-night guide' })).toBeVisible();
});

/** Issue 163: an incident packet from the moment of a slip, with its summary and station weather. */
test('an incident packet is made from the time it happened', async ({ page }) => {
  await login(page);
  const [c1] = await sql`select s.id from site s join tenant t on t.id = s.tenant_id where t.slug = 'lakeshore-demo' and s.label = 'Madison Ave Retail Lot'`;
  await page.goto(`/proof?site=${c1!.id}`);
  await page.getByTestId('proof-mode').getByText('Slip or damage (incident)').click();
  await page.getByTestId('proof-incident').fill('2025-12-13T08:30');
  const generate = async () => {
    await page.getByTestId('proof-generate').click();
    await expect(page.getByTestId('proof-ready')).toBeVisible({ timeout: 60000 });
    return page.getByTestId('manifest-hash').textContent();
  };
  const a = await generate();
  expect(a).toMatch(/^[0-9a-f]{64}$/);
  const [row] = await sql`select manifest from proof_packet where manifest_sha256 = ${a} limit 1`;
  expect((row!.manifest as { incident_at?: string }).incident_at).toBeTruthy();
  // The hash repeating is checked in the integration test, without another render here.
});

/** First-run walk: a brand-new company's first lot lands on a new route, so its first storm has somewhere to go. */
test('a new company\'s first customer goes onto a new route from the wizard', async ({ page }) => {
  const email = `route-${randomUUID().slice(0, 6)}@flake.test`;
  const signup = await page.request.post(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/signup`, { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! }, data: { email, password: 'flake-demo-only' } });
  expect(signup.ok()).toBe(true);
  await page.request.post('/api/dev/login', { data: { email } });
  await page.goto('/onboarding');
  await page.getByTestId('company').fill('Route First LLC');
  await page.getByTestId('agree-terms').check();
  await page.getByTestId('create-company').click();
  await page.waitForURL('**/dashboard');
  await page.goto('/customers/new');
  await page.getByTestId('c-name').fill('First Lot Co');
  await page.getByTestId('next').click();
  await page.getByTestId('address').fill('14701 Detroit Ave, Lakewood, OH');
  await page.getByTestId('find').click();
  await expect(page.getByTestId('sqft')).toContainText('sq ft');
  await page.getByTestId('next').click();
  await page.getByTestId('price').fill('60.00');
  await page.getByTestId('next').click();
  await page.getByTestId('next').click();
  await expect(page.getByTestId('route-select')).toHaveValue('new');
  await expect(page.getByTestId('wizard-new-route')).toHaveValue('Route 1');
  await page.getByTestId('next').click();
  await page.getByTestId('send-quote').click();
  await expect(page.getByTestId('quote-note')).toBeVisible();
  await page.goto('/dashboard');
  await expect(page.getByRole('main').getByRole('link', { name: 'Start a storm' })).toBeVisible();
  await expect(page.getByTestId('needs-route')).toHaveCount(0);
  await page.goto('/routes');
  await expect(page.getByTestId('route-card')).toContainText('14701 Detroit Ave');
});
