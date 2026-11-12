import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { login, sql, startStorm } from './helpers';

/**
 * The office on a phone (issues 40, 41, 44, 46, 47): nothing wider than the screen, Sign out never clipped, the tab
 * bar reachable after a long scroll, every destination in two taps, tables as cards, date pickers that don't overlap,
 * and a storm stop that opens to its photos. Runs at iPhone 13 (390x844) and iPhone SE (375x667) sizes, in Chromium
 * here and in WebKit under the webkit-phone project.
 */
const SIZES = [{ width: 390, height: 844 }, { width: 375, height: 667 }];
const PAGES = ['/dashboard', '/storms', '/customers', '/routes', '/billing', '/proof', '/reports', '/settings', '/settings?tab=system', '/settings?tab=team', '/settings?tab=crew'];

async function fitsTheScreen(page: Page, where: string) {
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  expect(scroll, `${where} scrolls sideways`).toBeLessThanOrEqual(inner);
  const out = await page.getByTestId('sign-out').boundingBox();
  expect(out, `${where}: Sign out`).not.toBeNull();
  expect(out!.x, `${where}: Sign out starts on screen`).toBeGreaterThanOrEqual(0);
  expect(out!.x + out!.width, `${where}: Sign out ends on screen`).toBeLessThanOrEqual(inner);
  await expect(page.getByTestId('tab-bar')).toBeInViewport();
}

