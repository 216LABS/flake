import { expect, test } from '@playwright/test';
import { finishStops, login, sql, startStorm } from './helpers';

test.afterAll(async () => {
  await sql`select 1`;
});

test('trigger alert to links sent takes 2 taps, with snapshots attached', async ({ page }) => {
  await login(page);
  await sql`update storm set trigger_alert_id = null where tenant_id = (select id from tenant where slug = 'lakeshore-demo')`;
  await sql`delete from trigger_alert where tenant_id = (select id from tenant where slug = 'lakeshore-demo')`;
  await sql`delete from job where kind = 'trigger.evaluate'`;

  await page.goto('/dev/weather');
  await page.getByTestId('load-fixture').click();
  await expect(page.getByTestId('clock')).toHaveText('2025-12-12T12:00:00.000Z');
  await page.getByTestId('advance-6').click();
  await expect(page.getByTestId('clock')).toHaveText('2025-12-12T18:00:00.000Z');
  await page.getByTestId('advance-1').click();
  await expect(page.getByTestId('clock')).toHaveText('2025-12-12T19:00:00.000Z');
  await page.getByTestId('poll').click();
  await expect(page.getByTestId('polled')).toHaveText('Polls run: 1');
  await expect(page.getByTestId('wx')).toContainText('Synthetic demo data');

  await page.goto('/dashboard');
  const row = page.locator('li', { hasText: 'forecast' }).first();
  await expect(row).toBeVisible();
  await row.getByTestId('alert-review').click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('forecast');

  await page.getByTestId('start-storm').click();
  await page.getByTestId('publish').click();
  await page.waitForURL(/\/storms\/[0-9a-f-]+$/);
  const stormId = page.url().split('/').pop()!;

  const [s] = await sql`select forecast_snapshot_ids, trigger_alert_id from storm where id = ${stormId}`;
  expect((s!.forecast_snapshot_ids as string[]).length).toBeGreaterThan(0);
  expect(s!.trigger_alert_id).toBeTruthy();
  await expect.poll(async () => (await sql`select count(*)::int as n from message_log where template = 'crew_link' and related->>'storm_run_id' in (select id::text from storm_run where storm_id = ${stormId})`)[0]!.n, { timeout: 30000 }).toBeGreaterThan(0);

  await page.goto('/dev/inbox');
  await expect(page.locator('[data-template="crew_link"]').first()).toBeVisible();
});

test('board: reassigning updates both driver phones within 10 s; notify once; close is blocked on site', async ({ page, context }) => {
  await login(page);
  const { id, runs } = await startStorm(page.request, `Board ${Date.now()}`, ['West Lakewood', 'Rocky River']);
  const west = runs.find((r) => r.name === 'West Lakewood')!;
  const river = runs.find((r) => r.name === 'Rocky River')!;
  const moved = west.stops[1]!;

  const westPhone = await context.newPage();
  const riverPhone = await context.newPage();
  await westPhone.goto(west.link);
  await riverPhone.goto(river.link);
  await expect(westPhone.getByTestId('next-stop')).toBeVisible();
  await expect(riverPhone.getByTestId('next-stop')).toBeVisible();
  await expect(westPhone.getByText(moved.label)).toBeVisible();

  await page.goto(`/storms/${id}`);
  const card = page.getByTestId('stop-card').filter({ hasText: moved.label });
  const movedAt = Date.now();
  await card.getByTestId('move-to').selectOption({ value: river.id });
  await expect(page.locator(`[data-run="${river.id}"]`).getByText(moved.label)).toBeVisible();
  await expect(riverPhone.getByText(moved.label)).toBeVisible({ timeout: 10000 });
  await expect(westPhone.getByText(moved.label)).toHaveCount(0, { timeout: 10000 });
  expect(Date.now() - movedAt).toBeLessThan(15000);

  // Running late: selected customers get it once.
  const first = west.stops[0]!;
  const notify = async () => {
    await page.getByTestId('notify-open').click();
    await page.getByTestId('notify-template').selectOption('late');
    await page.getByTestId('notify-send').click();
    await expect(page.getByTestId('notify-panel')).toHaveCount(0);
  };
  await notify();
  await notify();
  const count = async () => (await sql`select count(*)::int as n from message_log where template = 'late' and related->>'storm_id' = ${id} and related->>'site_id' = ${first.site_id} and channel = 'email'`)[0]!.n;
  await expect.poll(count, { timeout: 30000 }).toBe(1);
  await page.waitForTimeout(3000);
  expect(await count()).toBe(1);

  // Live board reflects a driver within 5 s, and closing is blocked while they are on site.
  await westPhone.getByTestId('arrive').click();
  await expect(page.getByTestId('stop-card').filter({ hasText: first.label })).toHaveAttribute('data-status', 'onsite', { timeout: 5000 });
  await page.getByTestId('close-storm').click();
  await page.getByTestId('confirm-yes').click();
  await expect(page.getByTestId('close-force')).toBeVisible();
  await page.getByTestId('close-force').click();
  await page.waitForURL(/\/billing\?storm=/);
});

