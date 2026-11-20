import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

/** Issue 186: a round report button in the corner of every office screen, never on top of anything you need. */
const PAGES = ['/dashboard', '/storms', '/customers', '/billing', '/receivables', '/settings', '/reports', '/help'];

async function coversNothing(page: Page) {
  // At the very end of the page, nothing a person can use sits under the button.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(150);
  return page.evaluate(() => {
    const btn = document.querySelector('[data-testid="feedback-open"]')!.getBoundingClientRect();
    const hit: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('main a, main button, main input, main select, main textarea, main [role="button"]')) {
      if (el.closest('[data-testid="feedback-open"], #feedback')) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.left < btn.right && r.right > btn.left && r.top < btn.bottom && r.bottom > btn.top) hit.push(el.outerHTML.slice(0, 80));
    }
    return hit;
  });
}

for (const size of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  test(`the report button is in the corner on every office page and covers nothing, ${size.width} wide`, async ({ page }) => {
    await page.setViewportSize(size);
    await login(page);
    for (const path of PAGES) {
      await page.goto(path);
      const btn = page.getByTestId('feedback-open');
      await expect(btn, path).toBeInViewport();
      await expect(btn).toHaveAccessibleName('Report a problem');
      expect(await coversNothing(page), path).toEqual([]);
    }
  });
}

test('the card opens with focus in it, Esc or Cancel closes it and focus returns', async ({ page }) => {
  await login(page);
  await page.goto('/customers');
  const btn = page.getByTestId('feedback-open');
  await btn.click();
  await expect(page.getByTestId('feedback-message')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('feedback')).toBeHidden();
  await expect(btn).toBeFocused();
  // Sending through it is covered in sweep-nov15 (feedback goes to the Flake team), under the 5-per-10-minutes limit.
  await btn.click();
  await page.getByTestId('feedback').getByRole('button', { name: 'Cancel' }).click();
  await expect(btn).toBeFocused();
});

test('not on the driver page, customer pages or the marketing site', async ({ page }) => {
  for (const path of ['/', '/compare', '/free-season']) {
    await page.goto(path);
    await expect(page.getByTestId('feedback-open'), path).toHaveCount(0);
  }
  await login(page);
  await page.goto('/d/not-a-real-link');
  await expect(page.getByTestId('feedback-open')).toHaveCount(0);
});
