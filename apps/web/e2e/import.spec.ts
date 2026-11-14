import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { login } from './helpers';

/** A company moving to Flake brings its list over in one go instead of typing each customer. */
test('a customer list pasted as CSV is checked, then added, one customer with two lots', async ({ page }) => {
  await login(page);
  const tag = randomUUID().slice(0, 6);
  await page.goto('/customers');
  await page.getByTestId('import-customers').click();
  await page.getByTestId('csv-text').fill(`name,address,label,kind,billing\nImport HOA ${tag},100 Lake Ave Lakewood OH,North drive,HOA,invoice\nImport HOA ${tag},120 Lake Ave Lakewood OH,South drive,HOA,invoice\n,9 Nobody St Lakewood OH,,,`);
  await expect(page.getByTestId('csv-summary')).toHaveText('3 rows, 2 ready, 1 with a problem (left out).');
  await page.getByTestId('csv-import').click();
  await expect(page.getByTestId('import-results')).toContainText('2 lots added');
  await page.goto(`/customers?q=${encodeURIComponent(`Import HOA ${tag}`)}`);
  await expect(page.getByTestId('customer-row')).toHaveCount(1);
  await page.getByTestId('customer-row').getByRole('link').first().click();
  await expect(page.getByTestId('site-row')).toHaveCount(2);
});
