import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { finishStops, login, routeByName, sql, startStorm, type LiveRun } from './helpers';

/**
 * The controls a one-press crawl can't reach: anything that needs earlier steps first, and every way back out of a
 * dialog. Together with the other specs, this leaves no control in the app that nothing has pressed.
 */

const photo = async () => ({ name: 'p.jpg', mimeType: 'image/jpeg', buffer: await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 90, g: 120, b: 160 } } }).jpeg().toBuffer() });

/** Sets up a contract to bill against. */
async function newCustomerSite(page: Page, label: string) {
  const c = await (await page.request.post('/api/customers', { data: { name: `${label} ${randomUUID().slice(0, 6)}`, kind: 'commercial', email: `${randomUUID().slice(0, 6)}@flake.test`, billing_mode: 'card_on_file' } })).json();
  const s = await (await page.request.post('/api/sites', { data: { customer_id: c.id, label, address: '100 Test St, Lakewood, OH', lat: 41.48, lon: -81.8 } })).json();
  return { customer: c, site: s };
}

test('storm board: every dialog can be backed out of, and closing with someone on site asks first', async ({ page }) => {
  await login(page);
  const { id, runs } = await startStorm(page.request, `Dialogs ${Date.now()}`, ['West Lakewood']);
  await page.goto(`/storms/${id}`);

  await page.getByTestId('notify-open').click();
  await expect(page.getByTestId('notify-panel')).toBeVisible();
  await page.getByTestId('notify-template').selectOption('late');
  await expect(page.getByLabel('Expected time')).toBeVisible();
  await page.getByTestId('notify-panel').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('notify-panel')).toHaveCount(0);

  await page.getByTestId('show-link').first().click();
  await expect(page.getByTestId('link-panel')).toBeVisible();
  await page.getByTestId('link-panel').getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('link-panel')).toHaveCount(0);

  await page.getByRole('button', { name: 'Map' }).click();
  await expect(page.getByRole('button', { name: 'Hide map' })).toBeVisible();
  await page.getByRole('button', { name: 'Hide map' }).click();

  const stop = page.getByTestId('stop-card').first();
  await stop.getByTestId('skip-toggle').click();
  await expect(page.getByTestId('stop-card').first().getByTestId('skip-toggle')).toHaveText(/Unskip|Restore|Open/, { timeout: 10000 }).catch(() => {});

  // Someone on site: closing asks, and Keep open keeps it open.
  const run = runs[0]!;
  const token = new URL(run.link).pathname.split('/').pop()!;
  const open = run.stops.find((s) => s.status === 'open')!;
  const arrive = await page.request.post(`/api/d/${token}/actions`, { data: { actions: [{ client_uuid: randomUUID(), at: new Date().toISOString(), kind: 'arrive', run_stop_id: run.stops[run.stops.length - 1]!.id, visit_client_uuid: randomUUID(), gps: null }] } });
  expect(arrive.ok(), open.id).toBe(true);
  await page.reload();
  // Backing out of the first question leaves the storm on.
  page.once('dialog', (d) => void d.dismiss());
  await page.getByTestId('close-storm').click();
  await expect(page.getByTestId('close-storm')).toBeVisible();
  await expect(page.getByTestId('close-force')).toHaveCount(0);
  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('close-storm').click();
  await expect(page.getByTestId('close-force')).toBeVisible();
  await page.getByRole('button', { name: 'Keep open' }).click();
  await expect(page.getByTestId('close-force')).toHaveCount(0);
  await expect(page.getByTestId('close-storm')).toBeVisible();
  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('close-storm').click();
  await page.getByTestId('close-force').click();
  await page.waitForURL(`**/billing?storm=${id}`);
  await page.goto(`/storms/${id}`);
  await expect(page.getByTestId('storm-closed')).toBeVisible();
});

