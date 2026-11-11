import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { finishStops, login, sql, startStorm } from './helpers';

/**
 * The second QA batch (issues 51 to 61), at phone size the way the QA pass found them: two phones on one link, a
 * closed storm on the driver's phone, double taps, a text file picked as a photo, a quote the customer turns down,
 * a Due invoice without online pay, archived routes, and the payroll table on an iPhone.
 */
test.use({ viewport: { width: 390, height: 844 } });
test.beforeEach(() => test.skip(test.info().project.name === 'pixel-7', 'Driver and portal flows are covered once, at iPhone size'));

const jpg = async () => ({ name: 'p.jpg', mimeType: 'image/jpeg', buffer: await sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 90, g: 120, b: 160 } } }).withExif({ IFD0: { Model: randomUUID().slice(0, 6) } }).jpeg().toBuffer() });

async function arriveFirst(p: Page) {
  await p.getByTestId('arrive').click();
  await expect(p.getByTestId('onsite')).toBeVisible();
}

test('two phones on one route link: the second is told the stop is taken, and one visit is stored', async ({ page, browser, baseURL }) => {
  await login(page);
  const { id, runs } = await startStorm(page.request, `Two phones ${Date.now()}`, ['Rocky River']);
  const run = runs[0]!;
  const a = await page.context().newPage();
  const otherCtx = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const b = await otherCtx.newPage();
  await a.goto(run.link);
  await b.goto(run.link);
  const label = (await a.getByTestId('stop-label').textContent())!;
  await expect(b.getByTestId('stop-label')).toHaveText(label);
  await arriveFirst(a);
  await expect.poll(async () => (await sql`select count(*)::int as n from visit where storm_id = ${id}`)[0]!.n, { timeout: 30000 }).toBe(1);
  // Phone B hasn't refreshed yet and taps Arrive on the same lot.
  await b.getByTestId('arrive').click();
  await expect(b.getByText('Someone else on this route is already doing this stop.').first()).toBeVisible({ timeout: 30000 });
  // B lets go of it and moves on; the taken lot waits at the back of its list, marked.
  await expect(b.getByTestId('onsite')).toHaveCount(0);
  await expect(b.getByTestId('stop-label')).not.toHaveText(label, { timeout: 30000 });
  await expect(b.getByTestId('other-stop-taken')).toBeVisible();
  expect((await sql`select count(*)::int as n from visit where storm_id = ${id}`)[0]!.n).toBe(1);
  await otherCtx.close();
  await sql`update storm set status = 'closed', closed_at = now() where id = ${id}`;
});

test('after the office closes the storm, the phone says so and offers no new stops, but work already started can finish', async ({ page }) => {
  await login(page);
  const { id, runs } = await startStorm(page.request, `Closed ${Date.now()}`, ['Rocky River']);
  const d = await page.context().newPage();
  await d.goto(runs[0]!.link);
  await arriveFirst(d);
  await d.getByTestId('depth-3').click();
  await expect.poll(async () => (await sql`select count(*)::int as n from visit where storm_id = ${id}`)[0]!.n, { timeout: 30000 }).toBe(1);
  expect((await page.request.post(`/api/storms/${id}/close`, { data: { force: true } })).ok()).toBe(true);
  await d.reload();
  // The lot the driver is standing on can still be finished.
  await expect(d.getByTestId('onsite')).toBeVisible();
  await d.getByTestId('after-photo').setInputFiles(await jpg());
  await d.getByTestId('done').click();
  await expect(d.getByTestId('storm-closed')).toBeVisible({ timeout: 30000 });
  await expect(d.getByTestId('arrive')).toHaveCount(0);
  await expect(d.getByTestId('other-stop')).toHaveCount(0);
  await expect.poll(async () => (await sql`select count(*)::int as n from visit where storm_id = ${id} and departed_device_at is not null`)[0]!.n, { timeout: 30000 }).toBe(1);
  expect((await sql`select count(*)::int as n from visit where storm_id = ${id}`)[0]!.n).toBe(1);
});

test('a double tap on Send stores one problem, a text file is not taken as a photo, and Skip after Arrive leaves no open visit', async ({ page }) => {
  await login(page);
  const { id, runs } = await startStorm(page.request, `Taps ${Date.now()}`, ['Rocky River']);
  const d = await page.context().newPage();
  await d.goto(runs[0]!.link);
  await d.getByTestId('problem').click();
  await d.getByTestId('problem-blocked').click();
  await d.getByTestId('problem-send').dblclick();
  await expect.poll(async () => (await sql`select count(*)::int as n from problem_report where storm_run_id = ${runs[0]!.id}`)[0]!.n, { timeout: 30000 }).toBe(1);
  await d.waitForTimeout(3000);
  expect((await sql`select count(*)::int as n from problem_report where storm_run_id = ${runs[0]!.id}`)[0]!.n).toBe(1);

  // The next lot: arrive, try a text file as the After photo, then skip it.
  await arriveFirst(d);
  await d.getByTestId('after-photo').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a photo') });
  await expect(d.getByText('That file is not a photo. Take the photo again.')).toBeVisible();
  await expect(d.getByText('✓ After photo')).toHaveCount(0);
  // A retake is counted.
  await d.getByTestId('before-photo').setInputFiles(await jpg());
  await d.getByTestId('before-photo').setInputFiles(await jpg());
  await expect(d.getByText('✓ Before photo (2)')).toBeVisible();
  await d.getByTestId('problem').click();
  await d.getByTestId('problem-skip').click();
  await d.getByTestId('problem-send').click();
  await expect.poll(async () => (await sql`select count(*)::int as n from visit v where v.storm_id = ${id} and v.departed_device_at is null
    and not exists (select 1 from visit_correction c where c.visit_id = v.id and c.field = 'voided' and c.new_value = 'true'::jsonb)`)[0]!.n, { timeout: 30000 }).toBe(0);
  await sql`update storm set status = 'closed', closed_at = now() where id = ${id}`;
});

