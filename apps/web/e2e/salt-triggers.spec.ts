import { expect, test } from '@playwright/test';
import { login, sql } from './helpers';

/** Issue 197: Salt is its own page. Issue 198: every lot's trigger and area in one table, and a default trigger. */
test('Salt has its own page with on hand, next storm, season estimate, use by lot and a CSV', async ({ page }) => {
  await login(page);
  await page.goto('/salt');
  await expect(page.getByRole('heading', { name: 'Salt', level: 1 })).toBeVisible();
  const summary = page.getByTestId('salt-summary');
  await expect(summary).toContainText('On hand');
  await expect(summary).toContainText('Next storm needs');
  await expect(page.getByTestId('salt-season-estimate')).toContainText('salt runs');
  // The demo has salt lots with history.
  await expect(page.getByTestId('salt-lot').first()).toBeVisible();
  const csv = await page.request.get('/api/salt/usage.csv');
  expect(csv.ok()).toBe(true);
  expect((await csv.text()).split('\r\n')[0]).toBe('Lot,Sq ft,Storms,Salted visits,Tons used,Tons per salting,Per salting from,Tons per 1000 sq ft');
});

test('Snow triggers: each lot is listed with its area, an area can be renamed, and the default trigger fills new quotes', async ({ page }) => {
  await login(page);
  await page.goto('/settings?tab=triggers');
  const table = page.getByTestId('triggers-table');
  await expect(table.getByTestId('trigger-row').first()).toBeVisible();
  const [t] = await sql`select id from tenant where slug = 'lakeshore-demo'`;
  const first = table.getByTestId('trigger-row').first();
  const area = first.getByTestId('trigger-area');
  const was = await area.inputValue();
  try {
    await area.fill('North side');
    await area.blur();
    await expect.poll(async () => Object.values(((await sql`select value from app_setting where key = ${`areas:${t!.id}`}`)[0]?.value ?? {}) as Record<string, string>)).toContain('North side');
  } finally {
    await page.reload();
    await table.getByTestId('trigger-row').first().getByTestId('trigger-area').fill(was);
    await table.getByTestId('trigger-row').first().getByTestId('trigger-area').blur();
  }
  // Default trigger: saved, and a new quote starts with it.
  await page.getByTestId('default-trigger').fill('3');
  await page.getByTestId('default-trigger-save').click();
  await expect(page.getByTestId('default-trigger-msg')).toContainText('Saved');
  try {
    const [lot] = await sql`select s.id from site s where s.tenant_id = ${t!.id} and s.active limit 1`;
    await page.goto(`/sites/${lot!.id}`);
    await expect(page.getByTestId('q-trigger')).toHaveValue('3');
  } finally {
    await page.request.put('/api/settings/triggers', { data: { inches: 2 } });
  }
});

/** Issue 204: salt runs have their own rule, a company default and a per-lot change, and each lot says plow, salt or nothing. */
test('Salt runs: the company default and one lot can be changed, and every signed lot says what it would get', async ({ page }) => {
  await login(page);
  const [t] = await sql`select id from tenant where slug = 'lakeshore-demo'`;
  const saved = async () => ((await sql`select value from app_setting where key = ${`salt_trigger:${t!.id}`}`)[0]?.value ?? null) as { default?: { snow_in: number | null }; lots?: Record<string, unknown> } | null;
  await page.goto('/settings?tab=triggers');
  try {
    await page.getByTestId('salt-default').selectOption('ice');
    await page.getByTestId('salt-default-save').click();
    await expect(page.getByTestId('salt-default-msg')).toContainText('Saved');
    await expect.poll(async () => (await saved())?.default?.snow_in).toBeNull();
    // A salt lot follows the company until it's given its own rule.
    const lot = page.getByTestId('trigger-salt').first();
    await expect(lot).toHaveValue('default');
    await expect(lot.locator('option[value="default"]')).toContainText('Ice and refreeze only');
    await lot.selectOption('off');
    await expect.poll(async () => Object.keys((await saved())?.lots ?? {}).length).toBe(1);
    await expect(page.getByTestId('trigger-salt').first()).toHaveValue('off');
    await page.getByTestId('trigger-salt').first().selectOption('default');
    await expect.poll(async () => Object.keys((await saved())?.lots ?? {}).length).toBe(0);
  } finally {
    await page.request.put('/api/settings/triggers', { data: { salt: { snow_in: 0, ice: true, refreeze: true } } });
  }
  // Every lot with a signed contract and a forecast says plow, salt or no trigger.
  const rows = page.getByTestId('triggers-table').getByTestId('trigger-row');
  await expect(rows.first()).toBeVisible();
  const said = await page.locator('[data-testid="will-trigger"], [data-testid="will-salt"], [data-testid="no-trigger"]').allTextContents();
  for (const s of said) expect(s).toMatch(/plow|salt only|No trigger/);
});