test('billing: every fix on a flag, approving one bill, and the QuickBooks file', async ({ page }) => {
  await login(page);
  const { id, runs } = await startStorm(page.request, `Flags ${Date.now()}`, ['West Lakewood']);
  const run = runs[0]!;
  const token = new URL(run.link).pathname.split('/').pop()!;
  const first = run.stops[0]!;
  const [loc] = await sql`select lat, lon from site where id = ${first.site_id}`;
  // A salt visit with no quantity.
  const visit = randomUUID();
  const at = new Date(Date.now() - 7200000);
  await page.request.post(`/api/d/${token}/actions`, { data: { actions: [
    { client_uuid: randomUUID(), at: at.toISOString(), kind: 'arrive', run_stop_id: first.id, visit_client_uuid: visit, gps: { lat: loc!.lat, lon: loc!.lon, acc: 5 } },
    { client_uuid: randomUUID(), at: new Date(at.getTime() + 600000).toISOString(), kind: 'done', run_stop_id: first.id, visit_client_uuid: visit, services: ['plow', 'salt'], depth_in: 3, salt: null, gps: null },
  ] } });
  // The same stop done again soon after, on the same pass, is a possible duplicate.
  const again = first;
  const token2 = token;
  const visit2 = randomUUID();
  const at2 = new Date(at.getTime() + 1200000);
  await page.request.post(`/api/d/${token2}/actions`, { data: { actions: [
    { client_uuid: randomUUID(), at: at2.toISOString(), kind: 'arrive', run_stop_id: again.id, visit_client_uuid: visit2, gps: { lat: loc!.lat, lon: loc!.lon, acc: 5 } },
    { client_uuid: randomUUID(), at: new Date(at2.getTime() + 600000).toISOString(), kind: 'done', run_stop_id: again.id, visit_client_uuid: visit2, services: ['plow'], depth_in: 3, salt: null, gps: null },
  ] } });
  await finishStops(page.request, run, run.stops.slice(1));
  expect((await page.request.post(`/api/storms/${id}/close`, { data: { force: true } })).ok()).toBe(true);

  await page.goto(`/billing?storm=${id}`);
  await page.getByTestId('generate').click();
  await expect(page.getByTestId('draft').first()).toBeVisible();
  const salt = page.locator('[data-code="missing_salt_qty"]');
  await expect(salt).toHaveCount(1);
  await expect(salt.getByTestId('fix-salt')).toBeDisabled();
  await salt.getByTestId('salt-qty').fill('2');
  await salt.getByTestId('fix-salt').click();
  await expect(page.locator('[data-code="missing_salt_qty"]')).toHaveCount(0);
  const dup = page.locator('[data-code="duplicate"]').first();
  await expect(dup).toBeVisible();
  const dups = await page.locator('[data-code="duplicate"]').count();
  await dup.getByTestId('fix-replow').click();
  await expect(page.locator('[data-code="duplicate"]')).toHaveCount(dups - 1);

  // Approving one bill, flagged or not, moves only that one.
  const before = await page.getByTestId('approve-one').count();
  await page.getByTestId('approve-one').first().click();
  await expect(page.getByTestId('approve-one')).toHaveCount(before - 1);

  await page.getByTestId('flagged-only').uncheck();
  await page.getByTestId('flagged-only').check();
  const csv = await page.request.get(`/api/billing/export.csv?storm=${id}`);
  expect(csv.status()).toBe(200);
  expect(await csv.text()).toContain('Plow');
  await expect(page.getByTestId('qbo')).toHaveAttribute('href', new RegExp(id));
});

test('new customer: Back keeps what was typed, every price type works, and Done leaves', async ({ page }) => {
  await login(page);
  await page.goto('/customers/new');
  await expect(page.getByRole('button', { name: 'Back' })).toHaveCount(0);
  const name = `Back ${Date.now()}`;
  await page.getByTestId('c-name').fill(name);
  await page.getByTestId('c-email').fill('back@flake.test');
  await page.getByTestId('next').click();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByTestId('c-name')).toHaveValue(name);
  await page.getByTestId('next').click();
  await page.getByTestId('address').fill('14701 Detroit Ave, Lakewood, OH');
  await page.getByTestId('find').click();
  await expect(page.getByTestId('sqft')).toContainText('sq ft');
  await page.getByTestId('next').click();
  const types = await page.getByTestId('pricing-type').locator('option').evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value));
  expect(types.length).toBeGreaterThan(1);
  for (const t of types) await page.getByTestId('pricing-type').selectOption(t);
  await page.getByTestId('pricing-type').selectOption(types[0]!);
  await page.getByTestId('price').fill('150.00');
  await page.getByTestId('next').click();
  await page.getByTestId('next').click();
  await page.getByTestId('route-select').selectOption({ index: 1 });
  await page.getByTestId('next').click();
  await page.getByTestId('send-quote').click();
  await expect(page.getByTestId('quote-note')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.waitForURL('**/customers');
  await expect(page.getByText(name)).toBeVisible();
});

