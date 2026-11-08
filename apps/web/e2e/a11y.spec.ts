import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { login, startStorm } from './helpers';

const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

/** Anything serious or critical on a screen fails the run, so it can't quietly come back. */
async function expectAccessible(page: Page, name: string) {
  await page.evaluate(axeSource);
  const bad = await page.evaluate(async () => {
    const { violations } = await (window as unknown as { axe: { run: (d: Document, o: object) => Promise<{ violations: { id: string; impact: string | null; nodes: { target: string[] }[] }[] }> } }).axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa'] });
    return violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(', ')}`);
  });
  expect(bad, name).toEqual([]);
}

test('public pages have no serious accessibility problems', async ({ page }) => {
  for (const url of ['/', '/pricing', '/login', '/tools/snow-removal-contract', '/tools/snow-removal-pricing-calculator', '/legal/terms']) {
    await page.goto(url);
    await expectAccessible(page, url);
  }
});

test('office and driver screens have no serious accessibility problems', async ({ page, browser }) => {
  await login(page);
  const { id, runs } = await startStorm(page.request, `Access ${Date.now()}`, ['West Lakewood']);
  for (const url of ['/dashboard', '/storms', `/storms/${id}`, '/customers', '/customers/new', '/routes', '/billing', '/proof', '/reports', '/settings?tab=rate', '/settings?tab=crew', '/settings?tab=team', '/settings?tab=payments', '/settings?tab=system']) {
    await page.goto(url);
    await page.waitForLoadState('networkidle');
    await expectAccessible(page, url);
  }
  const driver = await (await browser.newContext()).newPage();
  await driver.goto(runs[0]!.link);
  await expect(driver.getByTestId('next-stop')).toBeVisible();
  await expectAccessible(driver, 'driver next stop');
  await driver.getByTestId('arrive').click();
  await expect(driver.getByTestId('onsite')).toBeVisible();
  await expectAccessible(driver, 'driver on site');
});
