import { expect, test } from '@playwright/test';
import { login, sql, startStorm } from './helpers';

/** Issue 86: "did Dale get his link?" is on the board, at iPhone 13 and iPhone SE sizes. */
for (const size of [{ width: 390, height: 844 }, { width: 375, height: 667 }]) {
  test(`each truck says whether its driver opened the route, ${size.width} wide`, async ({ page, context }, info) => {
    test.skip(info.project.name === 'pixel-7', 'The iPhone sizes cover this');
    await page.setViewportSize(size);
    await login(page);
    const { id, runs } = await startStorm(page.request, `Opened ${size.width} ${Date.now()}`, ['West Lakewood']);
    const run = runs[0]!;
    await page.goto(`/storms/${id}`);
    const truck = page.getByTestId('run-column').filter({ hasText: run.name });
    await expect(truck.getByTestId('link-opened')).toHaveText('Not opened yet');

    // The driver opens the link on their phone.
    const driver = await context.newPage();
    await driver.setViewportSize(size);
    await driver.goto(run.link);
    await expect(driver.getByTestId('arrive').first()).toBeVisible();
    await driver.close();

    await page.reload();
    await expect(truck.getByTestId('link-opened')).toHaveText(/^Opened \d{1,2}:\d{2} [AP]M$/);
    await sql`update storm set status = 'closed', closed_at = now() where id = ${id}`;
  });
}
