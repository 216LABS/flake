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

/** Typing a name that's already a customer points at them, so a second lot doesn't make a second customer by mistake. */
test('New customer with a name already in use offers to add the lot to that customer', async ({ page }) => {
  await login(page);
  const tag = randomUUID().slice(0, 6);
  const c = await (await page.request.post('/api/customers', { data: { name: `Twin ${tag}`, kind: 'commercial', billing_mode: 'manual' } })).json();
  await page.goto('/customers/new');
  await page.getByTestId('c-name').fill(`twin ${tag} `);
  await expect(page.getByTestId('customer-twin')).toContainText(`You already have a customer named Twin ${tag}.`);
  await page.getByTestId('customer-twin').getByRole('link').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Add a site for Twin ${tag}`);
  await page.goto('/customers/new');
  await page.getByTestId('c-name').fill(`Twin ${tag} Two`);
  await expect(page.getByTestId('customer-twin')).toHaveCount(0);
  await page.request.delete(`/api/customers/${c.id}`);
});
