import { expect, test } from '@playwright/test';
import { login } from './helpers';

/**
 * A storm evening in Ohio is already tomorrow in UTC. Date fields default to the company's own calendar, so a proof
 * packet made at 9 PM doesn't run to a day that hasn't happened.
 */
test('the proof packet defaults to today in the company zone on a storm evening', async ({ page }, info) => {
  test.skip(info.project.name === 'pixel-7', 'One phone size is enough here');
  await page.setViewportSize({ width: 390, height: 844 });
  // 9 PM Eastern on Nov 12, which is 2 AM Nov 13 in UTC. The demo company is in America/New_York.
  await page.clock.setFixedTime(new Date('2026-11-13T02:00:00Z'));
  await login(page);
  await page.goto('/proof');
  await expect(page.locator('#to')).toHaveValue('2026-11-12');
  await expect(page.locator('#from')).toHaveValue('2026-10-01');
});