test('billing: flags, inline fix, approve clean, failed card, QuickBooks export', async ({ page }) => {
  await login(page);
  const { id, runs } = await startStorm(page.request, `Billing ${Date.now()}`, ['West Lakewood']);
  const run = runs[0]!;
  const skipped = run.stops.find((s) => s.label.includes('Hilliard Rd #210'))!;
  await finishStops(page.request, run, run.stops.filter((s) => s.id !== skipped.id));
  const closed = await page.request.post(`/api/storms/${id}/close`, { data: { force: false } });
  expect(closed.ok()).toBe(true);

  await page.goto(`/billing?storm=${id}`);
  await page.getByTestId('generate').click();
  await expect(page.getByTestId('draft').first()).toBeVisible();

  // Show flagged only is on by default, and the missing visit is flagged.
  await expect(page.getByTestId('flagged-only')).toBeChecked();
  const missing = page.locator('[data-code="missing_visit"]');
  await expect(missing).toHaveCount(1);
  await missing.getByTestId('fix-skip').click();
  await expect(page.locator('[data-code="missing_visit"]')).toHaveCount(0);

  // These test visits have no after photos; waiving them makes the drafts clean.
  for (let i = 0; i < 30; i++) {
    const waive = page.getByTestId('fix-waive').first();
    if (!(await waive.count())) break;
    await waive.click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(300);
  }
  await expect(page.getByTestId('fix-waive')).toHaveCount(0, { timeout: 30000 });

  // Double click: one charge per draft.
  const approve = page.getByTestId('approve-clean');
  await expect(approve).toBeEnabled();
  await approve.dblclick();
  await expect.poll(async () => (await sql`select count(*)::int as n from invoice_draft where storm_id = ${id} and status = 'draft'`)[0]!.n, { timeout: 30000 }).toBe(0);
  await expect.poll(async () => (await sql`select count(*)::int as n from invoice_draft where storm_id = ${id} and status = 'approved' and status_detail is null`)[0]!.n, { timeout: 40000 }).toBe(0);
  const rows = await sql`select d.status, d.status_detail, d.pay_link, c.billing_mode, c.stripe_payment_method_id as pm, d.application_fee_cents as fee, d.subtotal_cents as total from invoice_draft d join customer c on c.id = d.customer_id where d.storm_id = ${id}`;
  const declined = rows.find((r) => r.pm === 'pm_mock_0002')!;
  expect(declined.status).toBe('failed');
  expect(declined.status_detail).toMatch(/declined/);
  expect(declined.pay_link).toBeTruthy();
  expect(rows.find((r) => r.billing_mode === 'invoice_net30' && (r.total as number) > 0)!.status).toBe('sent');
  expect(rows.some((r) => r.status === 'paid')).toBe(true);
  for (const r of rows.filter((x) => (x.total as number) > 0)) {
    expect(r.fee).toBe(Math.min(2500, Math.max(50, Math.round((r.total as number) * 0.01))));
  }

  await page.reload();
  await expect(page.locator('[data-status="failed"]').getByTestId('status-detail')).toContainText('declined');
  const csv = await page.request.get(`/api/billing/export.csv?storm=${id}`);
  expect(csv.ok()).toBe(true);
  expect(await csv.text()).toContain('InvoiceNo');
});

