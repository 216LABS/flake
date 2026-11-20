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
for (const width of [768, 1280]) test(`at ${width} px, trucks are lanes in one row and a second pass is a toggle, not more lanes`, async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width, height: 900 });
  const { id } = await startStorm(page.request, `Columns ${Date.now()}`, ['West Lakewood', 'East Lakewood + Cleveland West', 'Rocky River']);
  expect((await page.request.post(`/api/storms/${id}/pass`)).ok()).toBe(true);
  await page.goto(`/storms/${id}`);
  // Issue 189: the newest pass shows, one lane per truck, all in one row.
  await expect(page.getByTestId('pass-toggle')).toBeVisible();
  await expect(page.getByTestId('truck-lane')).toHaveCount(3);
  await expect(page.getByTestId('run-column')).toHaveCount(3);
  const tops = await page.getByTestId('truck-lane').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);
  // The lanes scroll inside their row; the page itself never scrolls sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  // All: both passes, under their own dividers, still three lanes.
  await page.getByTestId('pass-all').click();
  await expect(page.getByTestId('truck-lane')).toHaveCount(3);
  await expect(page.getByTestId('run-column')).toHaveCount(6);
  await expect(page.getByTestId('pass-divider').first()).toContainText('Pass 1');
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
