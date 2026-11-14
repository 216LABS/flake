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
for (const width of [768, 1280]) test(`at ${width} px, every truck column is in view without scrolling sideways`, async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width, height: 900 });
  const { id } = await startStorm(page.request, `Columns ${Date.now()}`, ['West Lakewood', 'East Lakewood + Cleveland West', 'Rocky River']);
  expect((await page.request.post(`/api/storms/${id}/pass`)).ok()).toBe(true);
  await page.goto(`/storms/${id}`);
  await expect(page.getByTestId('run-column')).toHaveCount(6);
  const row = page.getByTestId('run-column').first().locator('xpath=..');
  expect(await row.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  for (const box of await page.getByTestId('run-column').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right))) expect(box).toBeLessThanOrEqual(width);
  await page.request.post(`/api/storms/${id}/close`, { data: { force: true } });
});

/** Issue 128: on a tablet, Settings is the section picker, so no tab hides off the edge; on a desk every tab shows. */
test('Settings shows every section at tablet and desk widths', async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto('/settings');
  await expect(page.getByTestId('settings-section')).toBeVisible();
  await expect(page.getByTestId('settings-tabs')).toBeHidden();
  await page.setViewportSize({ width: 1024, height: 800 });
  const tabs = page.getByTestId('settings-tabs');
  await expect(tabs).toBeVisible();
  const box = (await tabs.boundingBox())!;
  for (const r of await tabs.getByRole('link').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right))) expect(r).toBeLessThanOrEqual(box.x + box.width + 1);
});
