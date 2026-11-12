import { expect, test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { login, sql, startStorm } from './helpers';

test('a signed contract can be voided but never edited or pulled back to draft', async ({ page }) => {
  await login(page);
  const [t] = await sql`select id from tenant where slug = 'lakeshore-demo'`;
  const [s] = await sql`select id from site where tenant_id = ${t!.id} and active limit 1`;
  const services = [{ service: 'plow', trigger_in: 2, pricing: { type: 'per_push', amount_cents: 6500 } }];
  const [c] = await sql`insert into contract (tenant_id, site_id, season, status, services, accepted_at, accepted_name) values (${t!.id}, ${s!.id}, '2031-32', 'accepted', ${sql.json(services)}, now(), 'Guard Test') returning id`;
  const patch = (data: unknown) => page.request.patch(`/api/contracts/${c!.id}`, { data });
  expect((await patch({ services: [{ ...services[0], pricing: { type: 'per_push', amount_cents: 99900 } }] })).status()).toBe(409);
  expect((await patch({ status: 'draft' })).status()).toBe(409);
  const [still] = await sql`select status, services from contract where id = ${c!.id}`;
  expect(still).toMatchObject({ status: 'accepted', services });
  expect((await patch({ status: 'void' })).status()).toBe(200);
  expect((await patch({ status: 'draft' })).status()).toBe(409);
  await sql`delete from contract where id = ${c!.id}`;
});

test('taking someone off the crew kills their route link at once', async ({ page }) => {
  await login(page);
  const { id: stormId, runs } = await startStorm(page.request, 'Crew leaves', ['Rocky River']);
  const run = runs[0]!;
  const [t] = await sql`select id from tenant where slug = 'lakeshore-demo'`;
  const [c] = await sql`insert into crew_member (tenant_id, name, kind, email) values (${t!.id}, 'Leaving Soon', 'employee', ${`leaving-${Date.now()}@flake.test`}) returning id`;
  expect((await page.request.patch(`/api/runs/${run.id}`, { data: { crew_id: c!.id } })).ok()).toBe(true);
  const token = new URL(run.link).pathname.split('/')[2]!;
  expect((await page.request.get(`/api/d/${token}/run`)).status()).toBe(200);
  expect((await page.request.delete(`/api/crew/${c!.id}`)).ok()).toBe(true);
  expect((await page.request.get(`/api/d/${token}/run`)).status()).toBe(410);
  // They can't be put back on a run either.
  expect((await page.request.patch(`/api/runs/${run.id}`, { data: { crew_id: c!.id } })).status()).toBe(422);
  await page.request.post(`/api/storms/${stormId}/close`, { data: { force: true } });
});

test('the owner can fix the company name, time zone and office contact', async ({ page }) => {
  await login(page);
  const [t] = await sql`select name, timezone, contact_email, contact_phone from tenant where slug = 'lakeshore-demo'`;
  expect((await page.request.patch('/api/settings', { data: { timezone: 'Mars/Olympus' } })).status()).toBe(422);
  await page.goto('/settings');
  await expect(page.getByTestId('co-name')).toHaveValue(t!.name);
  await page.getByTestId('co-tz').selectOption('America/Chicago');
  await page.getByTestId('co-phone').fill('216-555-0144');
  await page.getByTestId('co-save').click();
  await expect(page.getByTestId('co-msg')).toHaveText('Saved');
  const [after] = await sql`select timezone, contact_phone from tenant where slug = 'lakeshore-demo'`;
  expect(after).toMatchObject({ timezone: 'America/Chicago', contact_phone: '+12165550144' });
  await sql`update tenant set timezone = ${t!.timezone}, contact_phone = ${t!.contact_phone} where slug = 'lakeshore-demo'`;
});

test('removing a driver asks first, and a returning driver can be brought back', async ({ page }) => {
  await login(page);
  const [t] = await sql`select id from tenant where slug = 'lakeshore-demo'`;
  const name = `Seasonal ${Date.now()}`;
  const [c] = await sql`insert into crew_member (tenant_id, name, kind, email) values (${t!.id}, ${name}, 'employee', ${`seasonal-${Date.now()}@flake.test`}) returning id`;
  await page.goto('/settings?tab=crew');
  const row = page.getByTestId('crew-row').filter({ hasText: name });
  await row.getByTestId('crew-remove').click();
  await page.getByTestId('confirm-no').click();
  await expect(row.getByTestId('crew-remove')).toBeVisible();
  await row.getByTestId('crew-remove').click();
  await page.getByTestId('confirm-yes').click();
  await expect(row.getByTestId('crew-restore')).toBeVisible();
  // Their old invite link is dead while they're off the crew.
  expect((await page.request.post(`/api/crew/${c!.id}/invite`)).status()).toBe(404);
  await row.getByTestId('crew-restore').click();
  await expect(row.getByTestId('crew-reinvite')).toBeVisible();
  const invite = await page.request.post(`/api/crew/${c!.id}/invite`);
  expect(invite.ok()).toBe(true);
  const path = new URL((await invite.json()).invite_url).pathname;
  await page.goto(path);
  await expect(page.getByTestId('join')).toBeVisible();
});

test('billing for a storm still going says to close it first', async ({ page }) => {
  await login(page);
  const { id } = await startStorm(page.request, 'Still snowing', ['Rocky River']);
  expect((await page.request.post(`/api/storms/${id}/billing/draft`)).status()).toBe(409);
  await page.goto(`/billing?storm=${id}`);
  await expect(page.getByText('This storm is still going')).toBeVisible();
  await expect(page.getByTestId('generate')).toHaveCount(0);
  await page.request.post(`/api/storms/${id}/close`, { data: { force: true } });
});

test('adding a lot to a route keeps a change someone else just made to it', async ({ page }) => {
  await login(page);
  const [t] = await sql`select id from tenant where slug = 'lakeshore-demo'`;
  const [r] = await sql`insert into route (tenant_id, name) values (${t!.id}, ${`Shared ${Date.now()}`}) returning id`;
  const sites = await sql`select id from site where tenant_id = ${t!.id} and active order by created_at limit 3`;
  const add = (site_id: string, position?: number) => page.request.post(`/api/routes/${r!.id}/stops`, { data: { site_id, ...(position ? { position } : {}) } });
  expect((await add(sites[0]!.id)).ok()).toBe(true);
  // Two people, two screens, one route: both lots stay on it, the second one first as asked.
  expect((await add(sites[1]!.id)).ok()).toBe(true);
  expect((await add(sites[2]!.id, 1)).ok()).toBe(true);
  expect((await add(sites[2]!.id)).ok()).toBe(true);
  const stops = await sql`select site_id from route_stop where route_id = ${r!.id} order by seq`;
  expect(stops.map((s) => s.site_id)).toEqual([sites[2]!.id, sites[0]!.id, sites[1]!.id]);
  await sql`delete from route where id = ${r!.id}`;
});

test('another pass and closing a storm both ask first', async ({ page }) => {
  await login(page);
  const { id } = await startStorm(page.request, `Ask first ${Date.now()}`, ['Rocky River']);
  await page.goto(`/storms/${id}`);
  await page.getByTestId('another-pass').click();
  await page.getByTestId('confirm-no').click();
  await page.getByTestId('close-storm').click();
  await page.getByTestId('confirm-no').click();
  await expect(page.getByTestId('close-storm')).toBeVisible();
  const runs = await sql`select max(pass)::int as pass from storm_run where storm_id = ${id}`;
  expect(runs[0]!.pass).toBe(1);
  const [s] = await sql`select status from storm where id = ${id}`;
  expect(s!.status).toBe('active');
  await page.request.post(`/api/storms/${id}/close`, { data: { force: true } });
});

test('signing in with the code from the email works, for a Home Screen app that the link would miss', async ({ page }) => {
  const email = `code-${Date.now()}@flake.test`;
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  await admin.auth.admin.createUser({ email, email_confirm: true });
  await page.goto('/login');
  await page.getByTestId('email').fill(email);
  await page.getByTestId('send-link').click();
  await expect(page.getByTestId('link-sent')).toBeVisible();
  await page.getByTestId('otp-code').fill('000000');
  await page.getByTestId('otp-verify').click();
  await expect(page.getByTestId('login-error')).toContainText('wrong or has expired');
  // The code the email would carry. Making it replaces the one just sent, as a second email would.
  const { data } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  await page.getByTestId('otp-code').fill(data.properties!.email_otp);
  await page.getByTestId('otp-verify').click();
  await page.waitForURL('**/onboarding');
});

test('the board can replace a route link, and the old one stops at once', async ({ page }) => {
  await login(page);
  const { id, runs } = await startStorm(page.request, `Lost phone ${Date.now()}`, ['Rocky River']);
  const oldToken = new URL(runs[0]!.link).pathname.split('/')[2]!;
  await page.goto(`/storms/${id}`);
  await page.getByTestId('show-link').first().click();
  await page.getByTestId('replace-link').click();
  await page.getByTestId('confirm-yes').click();
  await expect(page.getByTestId('run-link')).not.toHaveValue(runs[0]!.link);
  const fresh = new URL(await page.getByTestId('run-link').inputValue()).pathname.split('/')[2]!;
  expect((await page.request.get(`/api/d/${oldToken}/run`)).status()).toBe(410);
  expect((await page.request.get(`/api/d/${fresh}/run`)).status()).toBe(200);
  await page.request.post(`/api/storms/${id}/close`, { data: { force: true } });
});

test('a misplaced pin can be removed from the site page', async ({ page }) => {
  await login(page);
  const [s] = await sql`select s.id, s.tenant_id from site s join tenant t on t.id = s.tenant_id where t.slug = 'lakeshore-demo' and s.active limit 1`;
  const [p] = await sql`insert into site_pin (tenant_id, site_id, kind, lat, lon, note) values (${s!.tenant_id}, ${s!.id}, 'hazard', 41.48, -81.8, 'wrong spot') returning id`;
  await page.goto(`/sites/${s!.id}`);
  await page.getByTestId(`pin-remove-${p!.id}`).click();
  await page.getByTestId('confirm-yes').click();
  await expect(page.getByTestId(`pin-remove-${p!.id}`)).toHaveCount(0);
  expect(await sql`select id from site_pin where id = ${p!.id}`).toHaveLength(0);
});
