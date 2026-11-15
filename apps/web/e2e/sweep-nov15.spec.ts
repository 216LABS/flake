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
  const labels = async () => (await card.locator('ol > li').allInnerTexts()).map((t) => t.replace(/^\d+\.\s*/, '').split('\n')[0]);
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
test('pricing answers the first questions', async ({ page }) => {
  await page.goto('/pricing');
  await expect(page.getByTestId('pricing-faq')).toContainText('Who pays for the texts?');
  await expect(page.getByTestId('stripe-fees')).toBeVisible();
});