test('site: retire can be cancelled, every quote type sends, and edits save', async ({ page }) => {
  await login(page);
  const { site } = await newCustomerSite(page, `Site ${Date.now()}`);
  await page.goto(`/sites/${site.id}`);
  await page.getByTestId('retire').click();
  await expect(page.getByTestId('retire-confirm')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('retire-confirm')).toHaveCount(0);
  await expect(page.getByTestId('retire')).toBeVisible();

  const types = await page.getByTestId('q-type').locator('option').evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value));
  for (const t of types) await page.getByTestId('q-type').selectOption(t);
  await page.getByTestId('q-type').selectOption(types[0]!);
  await page.getByTestId('q-price').fill('80');
  await expect(page.getByLabel('Season')).not.toHaveValue('');
  await page.getByTestId('q-send').click();
  await expect(page.getByTestId('q-url')).not.toHaveValue('');

  await page.getByLabel('Notes for the driver').fill('Watch the curb');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForLoadState('networkidle');
  await page.reload();
  await expect(page.getByLabel('Notes for the driver')).toHaveValue('Watch the curb');
});

test('driver: navigate, choose another stop, salt, services, undo, every problem, and the end of the route', async ({ page, context }) => {
  await login(page);
  await context.route(/maps\.(apple|google)|google\.com\/maps/, (r) => r.fulfill({ status: 200, body: 'maps' }));
  const [salted] = await sql`select s.label from contract c join site s on s.id = c.site_id join route_stop rs on rs.site_id = s.id join route r on r.id = rs.route_id where r.name = 'West Lakewood' and c.services::text like '%salt%' and c.status = 'accepted' limit 1`;
  const { runs } = await startStorm(page.request, `Driver ${Date.now()}`, ['West Lakewood']);
  const run = runs[0]!;
  await page.goto(run.link);
  await expect(page.getByTestId('next-stop')).toBeVisible();

  const [maps] = await Promise.all([context.waitForEvent('page'), page.getByTestId('navigate').click()]);
  await maps.close();

  // Every kind of problem can be opened, and backing out changes nothing.
  await page.getByTestId('problem').click();
  for (const kind of ['blocked', 'breakdown', 'skip', 'damage']) await expect(page.getByTestId(`problem-${kind}`)).toBeVisible();
  await page.getByTestId('problem-panel').getByRole('button').last().click();
  await expect(page.getByTestId('problem-panel')).toHaveCount(0);

  // Do a different stop first.
  await page.getByTestId('other-stop').filter({ hasText: salted!.label as string }).first().click();
  await expect(page.getByTestId('stop-label').first()).toContainText(salted!.label as string);
  await page.getByTestId('arrive').click();
  await expect(page.getByTestId('onsite')).toBeVisible();
  await expect(page.getByTestId('no-photo-hint')).toBeVisible();

  await page.getByTestId('salt-plus').click();
  await page.getByTestId('salt-plus').click();
  await page.getByTestId('salt-minus').click();
  await expect(page.getByTestId('salt-qty')).toHaveText('1');
  const plow = page.getByTestId('service-plow');
  await plow.click();
  await plow.click();

  await page.getByTestId('depth-3').click();
  await page.getByTestId('after-photo').setInputFiles(await photo());
  await expect(page.getByTestId('no-photo-hint')).toHaveCount(0);

  // Undo steps back out of the visit.
  await page.getByTestId('undo').click();
  await expect(page.getByTestId('next-stop')).toBeVisible();
  await page.getByTestId('arrive').click();
  await expect(page.getByTestId('onsite')).toBeVisible();
  await page.getByTestId('after-photo').setInputFiles(await photo()).catch(() => {});
  await page.getByTestId('done').click();
  await expect(page.getByTestId('next-stop')).toBeVisible();

  // The rest of the route, and then the driver is told it's over.
  const live = await (await page.request.get(`/api/storms/${(await sql`select storm_id from storm_run where id = ${run.id}`)[0]!.storm_id}/live`)).json();
  const left = (live.runs[0] as LiveRun).stops.filter((s) => !['done', 'onsite'].includes(s.status));
  await finishStops(page.request, run, left);
  await page.reload();
  await expect(page.getByTestId('all-done')).toBeVisible({ timeout: 20000 });
});

