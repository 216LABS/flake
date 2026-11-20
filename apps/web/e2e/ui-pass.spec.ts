import { expect, test, type Locator, type Page } from '@playwright/test';
import { closeRunningStorms, login, startStorm } from './helpers';

/** Flip's UI pass (issues 187, 188, 190, 199): the live storm up front, a dashboard that explains itself, drag to reorder. */

const navLive = (page: Page) => page.locator('[data-testid="nav-live"]:visible');

test('a live storm is pinned to the top of Storms and the Dashboard, and Storms says Live in the nav', async ({ page }) => {
  await login(page);
  await closeRunningStorms();
  await page.goto('/dashboard');
  await expect(navLive(page)).toHaveCount(0);
  await expect(page.getByTestId('live-banner')).toHaveCount(0);

  const name = `Live ${Date.now()}`;
  const { id } = await startStorm(page.request, name, ['Rocky River']);
  try {
    await page.goto('/storms');
    const banner = page.getByTestId('live-banner');
    await expect(banner).toContainText(name);
    await expect(banner.getByTestId('storm-progress')).toContainText(/0 of \d+ stops done/);
    await expect(banner.getByTestId('live-facts')).toContainText('1 truck out');
    await expect(page.getByTestId('storms-live')).toContainText(name);
    // Past storms are one section, folded while a storm is live, and open with one tap (issue 187).
    const past = page.getByTestId('storms-past');
    if (await past.count()) {
      expect(await past.evaluate((d) => (d as HTMLDetailsElement).open)).toBe(false);
      await expect(page.getByTestId('storms-to-bill').or(page.getByTestId('storms-billed')).first()).toBeHidden();
      await page.getByTestId('storms-past-toggle').click();
      await expect(page.getByTestId('storms-to-bill').or(page.getByTestId('storms-billed')).first()).toBeVisible();
    }
    await expect(navLive(page)).toHaveCount(1);

    await page.goto('/dashboard');
    // First thing on the page after the header, above the forecast.
    const top = async (l: Locator) => (await l.boundingBox())!.y;
    await expect(page.getByTestId('live-banner')).toBeVisible();
    expect(await top(page.getByTestId('live-banner'))).toBeLessThan(await top(page.getByTestId('conditions')));
    await page.getByTestId('live-banner').getByTestId('open-board').click();
    await expect(page).toHaveURL(new RegExp(`/storms/${id}`));
  } finally {
    await closeRunningStorms();
  }
  await page.goto('/storms');
  await expect(navLive(page)).toHaveCount(0);
});

test('the dashboard keeps unsigned quotes and money owed apart, each with one button', async ({ page }) => {
  await login(page);
  await page.goto('/dashboard');
  const quotes = page.getByTestId('quotes-waiting');
  if (await quotes.count()) {
    await expect(quotes).toContainText('Quotes not signed yet');
    await expect(quotes.getByRole('link', { name: 'See unsigned quotes' })).toBeVisible();
  }
  const owed = page.getByTestId('owed-total');
  if (await owed.count()) {
    await expect(owed).toContainText('Money owed to you');
    await expect(owed.getByRole('link', { name: 'Open receivables' })).toBeVisible();
  }
  await expect(page.getByText('No snow alerts', { exact: false }).or(page.getByTestId('alert-review').first())).toBeVisible();
});

