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
