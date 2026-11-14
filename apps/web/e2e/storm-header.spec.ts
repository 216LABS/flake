import { expect, test } from '@playwright/test';
import { login, startStorm } from './helpers';

/** Issue 118: on a closed storm the Reopen button sat past the right edge of the dark storm card on a phone. */
test('on a closed storm, the status badge and Reopen fit inside the storm card', async ({ page }) => {
  await login(page);
  const { id } = await startStorm(page.request, `Header fit ${Date.now()}`, ['Rocky River']);
  expect((await page.request.post(`/api/storms/${id}/close`, { data: { force: true } })).ok()).toBe(true);
  await page.goto(`/storms/${id}`);
  const reopen = page.getByTestId('reopen-storm');
  await expect(reopen).toBeVisible();
  const card = reopen.locator('xpath=ancestor::section[1]');
  const [b, c] = await Promise.all([reopen.boundingBox(), card.boundingBox()]);
  expect(b!.x).toBeGreaterThanOrEqual(c!.x);
  expect(b!.x + b!.width).toBeLessThanOrEqual(c!.x + c!.width);
});

/** Issue 124: on a desk, a storm with more trucks than fit wraps them onto more rows, so none sits hidden to the side. */
test('on a desktop, every truck column is in view without scrolling sideways', async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  const { id } = await startStorm(page.request, `Columns ${Date.now()}`, ['West Lakewood', 'East Lakewood + Cleveland West', 'Rocky River']);
  expect((await page.request.post(`/api/storms/${id}/pass`)).ok()).toBe(true);
  await page.goto(`/storms/${id}`);
  await expect(page.getByTestId('run-column')).toHaveCount(6);
  const row = page.getByTestId('run-column').first().locator('xpath=..');
  expect(await row.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  for (const box of await page.getByTestId('run-column').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right))) expect(box).toBeLessThanOrEqual(1280);
  await page.request.post(`/api/storms/${id}/close`, { data: { force: true } });
});