test('proof packet: generate, download, and the hash repeats', async ({ page }) => {
  await login(page);
  const [c1] = await sql`select s.id from site s join tenant t on t.id = s.tenant_id where t.slug = 'lakeshore-demo' and s.label = 'Madison Ave Retail Lot'`;
  await page.goto(`/proof?site=${c1!.id}`);
  await page.getByLabel('From').fill('2025-12-01');
  await page.getByLabel('To').fill('2025-12-31');
  const generate = async () => {
    await page.getByTestId('proof-generate').click();
    await expect(page.getByTestId('proof-ready')).toBeVisible({ timeout: 60000 });
    return page.getByTestId('manifest-hash').textContent();
  };
  const a = await generate();
  expect(a).toMatch(/^[0-9a-f]{64}$/);
  const href = await page.getByTestId('proof-download').getAttribute('href');
  const pdf = await page.request.get(href!);
  expect(pdf.ok()).toBe(true);
  expect((await pdf.body()).subarray(0, 4).toString()).toBe('%PDF');
  expect(await generate()).toBe(a);
});

test('settings: rate card, Stripe onboarding in mock, crew invite with opt-in, SMS verification path', async ({ page, browser }) => {
  await login(page);
  await page.goto('/settings?tab=rate');
  await page.getByTestId('rate-save').click();
  await expect(page.getByTestId('rate-msg')).toHaveText('Saved');
  await page.getByTestId('tab-payments').click();
  await expect(page.getByTestId('stripe-status')).toHaveText('Charges enabled');

  await page.getByTestId('tab-crew').click();
  const name = `Invited ${Date.now()}`;
  await page.getByTestId('crew-name').fill(name);
  await page.getByLabel('Mobile').fill('+12165550155');
  await page.getByTestId('crew-invite').click();
  const invite = await page.getByTestId('invite-url').inputValue();

  const fresh = await browser.newContext();
  const join = await fresh.newPage();
  await join.goto(invite);
  await expect(join.getByTestId('crew-consent')).not.toBeChecked();
  await join.getByTestId('crew-consent').check();
  await join.getByTestId('join').click();
  await expect(join.getByTestId('joined')).toBeVisible();
  await fresh.close();
  const [row] = await sql`select opted_in_source from sms_consent where phone_e164 = '+12165550155'`;
  expect(row!.opted_in_source).toBe('crew_invite');

  await page.goto('/settings?tab=sms');
  await expect(page.getByTestId('sms-status')).toHaveText('approved');
  await page.goto('/settings?tab=system');
  await expect(page.getByTestId('breaker')).toBeVisible();
  await page.goto('/settings?tab=plan');
  await expect(page.getByTestId('plan')).toBeVisible();
});

test('a brand new user can set up a company, connect mock Stripe and sees the free season', async ({ page }) => {
  const email = `new-${Date.now()}@flake.test`;
  const admin = await page.request.post(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/signup`, { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! }, data: { email, password: 'flake-demo-only' } });
  expect(admin.ok()).toBe(true);
  await login(page);
  await page.request.post('/api/dev/login', { data: { email } });
  await page.goto('/dashboard');
  await page.waitForURL('**/onboarding');
  await page.getByTestId('company').fill('Fresh Plow LLC');
  await page.getByTestId('create-company').click();
  await page.waitForURL('**/dashboard');
  await page.goto('/settings?tab=payments');
  await page.getByTestId('stripe-connect').click();
  await page.getByTestId('mock-finish').click();
  await expect(page.getByTestId('stripe-status')).toHaveText('Charges enabled');
  await page.goto('/settings?tab=plan');
  await expect(page.getByText('Free first season through 2027-04-30')).toBeVisible();
  await page.goto('/storms');
  await expect(page.getByText('No storms yet')).toBeVisible();
});