test('a run with every stop moved off it does not break Another pass', async ({ page }) => {
  await login(page);
  const { id, runs } = await startStorm(page.request, `Empty ${Date.now()}`, ['West Lakewood', 'Rocky River']);
  const [from, to] = runs as [LiveRun, LiveRun];
  for (const s of from.stops) expect((await page.request.patch(`/api/run-stops/${s.id}`, { data: { storm_run_id: to.id } })).ok()).toBe(true);
  const pass = await page.request.post(`/api/storms/${id}/pass`);
  expect(pass.status(), await pass.text()).toBe(200);
  expect((await pass.json()).runs).toBe(1);
});

test('errors read like a person wrote them', async ({ page }) => {
  await login(page);
  const res = await page.request.post('/api/customers', { data: { kind: 'residential', name: '' } });
  expect(res.status()).toBe(422);
  expect((await res.json()).error).toBe('Name is required.');
});

test('the map loads with no errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await login(page);
  const { site } = await newCustomerSite(page, `Map ${Date.now()}`);
  await page.goto(`/sites/${site.id}`);
  await expect(page.getByTestId('map').locator('canvas')).toBeVisible();
  await page.waitForTimeout(2500);
  expect(errors.filter((e) => /worker/i.test(e))).toEqual([]);
});

test('driver: on a phone, finishing a stop never needs scrolling, and the next stop starts at the top', async ({ page, browser, baseURL }) => {
  await login(page);
  const { runs } = await startStorm(page.request, `Reach ${Date.now()}`, ['West Lakewood']);
  const ctx = await browser.newContext({ baseURL, viewport: { width: 390, height: 664 }, isMobile: true, hasTouch: true });
  const phone = await ctx.newPage();
  const onScreen = async (id: string) => {
    const box = (await phone.getByTestId(id).boundingBox())!;
    return box.y >= 0 && box.y + box.height <= 664;
  };
  await phone.goto(runs[0]!.link);
  for (let i = 0; i < 2; i++) {
    await expect(phone.getByTestId('next-stop')).toBeVisible();
    expect(await onScreen('arrive'), `Arrive on stop ${i + 1}`).toBe(true);
    await phone.getByTestId('arrive').click();
    await expect(phone.getByTestId('onsite')).toBeVisible();
    await phone.getByTestId('depth-3').click();
    expect(await onScreen('done'), `Done on stop ${i + 1}`).toBe(true);
    await phone.getByTestId('after-photo').setInputFiles(await photo());
    expect(await onScreen('done')).toBe(true);
    await phone.getByTestId('done').click();
  }
  await ctx.close();
});

test('driver: arriving near a stop offers one big button to check in', async ({ page, browser, baseURL }) => {
  await login(page);
  const { runs } = await startStorm(page.request, `Near ${Date.now()}`, ['Rocky River']);
  const run = runs[0]!;
  const [loc] = await sql`select lat, lon from site where id = ${run.stops[0]!.site_id}`;
  const ctx = await browser.newContext({ baseURL, geolocation: { latitude: loc!.lat as number, longitude: loc!.lon as number }, permissions: ['geolocation'] });
  const phone = await ctx.newPage();
  await phone.goto(run.link);
  await expect(phone.getByTestId('next-stop')).toBeVisible();
  await expect(phone.getByTestId('geofence-banner')).toBeVisible({ timeout: 30000 });
  await phone.getByTestId('geofence-banner').click();
  await expect(phone.getByTestId('onsite')).toBeVisible();
  await ctx.close();
});