test('a lot on a route can be dragged to the top, and a removed lot can be put back', async ({ page }) => {
  await login(page);
  await page.goto('/routes');
  const card = page.getByTestId('route-card').filter({ has: page.getByTestId('route-stop').nth(2) }).first();
  const labels = async () => (await card.getByTestId('route-stop').allInnerTexts()).map((t) => t.replace(/^\d+\.?\s*/, '').split('\n')[0]!.replace(/Move to$/, '').trim());
  const start = await labels();
  const save = () => page.waitForResponse((r) => r.url().includes('/api/routes/') && r.request().method() === 'PATCH');
  try {
    // Drag the third lot by its grip above the first.
    const grip = card.getByTestId('route-grip').nth(2);
    // Both ends of the drag on screen before measuring, on a short phone too.
    await card.getByTestId('route-stop').first().scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, 120);
    await grip.scrollIntoViewIfNeeded();
    const first = (await card.getByTestId('route-stop').first().boundingBox())!;
    const g = (await grip.boundingBox())!;
    const saved = save();
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await page.mouse.down();
    await page.mouse.move(g.x + g.width / 2, first.y + 4, { steps: 8 });
    await page.mouse.up();
    await saved;
    await expect.poll(labels).toEqual([start[2], start[0], start[1], ...start.slice(3)]);
    await page.reload();
    await expect.poll(labels).toEqual([start[2], start[0], start[1], ...start.slice(3)]);

    // Remove the top lot, then undo: it goes back where it was.
    const removed = save();
    await card.getByTestId('route-remove').first().click();
    await removed;
    await expect(card.getByTestId('route-remove-undo-bar')).toContainText(`Removed ${start[2]}`);
    const back = save();
    await card.getByTestId('route-remove-undo').click();
    await back;
    await expect.poll(labels).toEqual([start[2], start[0], start[1], ...start.slice(3)]);
  } finally {
    // Put the route back as it was, with the keyboard this time: Space lifts, arrows move, Space drops.
    await page.reload();
    if ((await labels())[0] === start[2]) {
      const grip = card.getByTestId('route-grip').first();
      await grip.focus();
      await page.keyboard.press('Space');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Space');
      await expect.poll(labels).toEqual(start);
      await page.waitForTimeout(500);
    }
  }
});

test('on a phone, a lot on a route moves by a finger drag on its 44 px grip (issue 190)', async ({ page, browserName }, info) => {
  test.skip(browserName !== 'chromium' || !info.project.use.hasTouch, 'Real touch events need a touch Chromium phone');
  await login(page);
  await page.goto('/routes');
  const card = page.getByTestId('route-card').filter({ has: page.getByTestId('route-stop').nth(2) }).first();
  const labels = async () => (await card.getByTestId('route-stop').allInnerTexts()).map((t) => t.replace(/^\d+\.?\s*/, '').split('\n')[0]!.replace(/Move to$/, '').trim());
  const start = await labels();
  const grip = card.getByTestId('route-grip').nth(1);
  await card.getByTestId('route-stop').first().scrollIntoViewIfNeeded();
  await grip.scrollIntoViewIfNeeded();
  const g = (await grip.boundingBox())!;
  expect(g.height).toBeGreaterThanOrEqual(44);
  const first = (await card.getByTestId('route-stop').first().boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const x = g.x + g.width / 2;
  const saved = page.waitForResponse((r) => r.url().includes('/api/routes/') && r.request().method() === 'PATCH');
  try {
    await touch('touchStart', x, g.y + g.height / 2);
    for (let i = 1; i <= 10; i++) await touch('touchMove', x, g.y + g.height / 2 + ((first.y + 4) - (g.y + g.height / 2)) * (i / 10));
    await touch('touchEnd', x, first.y + 4);
    await saved;
    await expect.poll(labels).toEqual([start[1], start[0], ...start.slice(2)]);
  } finally {
    await page.reload();
    if ((await labels())[0] === start[1]) {
      await card.getByTestId('route-grip').first().focus();
      await page.keyboard.press('Space');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Space');
      await expect.poll(labels).toEqual(start);
      await page.waitForTimeout(500);
    }
  }
});

test('Payroll and Profit are tabs on Reports, not sentences', async ({ page }) => {
  await login(page);
  await page.goto('/reports');
  await page.getByTestId('open-payroll').click();
  await expect(page).toHaveURL(/\/reports\/payroll/);
  await expect(page.getByTestId('open-payroll')).toHaveAttribute('aria-current', 'page');
  await page.getByTestId('open-profit').click();
  await expect(page).toHaveURL(/\/reports\/profit/);
  await page.getByTestId('reports-tab-overview').click();
  await expect(page).toHaveURL(/\/reports$/);
});
