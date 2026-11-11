import { expect, test } from '@playwright/test';
import { closeRunningStorms, finishStops, login, sql, startStorm } from './helpers';

/** Uses each office screen the way a person would, and fails on any page error or 5xx along the way. */
test('walk every office screen and use its main control', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror ${page.url()}: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 500) problems.push(`${r.status()} ${r.url()}`);
    // A missing icon or script shows as a console error on every office page (issue 39). API 404s are answers, not errors.
    const url = new URL(r.url());
    if (r.status() === 404 && url.origin === new URL(page.url()).origin && !url.pathname.startsWith('/api/')) problems.push(`404 ${url.pathname}`);
  });
  await login(page);
  await closeRunningStorms();

  // An earlier device's run may have left a walk route with a driver-less default.
  await sql`update route set default_crew_id = (select id from crew_member where email = 'dale@flake.test') where name like 'Walk route%'`;

  // Storms: create one by hand from the master routes, then publish and show the QR.
  const name = `Walk ${Date.now()}`;
  await page.goto('/storms');
  await page.getByTestId('storm-name').fill(name);
  await page.getByTestId('create-storm').click();
  await page.waitForURL(/\/storms\/[0-9a-f-]+$/);
  const stormId = page.url().split('/').pop()!;
  await expect(page.getByTestId('run-column').nth(2)).toBeVisible();
  await page.getByTestId('publish').click();
  await expect(page.getByTestId('publish')).toHaveCount(0);
  await page.getByTestId('show-link').first().click();
  await expect(page.getByTestId('run-link')).toHaveValue(/\/d\//);
  await expect(page.getByAltText(/QR code/)).toBeVisible();
  await page.getByRole('button', { name: 'Map' }).click();
  await expect(page.getByTestId('map')).toBeVisible();
  await page.getByTestId('callout-time').fill('4:00 AM');
  await page.getByTestId('callout-send').click();
  await expect(page.getByTestId('callout-sent')).toContainText('Asked');
  await page.screenshot({ path: `test-results/walk-board-${test.info().project.name}.png`, fullPage: true });
  await page.getByRole('link', { name: 'Sub pay' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Sub pay');

  // Customers, then a site: edit and save it, then drop a pin.
  await page.goto('/customers');
  await page.getByRole('link', { name: /Madison Ave Retail Lot/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Madison Ave Retail Lot');
  await page.getByRole('link', { name: 'Madison Ave Retail Lot', exact: true }).click();
  await page.waitForURL(/\/sites\//);
  await page.getByLabel('Notes for the driver').fill('Pile snow at the back of the lot. Watch the curb.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Notes for the driver')).toHaveValue(/Watch the curb/);
  await expect(page.getByRole('link', { name: 'Proof packet' })).toBeVisible();

  // Routes: the master list reorders and saves.
  await page.goto('/routes');
  await expect(page.getByTestId('route-card').first()).toBeVisible();
  const routeName = `Walk route ${Date.now()}`;
  await page.getByLabel('New route').fill(routeName);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByLabel(`Add a site to ${routeName}`)).toBeVisible();
  await page.getByLabel(`Add a site to ${routeName}`).selectOption({ index: 1 });
  // An earlier device's walk may have put this lot on its own route, and then the app asks first.
  if (await page.getByTestId('confirm-dialog').isVisible({ timeout: 2000 }).catch(() => false)) await page.getByTestId('confirm-yes').click();
  await expect.poll(async () => (await sql`select count(*)::int as n from route_stop rs join route r on r.id = rs.route_id where r.name = ${routeName}`)[0]!.n).toBe(1);

  // A route with no default driver: Publish refuses and says why, and the board can fix it.
  const [newRoute] = await sql`select id from route where name = ${routeName}`;
  // The lot may be live on the walk's own storm, and a lot is on one running storm at a time (issue 24).
  await closeRunningStorms();
  const made = await page.request.post('/api/storms', { data: { name: `No driver ${Date.now()}`, routeIds: [newRoute!.id] } });
  expect(made.status(), await made.text()).toBe(201);
  const noDriver = await made.json();
  await page.goto(`/storms/${noDriver.id}`);
  await page.getByTestId('publish').click();
  await expect(page.getByText('have no driver. Assign one first.')).toBeVisible();
  await page.getByTestId('assign-driver').selectOption({ index: 1 });
  await expect(page.getByTestId('run-column')).not.toContainText('No driver');
  await page.getByTestId('publish').click();
  await expect(page.getByTestId('publish')).toHaveCount(0);
  await expect(page.getByTestId('show-link')).toBeVisible();

  // Dev tools: every page answers and shows real content.
  await page.goto('/dev');
  await expect(page.getByText('Open as a driver')).toBeVisible();
  await page.goto('/dev/inbox');
  await page.getByRole('button', { name: 'HELP' }).click();
  await expect(page.getByText(/handled as help/)).toBeVisible();
  await page.goto('/dev/weather');
  await expect(page.getByTestId('clock')).toBeVisible();

  // Every settings tab and the public business pages.
  for (const tab of ['rate', 'crew', 'payments', 'sms', 'plan', 'data', 'system']) {
    await page.goto(`/settings?tab=${tab}`);
    await expect(page.getByTestId(`tab-${tab}`)).toBeVisible();
  }
  const exported = await page.request.get('/api/settings/export?table=customer');
  expect(await exported.text()).toContain('billing_mode');
  expect(await (await page.request.get('/api/settings/export?table=storm_run')).text()).not.toContain('link_token');
  await page.goto('/settings?tab=system');
  await expect(page.getByTestId('usage')).toContainText('of 1024 MB');
  await expect(page.getByTestId('message-row').first()).toBeVisible();
  await expect(page.getByTestId('test-badge')).toBeVisible();
  await page.goto('/b/lakeshore-demo');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Lakeshore');
  await page.goto('/b/lakeshore-demo/sms');
  await expect(page.getByText('Reply STOP to opt out').first()).toBeVisible();

  // Billing on the seeded historical storm: the three demo flags show up.
  await page.goto('/billing');
  await page.getByTestId('storm-picker').selectOption({ label: 'Dec 13 Lake-Effect Storm (Demo)' });
  await page.waitForURL(/billing\?storm=/);
  for (const code of ['missing_visit', 'no_after_photo', 'missing_salt_qty']) await expect(page.locator(`[data-code="${code}"]`)).toHaveCount(1);
  await page.screenshot({ path: `test-results/walk-billing-${test.info().project.name}.png`, fullPage: true });

  // A site's proof packet page lists the seeded packet.
  await page.goto('/proof');
  await expect(page.locator('td', { hasText: 'Madison Ave Retail Lot' }).first()).toBeVisible();

  // Sub pay shows real amounts once a sub has done work.
  const { id, runs } = await startStorm(page.request, `Sub ${Date.now()}`, ['Rocky River']);
  await sql`update storm_run set crew_id = (select id from crew_member where email = 'sub@flake.test') where id = ${runs[0]!.id}`;
  await finishStops(page.request, runs[0]!, runs[0]!.stops.slice(0, 1));
  await page.goto(`/storms/${id}/pay`);
  await expect(page.getByTestId('sub-statement')).toContainText('$');

  await page.goto('/dashboard');
  await page.screenshot({ path: `test-results/walk-dashboard-${test.info().project.name}.png`, fullPage: true });
  await page.goto(`/storms/${stormId}`);
  await expect(page.getByTestId('counts')).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'the board should not push the page sideways').toBeLessThanOrEqual(1);
  expect(problems).toEqual([]);
});

test('no office page scrolls sideways on a phone', async ({ page }) => {
  await login(page);
  for (const path of ['/dashboard', '/storms', '/customers', '/customers/new', '/routes', '/billing', '/proof', '/reports', '/settings?tab=crew', '/settings?tab=system']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBeLessThanOrEqual(1);
  }
});