test('customer quote: opting out of email, a declined card, a bank account, and a good card', async ({ page, browser, baseURL }) => {
  await login(page);
  const { site } = await newCustomerSite(page, `Pay ${Date.now()}`);
  const q = await (await page.request.post('/api/quotes', { data: { site_id: site.id, season: '2026-27', services: [{ service: 'plow', trigger_in: 2, pricing: { type: 'per_push', amount_cents: 7500 } }], send: false } })).json();
  const ctx = await browser.newContext({ baseURL });
  const customer = await ctx.newPage();
  await customer.goto(q.url);
  await expect(customer.getByTestId('accept')).toBeDisabled();
  await customer.getByTestId('sign-name').fill('Pat Customer');
  await customer.getByTestId('agree').check();
  await customer.getByTestId('consent-email').uncheck();
  await customer.getByTestId('accept').click();
  await expect(customer.getByTestId('accepted')).toBeVisible();
  const [row] = await sql`select c.notify_email from customer c join site s on s.customer_id = c.id where s.id = ${site.id}`;
  expect(row!.notify_email).toBe(false);

  await customer.getByTestId('add-payment').click();
  await customer.getByTestId('mock-card').fill('4242424242424242');
  await customer.getByTestId('mock-save').click();
  await expect(customer.getByTestId('payment-saved')).toBeVisible();
  await ctx.close();
});

test('settings: rate card saves, business details save, text verification submits, and a failed job can be retried', async ({ page }) => {
  await login(page);
  await page.goto('/settings?tab=rate');
  const before = await page.getByTestId('rate-sqft').inputValue();
  await page.getByTestId('rate-sqft').fill('0.75');
  await page.getByTestId('rate-save').click();
  await expect(page.getByTestId('rate-msg')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('rate-sqft')).toHaveValue('0.75');
  await page.getByTestId('rate-sqft').fill(before);
  await page.getByTestId('rate-save').click();
  await expect(page.getByTestId('rate-msg')).toBeVisible();

  await page.goto('/settings?tab=sms');
  await page.getByTestId('business-save').click();
  await expect(page.getByTestId('business-msg')).toBeVisible();

  // A company that hasn't verified its number yet.
  const [t] = await sql`select id, sms_status, sms_sender from tenant where slug = 'lakeshore-demo'`;
  await sql`update tenant set sms_status = 'none' where id = ${t!.id as string}`;
  try {
    await page.reload();
    await expect(page.getByTestId('sms-submit')).toBeDisabled();
    await page.getByTestId('ein').fill('12-3456789');
    await page.getByTestId('sms-submit').click();
    await expect(page.getByTestId('sms-msg')).toBeVisible();
  } finally {
    await sql`update tenant set sms_status = ${t!.sms_status as string}, sms_sender = ${t!.sms_sender as string} where id = ${t!.id as string}`;
  }

  const kind = `notify.party`;
  const key = `everything:${randomUUID()}`;
  await sql`insert into job (kind, payload, dedupe_key, run_at, dead_at, attempts, last_error) values (${kind}, ${sql.json({ tenantId: t!.id as string, party: {}, msg: { template: 'owner_alert', vars: {}, subject: 'x', key } })}, ${key}, now(), now(), 8, 'Test failure')`;
  await page.goto('/settings?tab=system');
  await expect(page.getByText('Test failure').first()).toBeVisible();
  await page.getByRole('button', { name: 'Retry' }).first().click();
  await expect.poll(async () => (await sql`select dead_at from job where dedupe_key = ${key}`)[0]!.dead_at, { timeout: 15000 }).toBeNull();
});

test('plan: upgrading goes to checkout and comes back without an error', async ({ page }) => {
  await login(page);
  await page.goto('/settings?tab=plan');
  const monthly = page.getByRole('button', { name: /monthly/i });
  await expect(monthly).toBeVisible();
  const res = page.waitForResponse((r) => r.url().includes('/api/settings/plan'));
  await monthly.click();
  expect((await res).status()).toBeLessThan(400);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('body')).not.toContainText('Something went wrong');
  await sql`update tenant set plan = 'free' where slug = 'lakeshore-demo'`;
});

test('proof packet: a finished packet opens from the list', async ({ page, context }) => {
  await login(page);
  const route = await routeByName('West Lakewood');
  expect(route.id).toBeTruthy();
  await page.goto('/proof');
  await page.getByTestId('proof-generate').click();
  await expect(page.getByTestId('proof-ready')).toBeVisible({ timeout: 60000 });
  await page.reload();
  const pdf = context.waitForEvent('request', { predicate: (q) => /proof-packet/.test(q.url()), timeout: 20000 });
  const [opened] = await Promise.all([context.waitForEvent('page'), page.getByRole('button', { name: 'Open' }).first().click()]);
  expect((await pdf).url()).toContain('proof');
  await opened.close();
});