for (const size of SIZES) {
  test.describe(`phone ${size.width}x${size.height}`, () => {
    test.use({ viewport: size });
    test.beforeEach(() => test.skip(test.info().project.name === 'pixel-7', 'Pixel width is covered by the other suites'));

    test('every office page fits, and the tab bar stays reachable', async ({ page }) => {
      await login(page);
      for (const path of PAGES) {
        await page.goto(path);
        await fitsTheScreen(page, path);
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await expect(page.getByTestId('tab-bar'), `${path}: tab bar after scrolling`).toBeInViewport();
      }
      // The company name is never cut off mid-word: it wraps instead.
      const name = page.getByTestId('company-name');
      expect(await name.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

      // The four tabs, then More for the rest, each in one or two taps.
      await page.goto('/dashboard');
      await page.getByTestId('tab-bar').getByRole('link', { name: 'Customers' }).click();
      await page.waitForURL(/\/customers$/);
      for (const [label, path] of [['Routes', /\/routes$/], ['Proof', /\/proof$/], ['Reports', /\/reports$/], ['Settings', /\/settings$/]] as const) {
        await page.getByTestId('more-tab').click();
        await expect(page.getByTestId('more-menu')).toBeVisible();
        await page.getByTestId('more-menu').getByRole('link', { name: label }).click();
        await page.waitForURL(path);
        await expect(page.getByTestId('more-menu')).toHaveCount(0);
        await expect(page.getByTestId('more-tab')).toHaveAttribute('aria-expanded', 'false');
      }
      // Escape and a tap outside both close it.
      await page.getByTestId('more-tab').click();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('more-menu')).toHaveCount(0);
    });

    test('every crew action is on screen, with no sideways scroll inside the table (issue 73)', async ({ page }) => {
      await login(page);
      await page.goto('/settings?tab=crew');
      // Nothing to scroll sideways inside the table: scrolling into view would hide exactly that hunt.
      const wrap = page.getByTestId('crew-table').locator('xpath=..');
      expect(await wrap.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
      const buttons = page.getByTestId('crew-table').locator('[data-testid="crew-edit"], [data-testid="crew-reinvite"], [data-testid="crew-remove"]');
      expect(await buttons.count()).toBeGreaterThan(0);
      for (const b of (await buttons.all()).slice(0, 9)) {
        const box = (await b.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(size.width);
      }
    });

    test('customers are cards the whole of which opens the customer', async ({ page }) => {
      await login(page);
      await page.goto('/customers');
      const row = page.getByTestId('customer-row').first();
      const box = (await row.boundingBox())!;
      expect(box.width).toBeLessThanOrEqual(size.width);
      // A tap on the card's right edge, away from the name, still opens it.
      await page.mouse.click(box.x + box.width - 12, box.y + box.height - 8);
      await page.waitForURL(/\/customers\/[0-9a-f-]+$/);
      await expect(page.getByTestId('new-customer')).toHaveCount(0);
    });

    test('Reports and Proof date pickers never overlap, and Open is tappable', async ({ page }) => {
      await login(page);
      await page.goto('/reports');
      const [from, to, show] = await Promise.all([page.locator('#from').boundingBox(), page.locator('#to').boundingBox(), page.getByTestId('period-show').boundingBox()]);
      const apart = (a: typeof from, b: typeof from) => a!.y + a!.height <= b!.y || b!.y + b!.height <= a!.y || a!.x + a!.width <= b!.x || b!.x + b!.width <= a!.x;
      expect(apart(from, to)).toBe(true);
      expect(apart(to, show)).toBe(true);
      expect(apart(from, show)).toBe(true);
      for (const b of [from, to, show]) expect(b!.x + b!.width).toBeLessThanOrEqual(size.width);

      await page.goto('/proof');
      const site = await page.getByTestId('proof-site').inputValue();
      await expect(page.getByTestId('proof-preview')).toBeVisible();
      const made = await page.request.post('/api/proof', { data: { siteId: site, from: new Date(Date.now() - 30 * 86400000).toISOString(), to: new Date().toISOString() } });
      expect(made.status()).toBe(202);
      const { id } = await made.json();
      // The render is a background job; a busy test server can drop a poll, which only means "not yet".
      await expect.poll(async () => (await page.request.get(`/api/proof/${id}`).then((r) => r.json(), () => ({ status: 'retry' }))).status, { timeout: 90000, intervals: [1000] }).toBe('ready');
      await page.reload();
      const open = page.getByTestId('packet-open').first();
      await open.scrollIntoViewIfNeeded();
      await expect(open).toBeInViewport({ ratio: 1 });
    });
  });
}

test('a storm stop opens to its visit and photos, and every truck is on a phone screen', async ({ page, context }, info) => {
  test.skip(info.project.name === 'pixel-7', 'One phone size is enough for this flow');
  await page.setViewportSize({ width: 375, height: 667 });
  await login(page);
  const { id, runs } = await startStorm(page.request, `Phone ${Date.now()}`, ['West Lakewood', 'Rocky River']);
  const run = runs[0]!;
  // The driver finishes the first stop with a before and an after photo, on their own phone.
  const driver = await context.newPage();
  await driver.goto(run.link);
  await driver.getByTestId('arrive').click();
  const jpg = async () => ({ name: 'p.jpg', mimeType: 'image/jpeg', buffer: await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 90, g: 120, b: 160 } } }).withExif({ IFD0: { Model: randomUUID().slice(0, 6) } }).jpeg().toBuffer() });
  await driver.getByTestId('before-photo').setInputFiles(await jpg());
  await driver.getByTestId('depth-3').click();
  await driver.getByTestId('after-photo').setInputFiles(await jpg());
  await expect(driver.getByText('✓ After photo')).toBeVisible();
  await driver.getByTestId('done').click();
  await expect.poll(async () => (await sql`select count(*)::int as n from visit where storm_id = ${id} and departed_device_at is not null`)[0]!.n, { timeout: 60000 }).toBe(1);
  await expect.poll(async () => (await sql`select count(*)::int as n from visit_photo p join visit v on v.id = p.visit_id where v.storm_id = ${id}`)[0]!.n, { timeout: 60000 }).toBe(2);
  await driver.close();

  await page.goto(`/storms/${id}`);
  // Trucks stack full width, with a switcher, not a sideways scroller that hides the second truck.
  await expect(page.getByTestId('truck-switcher')).toBeVisible();
  const cols = page.getByTestId('run-column');
  expect(await cols.count()).toBeGreaterThan(1);
  for (const c of await cols.all()) expect((await c.boundingBox())!.width).toBeLessThanOrEqual(375);
  await fitsTheScreen(page, 'storm board');

  const done = page.locator(`[data-testid="stop-card"][data-status="done"]`).first();
  await expect(done.getByTestId('stop-summary')).toContainText('2 photos');
  await done.getByTestId('stop-open').click();
  const sheet = page.getByTestId('stop-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId('stop-sheet-status')).toHaveText('Done');
  await expect(sheet.getByTestId('stop-sheet-visit')).toContainText('plow');
  await expect(sheet.getByTestId('stop-sheet-photo')).toHaveCount(2);
  // The sheet sits above the tab bar, so its last photo isn't hidden under it.
  const last = sheet.getByTestId('stop-sheet-photo').last();
  await last.scrollIntoViewIfNeeded();
  const lb = (await last.boundingBox())!;
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest('[data-testid="stop-sheet"]') !== null, [lb.x + lb.width / 2, lb.y + lb.height - 4])).toBe(true);
  // The thumbnails really load, through the office's own short-lived link.
  await expect.poll(() => sheet.locator('img').first().evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0), { timeout: 30000 }).toBe(true);
  expect(await sheet.innerHTML()).not.toContain('/d/');
  await page.screenshot({ path: `test-results/phone-stop-sheet-${info.project.name}.png` });
  await sheet.getByTestId('stop-sheet-close').click();
  await expect(sheet).toHaveCount(0);

  // A stop nobody has reached opens too, and says there's nothing yet.
  await page.locator(`[data-testid="stop-card"][data-status="open"]`).first().getByTestId('stop-open').click();
  await expect(page.getByTestId('stop-sheet-no-visits')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('stop-sheet')).toHaveCount(0);
  // A confirm opens at the bottom of a phone, above the tab bar. Playwright's click checks nothing covers the button.
  await page.locator(`[data-testid="stop-card"][data-status="open"]`).first().getByTestId('skip-toggle').click();
  const no = page.getByTestId('confirm-no');
  const nb = (await no.boundingBox())!;
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest('[data-testid="confirm-dialog"]') !== null, [nb.x + nb.width / 2, nb.y + nb.height / 2])).toBe(true);
  await no.click();
  await expect(page.getByTestId('confirm-dialog')).toHaveCount(0);
  await sql`update storm set status = 'closed', closed_at = now() where id = ${id}`;
});