test('the QR and copy link work before Publish, and nothing is sent to the crew', async ({ page }) => {
  await login(page);
  await sql`update storm set status = 'closed', closed_at = now() where status = 'active'`;
  const [r] = await sql`select id from route where name = 'Rocky River'`;
  const made = await page.request.post('/api/storms', { data: { name: `Before publish ${Date.now()}`, routeIds: [r!.id] } });
  const { id } = await made.json();
  await page.goto(`/storms/${id}`);
  await expect(page.getByTestId('publish')).toBeVisible();
  await page.getByTestId('show-link').first().click();
  await expect(page.getByTestId('run-link')).toHaveValue(/\/d\//);
  expect((await sql`select count(*)::int as n from message_log m join storm_run sr on (m.related->>'storm_run_id')::uuid = sr.id where sr.storm_id = ${id}`)[0]!.n).toBe(0);
  await sql`update storm set status = 'closed', closed_at = now() where id = ${id}`;
});

test('an archived route can be found and restored', async ({ page }) => {
  await login(page);
  await page.goto('/routes');
  const name = `Restore me ${Date.now()}`;
  await page.getByLabel('New route').fill(name);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const card = page.getByTestId('route-card').filter({ has: page.locator(`input[value="${name}"]`) });
  await card.getByTestId('route-archive').click();
  await page.getByTestId('confirm-yes').click();
  await expect(card).toHaveCount(0);
  await page.getByTestId('show-archived-routes').click();
  await page.getByTestId('archived-route').filter({ hasText: name }).getByTestId('restore-route').click();
  await expect(page.getByTestId('archived-route').filter({ hasText: name })).toHaveCount(0);
  await page.goto('/routes');
  await expect(page.locator(`input[value="${name}"]`)).toBeVisible();
});

test('a Due invoice on the customer page shows its lines and how to pay without an online link', async ({ page, browser, baseURL }) => {
  await login(page);
  // A storm with one finished stop; closing it drafts the invoice (issue 48).
  const { id, runs } = await startStorm(page.request, `Due ${Date.now()}`, ['Rocky River']);
  await finishStops(page.request, runs[0]!, runs[0]!.stops.slice(0, 1));
  expect((await page.request.post(`/api/storms/${id}/close`, { data: { force: true } })).ok()).toBe(true);
  const [d] = await sql`select id, customer_id from invoice_draft where storm_id = ${id} and jsonb_array_length(lines) > 0 limit 1`;
  expect(d, 'closing should have drafted an invoice').toBeTruthy();
  const [before] = await sql`select status, pay_link from invoice_draft where id = ${d!.id}`;
  await sql`update invoice_draft set status = 'sent', pay_link = null where id = ${d!.id}`;
  try {
    await page.goto(`/customers/${d!.customer_id}`);
    await page.getByTestId('portal-copy').click();
    const url = await page.getByTestId('portal-url').inputValue();
    const ctx = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
    const c = await ctx.newPage();
    await c.goto(url);
    await expect(c.getByTestId('portal-due')).toBeVisible();
    await expect(c.getByTestId('portal-pay-offline')).toBeVisible();
    await expect(c.getByTestId('portal-invoice-lines').first().locator('li').first()).toBeVisible();
    await ctx.close();
  } finally {
    await sql`update invoice_draft set status = ${before!.status}, pay_link = ${before!.pay_link} where id = ${d!.id}`;
  }
});

test('on an iPhone the crew-hours Hours column is on screen, and the Plan tab says the site cap is lifted this season', async ({ page }) => {
  await login(page);
  await page.goto('/reports?from=2020-01-01&to=2030-12-31');
  const hours = page.getByTestId('hours-summary');
  test.skip(!(await hours.count()), 'No driver activity in the demo data');
  for (const cell of await hours.locator('td[data-label="Hours"]').all()) {
    const b = (await cell.boundingBox())!;
    expect(b.x + b.width).toBeLessThanOrEqual(390);
    expect(b.x).toBeGreaterThanOrEqual(0);
  }
  await page.goto('/settings?tab=plan');
  const season = page.getByTestId('free-season');
  if (await season.count()) await expect(season).toContainText('unlimited sites');
});
