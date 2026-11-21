import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { login, sql } from './helpers';

/** Issue 161: a service reminder on a truck shows on the dashboard when due, and Mark done clears it. */
test('maintenance reminders: due soon on the dashboard, Mark done resets it', async ({ page }) => {
  await login(page);
  const name = `Truck ${randomUUID().slice(0, 4)}`;
  try {
    await page.goto('/settings?tab=equipment');
    await page.getByTestId('truck-name').fill(name);
    await page.getByTestId('truck-add').click();
    await expect(page.getByTestId('truck-row').filter({ hasText: name })).toBeVisible();
    await page.getByTestId('log-truck').selectOption({ label: name });
    await page.getByTestId('log-kind').selectOption('hours');
    await page.getByTestId('log-hours').fill('1230');
    await page.getByTestId('log-add').click();
    await expect(page.getByTestId('log-summary')).toContainText('Meter 1230 h');
    await page.getByTestId('reminder-name').fill('Oil change');
    await page.getByTestId('reminder-hours').fill('250');
    await page.getByTestId('reminder-last-hours').fill('1000');
    await page.getByTestId('reminder-add').click();
    const row = page.getByTestId('reminder-row').filter({ hasText: 'Oil change' });
    await expect(row).toContainText('Due soon');
    await expect(row).toContainText('230 of 250 h');

    await page.goto('/dashboard');
    await expect(page.getByTestId('service-row').filter({ hasText: name })).toContainText('Due soon');

    await page.goto('/settings?tab=equipment');
    await page.getByTestId('log-truck').selectOption({ label: name });
    await page.getByTestId('reminder-row').filter({ hasText: 'Oil change' }).getByTestId('reminder-done').click();
    await page.getByTestId('confirm-yes').click();
    // "0 of 250 h" is also inside the old "230 of 250 h", so wait for the reset itself before leaving the page.
    const reset = page.getByTestId('reminder-row').filter({ hasText: 'Oil change' });
    await expect(reset).toContainText(/(^|\D)0 of 250 h/);
    await expect(reset).not.toContainText('230 of 250 h');
    await page.goto('/dashboard');
    await expect(page.getByTestId('service-row').filter({ hasText: name })).toHaveCount(0);
  } finally {
    await sql`delete from maintenance_item where truck_id in (select id from truck where name = ${name})`;
    await sql`delete from equipment_log where truck_id in (select id from truck where name = ${name})`;
    await sql`delete from truck where name = ${name}`;
  }
});
