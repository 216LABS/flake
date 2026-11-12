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

test('a "not before" time saves on the site, keeps its open-by time, and the driver sees it', async ({ page }) => {
  await login(page);
  const { id, runs } = await startStorm(page.request, `Not before ${Date.now()}`, ['Rocky River']);
  const siteId = runs[0]!.stops[0]!.site_id;
  const [before] = await sql`select service_window from site where id = ${siteId}`;
  try {
    await page.goto(`/sites/${siteId}`);
    await page.locator('#open').fill('07:00');
    await page.getByTestId('not-before').fill('05:30');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    const [after] = await sql`select service_window from site where id = ${siteId}`;
    expect(after!.service_window).toMatchObject({ open_by: '07:00', not_before: '05:30' });
    const d = await page.context().newPage();
    await d.goto(runs[0]!.link);
    await expect(d.getByTestId('not-before-tag')).toContainText('05:30');
  } finally {
    await sql`update site set service_window = ${before!.service_window ? sql.json(before!.service_window) : null} where id = ${siteId}`;
    await sql`update storm set status = 'closed', closed_at = now() where id = ${id}`;
  }
});

test('with a yard saved, each route starts and ends there by default, and a route can turn it off', async ({ page }) => {
  await login(page);
  const [t] = await sql`select id, yard from tenant where id = (select tenant_id from route where name = 'Rocky River' limit 1)`;
  try {
    await page.goto('/settings');
    await page.getByTestId('co-yard').fill('13000 Berea Rd, Cleveland, OH');
    await page.getByTestId('co-save').click();
    await expect(page.getByTestId('co-msg')).toBeVisible();
    const [saved] = await sql`select yard from tenant where id = ${t!.id}`;
    expect(saved!.yard).toMatchObject({ address: '13000 Berea Rd, Cleveland, OH', lat: expect.any(Number), lon: expect.any(Number) });

    await page.goto('/routes');
    const card = page.getByTestId('route-card').filter({ has: page.locator('input[value="Rocky River"]') });
    await expect(card.getByTestId('route-yard-trip')).toBeChecked();
    await card.getByTestId('suggest-open').click();
    await expect(card.getByTestId('suggest-yard')).toContainText('13000 Berea Rd');
    await expect(card.getByTestId('suggest-list')).toBeVisible();
    // Road times from the router (mocked in tests), and the plan says so (issue 65).
    await expect(card.getByTestId('suggest-times')).toContainText('mock road times');
    const withYard = await page.request.post(`/api/routes/${(await sql`select id from route where name = 'Rocky River' and tenant_id = ${t!.id}`)[0]!.id}/suggest`, { data: { site_ids: (await sql`select rs.site_id from route_stop rs join route r on r.id = rs.route_id where r.name = 'Rocky River' and r.tenant_id = ${t!.id} order by rs.seq`).map((x) => x.site_id) } });
    expect((await withYard.json()).yard).toBe(true);

    // Off for this route: the switch sticks, and Suggest order no longer mentions the yard.
    await card.getByTestId('route-yard-trip').uncheck();
    await expect.poll(async () => (await sql`select yard_trip from route where name = 'Rocky River' and tenant_id = ${t!.id}`)[0]!.yard_trip).toBe(false);
    await page.reload();
    await expect(card.getByTestId('route-yard-trip')).not.toBeChecked();
    await card.getByTestId('suggest-open').click();
    await expect(card.getByTestId('suggest-list')).toBeVisible();
    await expect(card.getByTestId('suggest-yard')).toHaveCount(0);
  } finally {
    await sql`update route set yard_trip = true where tenant_id = ${t!.id}`;
    await sql`update tenant set yard = ${t!.yard ? sql.json(t!.yard) : null} where id = ${t!.id}`;
  }
});

test('Send routes to crew says who gets what first, and Cancel sends nothing (issue 76)', async ({ page }) => {
  await login(page);
  await sql`update storm set status = 'closed', closed_at = now() where status = 'active'`;
  const [r] = await sql`select id from route where name = 'Rocky River' limit 1`;
  const { id } = await (await page.request.post('/api/storms', { data: { name: `Send ${Date.now()}`, routeIds: [r!.id] } })).json();
  try {
    await page.goto(`/storms/${id}`);
    await expect(page.getByTestId('publish')).toHaveText('Send routes to crew');
    await page.getByTestId('publish').click();
    const list = page.getByTestId('send-routes-list');
    await expect(list).toContainText('Teo Placeholder');
    await expect(list).toContainText(/by (text and )?email/);
    await page.getByTestId('confirm-no').click();
    expect((await sql`select count(*)::int as n from storm_run where storm_id = ${id} and published_at is not null`)[0]!.n).toBe(0);
    await page.getByTestId('publish').click();
    await page.getByTestId('confirm-yes').click();
    await expect(page.getByTestId('publish')).toHaveCount(0);
    expect((await sql`select count(*)::int as n from storm_run where storm_id = ${id} and published_at is null`)[0]!.n).toBe(0);
  } finally {
    await sql`update storm set status = 'closed', closed_at = now() where id = ${id}`;
  }
});

