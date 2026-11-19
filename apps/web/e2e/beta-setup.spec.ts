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

test('a new owner signs up: terms are linked and required, sending starts off, the checklist and logo work (issues 171-173)', async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const email = `e2e-beta-${Date.now()}@flake.test`;
  const name = `E2E Beta Plow ${Date.now() % 100000}`;
  try {
    await page.goto('/login');
    await expect(page.getByTestId('legal-links').getByRole('link', { name: 'Terms of Service' })).toHaveAttribute('href', '/legal/terms');
    await expect(page.getByTestId('legal-links').getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/legal/privacy');
    await page.request.post(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/signup`, { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! }, data: { email, password: 'flake-demo-only' } });
    await page.request.post('/api/dev/login', { data: { email } });
    await page.goto('/dashboard');
    await page.waitForURL('**/onboarding');
    await page.getByTestId('company').fill(name);
    await expect(page.getByTestId('create-company')).toBeDisabled();
    await expect(page.getByRole('link', { name: 'Privacy Policy' }).first()).toBeVisible();
    // The server refuses it too.
    expect((await page.request.post('/api/onboarding', { data: { name } })).status()).toBe(422);
    await page.getByLabel(/I agree to the Terms of Service/).check();
    await page.getByTestId('create-company').click();
    await page.waitForURL('**/dashboard');
    const [t] = await sql`select id, terms_accepted_at, terms_version, outbound_enabled from tenant where name = ${name}`;
    expect(t!.terms_accepted_at).not.toBeNull();
    expect(t!.terms_version).toContain('terms 2026-11-10');
    expect(t!.outbound_enabled).toBe(false);

    // Sending is off and the office is told.
    await expect(page.getByTestId('sending-off')).toBeVisible();
    // The checklist has every step, done or not.
    const steps = page.getByTestId('setup-step');
    await expect(page.getByTestId('setup-checklist')).toContainText('Check your prices');
    await expect(page.getByTestId('setup-checklist')).toContainText('legal business name');
    await expect(page.getByTestId('setup-checklist')).toContainText('Have a list? Import it');
    await expect(steps.filter({ hasText: 'logo' })).toHaveAttribute('data-done', 'no');

    // Checking the prices ticks its step.
    await page.goto('/settings?tab=rate');
    await page.getByTestId('rate-save').click();
    await expect(page.getByTestId('rate-msg')).toHaveText('Saved');
    await page.goto('/dashboard');
    await expect(page.getByTestId('setup-step').filter({ hasText: 'Check your prices' })).toHaveAttribute('data-done', 'yes');

    // A logo: a PNG is taken and shown, anything else is refused.
    await page.goto('/settings?tab=company');
    await page.getByTestId('logo-file').setInputFiles({ name: 'logo.txt', mimeType: 'image/png', buffer: Buffer.from('not an image') });
    await expect(page.getByTestId('logo-msg')).toContainText('PNG or JPEG');
    await page.getByTestId('logo-file').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
    await expect(page.getByTestId('logo-preview')).toBeVisible();
    const src = await page.getByTestId('logo-preview').getAttribute('src');
    expect((await page.request.get(src!)).headers()['content-type']).toBe('image/png');
  } finally {
    // The company stays, like the other signup tests' companies: its rows reference it everywhere.
    await ctx.close();
  }
});

test('216LABS turns sending on for one company from the admin page (issue 171)', async ({ page }) => {
  await login(page);
  const [demo] = await sql`select id, outbound_enabled from tenant where slug = 'lakeshore-demo'`;
  try {
    await sql`update tenant set outbound_enabled = false where id = ${demo!.id}`;
    await page.goto('/settings?tab=system');
    await page.getByTestId('admin-sending-link').click();
    await page.getByTestId('sending-search').fill('Lakeshore Plow');
    const row = page.getByTestId('sending-row').filter({ hasText: 'lakeshore-demo' });
    await expect(row.getByTestId('sending-state')).toHaveText('Off');
    await row.getByTestId('sending-toggle').click();
    await page.getByTestId('confirm-yes').click();
    await expect(row.getByTestId('sending-state')).toHaveText('On');
    expect((await sql`select outbound_enabled from tenant where id = ${demo!.id}`)[0]!.outbound_enabled).toBe(true);
  } finally {
    await sql`update tenant set outbound_enabled = ${demo!.outbound_enabled} where id = ${demo!.id}`;
  }
});
