import { expect, test, type Locator, type Page } from '@playwright/test';
import { closeRunningStorms, login, startStorm } from './helpers';

/**
 * Every dialog, sheet and menu behaves the same way for a keyboard: focus moves in, Tab can't wander to the page
 * behind, Escape closes, and focus lands back on the button that opened it. A dangerous question starts on Cancel.
 */

const SIZES = [{ width: 390, height: 844 }, { width: 375, height: 667 }];

const focused = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.textContent?.trim() ?? '');
const inside = (box: Locator) => box.evaluate((el) => el.contains(document.activeElement));

async function tabStaysIn(page: Page, box: Locator) {
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    expect(await inside(box), `Tab ${i + 1} left the dialog`).toBe(true);
  }
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Shift+Tab');
    expect(await inside(box), `Shift+Tab ${i + 1} left the dialog`).toBe(true);
  }
}

for (const size of SIZES) {
  test(`dialogs keep focus and give it back at ${size.width} wide`, async ({ page }) => {
    await page.setViewportSize(size);
    await login(page);

    // A dangerous confirm: starts on Cancel, so Enter backs out.
    await page.goto('/routes');
    const archive = page.getByTestId('route-archive').first();
    await archive.focus();
    await page.keyboard.press('Enter');
    const confirm = page.getByTestId('confirm-dialog');
    await expect(confirm).toBeVisible();
    expect(await focused(page)).toBe('confirm-no');
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
    await tabStaysIn(page, confirm);
    await page.keyboard.press('Escape');
    await expect(confirm).toHaveCount(0);
    expect(await focused(page)).toBe('route-archive');
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
    await archive.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('confirm-no')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(confirm).toHaveCount(0);
    await expect(archive).toBeVisible();

    // The More menu on the phone tab bar.
    await page.getByTestId('more-tab').click();
    const menu = page.getByTestId('more-menu');
    await expect(menu).toBeVisible();
    expect(await inside(menu)).toBe(true);
    await tabStaysIn(page, menu);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    expect(await focused(page)).toBe('more-tab');

    // A stop's sheet on the storm board.
    const { id } = await startStorm(page.request, `Dialogs ${size.width} ${Date.now()}`, ['West Lakewood']);
    await page.goto(`/storms/${id}`);
    const open = page.getByTestId('stop-open').first();
    await open.focus();
    await page.keyboard.press('Enter');
    const sheet = page.getByTestId('stop-sheet');
    await expect(sheet).toBeVisible();
    expect(await focused(page)).toBe('stop-sheet-close');
    await tabStaysIn(page, sheet);
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    expect(await focused(page)).toBe('stop-open');

    // The storm header is near black, so its buttons' focus ring is white, not the dark ring used on white pages.
    const map = page.getByRole('button', { name: 'Map' });
    await map.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(map).toBeFocused();
    // Polled: buttons fade their colors in, the ring included.
    await expect.poll(() => map.evaluate((el) => getComputedStyle(el).outlineColor)).toBe('rgb(255, 255, 255)');
    await closeRunningStorms();
  });
}
