import { expect, test } from '@playwright/test';
import { login, sql, startStorm } from './helpers';

/** Issues 62 and 63, and the paths people guess (issue 39 follow-up), at iPhone size. */
test.use({ viewport: { width: 390, height: 844 } });
test.beforeEach(() => test.skip(test.info().project.name === 'pixel-7', 'Covered once, at iPhone size'));

test('a backward date range on Reports says so, keeps the dates, offers a swap, and the CSV refuses it', async ({ page }) => {
  await login(page);
  await page.goto('/reports?from=2026-11-11&to=2026-11-01');
  await expect(page.getByTestId('period-backward')).toContainText('is after the To date');
  await expect(page.locator('#from')).toHaveValue('2026-11-11');
  await expect(page.locator('#to')).toHaveValue('2026-11-01');
  await expect(page.getByTestId('hours-summary')).toHaveCount(0);
  await page.getByTestId('period-swap').click();
  await expect(page.locator('#from')).toHaveValue('2026-11-01');
  await expect(page.locator('#to')).toHaveValue('2026-11-11');
  await expect(page.getByTestId('period-backward')).toHaveCount(0);
  expect((await page.request.get('/api/reports/hours.csv?from=2026-11-11&to=2026-11-01')).status()).toBe(422);
  expect((await page.request.get('/api/reports/hours.csv?from=2026-11-01&to=2026-11-11')).status()).toBe(200);
});

test('the quote API refuses a $0 price, as the form does', async ({ page }) => {
  await login(page);
  const [s] = await sql`select id from site where active and tenant_id = (select tenant_id from route where name = 'Rocky River' limit 1) limit 1`;
  const zero = await page.request.post('/api/quotes', { data: { site_id: s!.id, season: '2031-32', services: [{ service: 'plow', pricing: { type: 'per_push', amount_cents: 0 } }], send: false } });
  expect(zero.status()).toBe(422);
  expect(await zero.text()).toContain('The price must be more than $0.00.');
});

test('paths people guess go to the page they mean', async ({ page }) => {
  for (const [from, to] of [['/terms', '/legal/terms'], ['/privacy', '/legal/privacy']]) {
    const r = await page.goto(from!);
    expect(r!.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe(to);
  }
  await login(page);
  await page.goto('/sites');
  expect(new URL(page.url()).pathname).toBe('/customers');
  await page.goto('/alerts');
  expect(new URL(page.url()).pathname).toBe('/dashboard');
});

test('the failed-messages banner says "still retrying" only while a retry is pending', async ({ page }) => {
  await login(page);
  const [t] = await sql`select tenant_id from route where name = 'Rocky River' limit 1`;
  const key = `e2e-failed-${Date.now()}`;
  // Earlier tests may have left retries pending; this one starts from none.
  await sql`update job set done_at = now() where done_at is null and dead_at is null and payload->>'tenantId' = ${t!.tenant_id}`;
  await sql`insert into message_log (tenant_id, channel, to_addr, template, body, status, idempotency_key) values (${t!.tenant_id}, 'email', 'gone@example.com', 'crew_link', 'test', 'failed', ${key})`;
  try {
    await page.goto('/dashboard');
    await expect(page.getByTestId('messages-failed')).toContainText('Flake has stopped retrying');
    await sql`insert into job (kind, payload, dedupe_key, run_at, attempts, last_error) values ('notify.party', ${sql.json({ tenantId: t!.tenant_id })}, ${key}, now() + interval '1 hour', 1, 'Resend 503: down')`;
    await page.reload();
    await expect(page.getByTestId('messages-failed')).toContainText('Flake is still retrying');
  } finally {
    await sql`delete from message_log where idempotency_key = ${key}`;
    await sql`delete from job where dedupe_key = ${key}`;
  }
});

test('a lot started, left for another, and still open at the close can be finished on the closed link', async ({ page }) => {
  await login(page);
  const { id, runs } = await startStorm(page.request, `Left open ${Date.now()}`, ['Rocky River']);
  const d = await page.context().newPage();
  await d.goto(runs[0]!.link);
  const first = (await d.getByTestId('stop-label').textContent())!;
  await d.getByTestId('arrive').click();
  await d.getByTestId('depth-3').click();
  // Pulled away: a Problem, and on to the next lot, which gets done.
  await d.getByTestId('problem').click();
  await d.getByTestId('problem-blocked').click();
  await d.getByTestId('problem-send').click();
  // The lot stays current after a problem on site; the driver picks another from the list below it.
  await d.getByTestId('other-stop').first().click();
  await expect(d.getByTestId('stop-label')).not.toHaveText(first);
  await d.getByTestId('arrive').click();
  await d.getByTestId('done').click();
  await expect.poll(async () => (await sql`select count(*)::int as n from visit where storm_id = ${id} and departed_device_at is not null`)[0]!.n, { timeout: 30000 }).toBe(1);
  expect((await page.request.post(`/api/storms/${id}/close`, { data: { force: true } })).ok()).toBe(true);
  await d.reload();
  // The started lot is back up to finish; nothing new is offered.
  await expect(d.getByTestId('onsite')).toBeVisible();
  await expect(d.getByTestId('arrive')).toHaveCount(0);
  await d.getByTestId('done').click();
  await expect(d.getByTestId('storm-closed')).toBeVisible({ timeout: 30000 });
  await expect.poll(async () => (await sql`select count(*)::int as n from visit where storm_id = ${id} and departed_device_at is not null`)[0]!.n, { timeout: 30000 }).toBe(2);
  expect((await sql`select count(*)::int as n from run_stop rs join storm_run r on r.id = rs.storm_run_id where r.storm_id = ${id} and rs.status = 'onsite'`)[0]!.n).toBe(0);
});
