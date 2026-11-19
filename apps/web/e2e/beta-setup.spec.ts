import { expect, test } from '@playwright/test';
import { login, sql } from './helpers';

/** Issues 171-180: what a first real company needs before it signs up. */
test('a Spanish-speaking driver reads the join page in Spanish (issue 177)', async ({ page, browser }) => {
  await login(page);
  const name = `E2E Juan ${Date.now()}`;
  const made = await page.request.post('/api/crew', { data: { name, phone_e164: '+12165550177', kind: 'employee', language: 'es' } });
  expect(made.status()).toBe(201);
  const { id, invite_url } = await made.json();
  try {
    const fresh = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const join = await fresh.newPage();
    await join.goto(invite_url);
    await expect(join.locator('html')).toHaveAttribute('lang', 'es');
    await expect(join.getByRole('heading')).toContainText('únete a');
    await expect(join.getByLabel('Tu número de celular')).toBeVisible();
    await expect(join.locator('main')).toContainText('Envíenme por texto');
    await expect(join.getByTestId('join')).toHaveText('Unirme');
    await join.getByTestId('join').click();
    await expect(join.getByTestId('joined')).toContainText('Ya estás en el equipo');
    await fresh.close();
  } finally {
    await sql`delete from crew_member where id = ${id}`;
  }
});

test('without Stripe keys, Payments and Plan explain instead of offering buttons that fail (issue 175)', async ({ page }) => {
  await login(page);
  await sql`insert into app_setting (key, value) values ('dev.unconfigured', '{"payments": true}'::jsonb) on conflict (key) do update set value = excluded.value`;
  const [t] = await sql`select stripe_charges_enabled, stripe_account_id from tenant where slug = 'lakeshore-demo'`;
  try {
    await sql`update tenant set stripe_charges_enabled = false, stripe_account_id = null where slug = 'lakeshore-demo'`;
    await page.goto('/settings?tab=payments');
    await expect(page.getByTestId('stripe-unavailable')).toBeVisible();
    await expect(page.getByTestId('stripe-connect')).toHaveCount(0);
    await expect(page.getByTestId('pay-instructions-save')).toBeVisible();
    await page.goto('/settings?tab=plan');
    await expect(page.getByTestId('pro-unavailable')).toBeVisible();
    await expect(page.getByRole('button', { name: /Go Pro/ })).toHaveCount(0);
    await page.goto('/dashboard');
    await expect(page.locator('main')).not.toContainText('Connect Stripe to get paid');
  } finally {
    await sql`delete from app_setting where key = 'dev.unconfigured'`;
    await sql`update tenant set stripe_charges_enabled = ${t!.stripe_charges_enabled}, stripe_account_id = ${t!.stripe_account_id} where slug = 'lakeshore-demo'`;
  }
  await page.goto('/settings?tab=plan');
  await expect(page.getByRole('button', { name: 'Go Pro monthly' })).toBeVisible();
});

test('crew import: preview flags a bad row, the good rows are added and nobody is texted (issue 174)', async ({ page }) => {
  await login(page);
  const tag = `E2E${Date.now() % 100000}`;
  try {
    await page.goto('/settings?tab=crew');
    await page.getByTestId('crew-import-link').click();
    await expect(page.getByTestId('crew-import-help')).toContainText('name');
    await page.getByTestId('crew-csv-text').fill(`name,phone,kind,language\n${tag} Dana,216-555-0171,employee,es\n${tag} Sub Co,,sub,\n${tag} Bad,12,,`);
    await expect(page.getByTestId('crew-csv-summary')).toHaveText('3 rows, 2 ready, 1 with a problem (left out).');
    await page.getByTestId('crew-csv-import').click();
    await expect(page.getByTestId('crew-import-results')).toContainText('2 people added');
    const rows = await sql`select name, kind, language from crew_member where name like ${`${tag}%`} order by name`;
    expect(rows).toEqual([{ name: `${tag} Dana`, kind: 'employee', language: 'es' }, { name: `${tag} Sub Co`, kind: 'sub', language: 'en' }]);
    expect((await sql`select count(*)::int as n from sms_consent where phone_e164 = '+12165550171'`)[0]!.n).toBe(0);
  } finally {
    await sql`delete from crew_member where name like ${`${tag}%`}`;
  }
});
