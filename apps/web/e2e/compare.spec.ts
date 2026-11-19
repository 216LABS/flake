import { expect, test } from '@playwright/test';
import { ROWS } from '../lib/compare';

test.describe('issue 181: /compare', () => {
  test('signed out, wide: the full grid, the footnote, sources, and links in from the header, footer and home page', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await page.getByTestId('home-compare').click();
    await page.waitForURL('**/compare');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Built for snow, not adapted to it.');
    const table = page.getByTestId('compare-table');
    await expect(table).toBeVisible();
    await expect(table.locator('thead th')).toHaveText(['Feature', 'Flake', 'Jobber', 'Yeti', 'Service Autopilot', 'Plowdesk']);
    await expect(table.getByTestId('compare-row')).toHaveCount(ROWS.length);
    // Only Yes carries a check; Unverified never does.
    const unverified = table.locator('[data-testid="compare-cell"][data-value="unverified"]');
    expect(await unverified.count()).toBeGreaterThan(5);
    for (const t of await unverified.allTextContents()) expect(t).not.toContain('✓');
    await expect(table.getByText('CSV export', { exact: true })).toBeVisible();
    await expect(page.getByTestId('compare-footnote')).toContainText('As of November 2026, based on public information.');
    await page.getByTestId('compare-sources').locator('summary').click();
    await expect(page.getByRole('link', { name: 'Charge types' })).toHaveAttribute('href', /support\.yetisoftware\.com/);
    await expect(page.getByTestId('compare-flake-price')).toContainText('Flake is free for the 2026-27 season');
    await expect(page.locator('a[href="/pricing"]')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Start free' }).first()).toHaveAttribute('href', '/login');
    await expect(page.locator('header').getByRole('link', { name: 'Compare' })).toHaveAttribute('href', '/compare');
    await expect(page.locator('footer').getByRole('link', { name: 'Compare' })).toHaveAttribute('href', '/compare');
  });

  test('at 390 px: Flake beside one product at a time, no sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/compare');
    await expect(page.getByTestId('compare-table')).toBeHidden();
    const phone = page.getByTestId('compare-phone');
    await expect(phone.getByTestId('compare-row')).toHaveCount(ROWS.length);
    const noApp = phone.getByTestId('compare-row').filter({ hasText: 'Driver check-in with no app' });
    await expect(noApp).toContainText('Requires the Jobber app');
    await page.getByTestId('compare-pick').getByText('Plowdesk').click();
    await expect(noApp).toContainText('Requires the iPhone/iPad or Android app');
    await expect(noApp).not.toContainText('Jobber');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});