test('a driver who blocks location is told plainly what it costs (issue 77)', async ({ browser, baseURL, page }) => {
  await login(page);
  const { id, runs } = await startStorm(page.request, `No location ${Date.now()}`, ['Rocky River']);
  // A phone that said no to location for this site.
  const ctx = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, permissions: [] });
  try {
    const d = await ctx.newPage();
    await d.goto(runs[0]!.link);
    await expect(d.getByTestId('location-off')).toHaveCount(0);
    await d.getByTestId('arrive').click();
    await expect(d.getByTestId('location-off')).toContainText("won't have GPS proof");
  } finally {
    await ctx.close();
    await sql`update storm set status = 'closed', closed_at = now() where id = ${id}`;
  }
});

test('a yard address with no exact match offers the closest ones, and a picked one saves (issue 79)', async ({ page }) => {
  await login(page);
  const [t] = await sql`select id, yard from tenant where id = (select tenant_id from route where name = 'Rocky River' limit 1)`;
  try {
    await page.goto('/settings');
    await page.getByTestId('co-yard').fill('13000 Berea Rd #nomatch');
    await page.getByTestId('co-save').click();
    await expect(page.getByTestId('co-yard-missed')).toBeVisible();
    const hit = page.getByTestId('co-yard-hit').first();
    const label = (await hit.textContent())!;
    await hit.click();
    await expect(page.getByTestId('co-yard')).toHaveValue(label);
    await page.getByTestId('co-save').click();
    await expect.poll(async () => (await sql`select yard from tenant where id = ${t!.id}`)[0]!.yard?.address).toBe(label);
    // Typing shows matches too, before saving.
    await page.getByTestId('co-yard').fill('12900 Berea');
    await expect(page.getByTestId('co-yard-hit').first()).toBeVisible();
  } finally {
    await sql`update tenant set yard = ${t!.yard ? sql.json(t!.yard) : null} where id = ${t!.id}`;
  }
});

test('the driver sees "Do this one first" on a priority 1 lot and no number on the others (issue 80)', async ({ page }) => {
  await login(page);
  const { id, runs } = await startStorm(page.request, `First lot ${Date.now()}`, ['Rocky River']);
  const first = runs[0]!.stops[0]!;
  const [before] = await sql`select priority from site where id = ${first.site_id}`;
  try {
    await sql`update site set priority = 1 where id = ${first.site_id}`;
    const d = await page.context().newPage();
    await d.goto(runs[0]!.link);
    await expect(d.getByTestId('priority')).toHaveText('Do this one first');
    await sql`update site set priority = 3 where id = ${first.site_id}`;
    await d.reload();
    await expect(d.getByTestId('stop-label')).toBeVisible();
    await expect(d.getByTestId('priority')).toHaveCount(0);
    await expect(d.getByText(/Priority \d/)).toHaveCount(0);
  } finally {
    await sql`update site set priority = ${before!.priority} where id = ${first.site_id}`;
    await sql`update storm set status = 'closed', closed_at = now() where id = ${id}`;
  }
});

test('"Text it" hands the route link to the phone to send, with no message from Flake (issue 84)', async ({ page }) => {
  await login(page);
  // Stand in for the phone's share sheet and remember what it was given.
  await page.addInitScript(() => {
    (window as unknown as { shared: string[] }).shared = [];
    Object.defineProperty(navigator, 'share', { configurable: true, value: async (d: { text: string }) => { (window as unknown as { shared: string[] }).shared.push(d.text); } });
  });
  await sql`update storm set status = 'closed', closed_at = now() where status = 'active'`;
  const [r] = await sql`select id from route where name = 'Rocky River' limit 1`;
  const { id } = await (await page.request.post('/api/storms', { data: { name: `Text it ${Date.now()}`, routeIds: [r!.id] } })).json();
  try {
    await page.goto(`/storms/${id}`);
    await page.getByTestId('show-link').first().click();
    const link = await page.getByTestId('run-link').inputValue();
    await page.getByTestId('text-link').click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { shared: string[] }).shared[0] ?? '')).toContain(link);
    expect((await sql`select count(*)::int as n from message_log m join storm_run sr on (m.related->>'storm_run_id')::uuid = sr.id where sr.storm_id = ${id}`)[0]!.n).toBe(0);
  } finally {
    await sql`update storm set status = 'closed', closed_at = now() where id = ${id}`;
  }
});
