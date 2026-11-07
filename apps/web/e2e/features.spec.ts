import { expect, test } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { login, sql, startStorm, waitOfflineReady } from './helpers';

const FAKE_ENDPOINT = () => `https://fcm.googleapis.com/fcm/send/${randomUUID()}`;
// Made up on each run. These only need to have the right shape.
const KEYS = { p256dh: randomBytes(32).toString('base64url'), auth: randomBytes(16).toString('base64url') };

test('push: turning on alerts registers the device, and an alert reaches it once', async ({ page }) => {
  await login(page);
  const endpoint = FAKE_ENDPOINT();
  // Headless Chromium can't reach a real push service, so the browser's subscribe call is stubbed. The rest is real.
  await page.addInitScript(({ url, keys }) => {
    Object.defineProperty(Notification, 'permission', { get: () => 'default' });
    Notification.requestPermission = async () => 'granted';
    const fake = { endpoint: url, toJSON: () => ({ endpoint: url, keys }), unsubscribe: async () => true };
    PushManager.prototype.subscribe = async () => fake as unknown as PushSubscription;
    PushManager.prototype.getSubscription = async () => null;
  }, { url: endpoint, keys: KEYS });
  await page.goto('/settings?tab=alerts');
  await expect(page.getByTestId('push-panel')).toHaveAttribute('data-state', 'off');
  await page.getByTestId('push-enable').click();
  await expect(page.getByTestId('push-panel')).toHaveAttribute('data-state', 'on');
  const [row] = await sql`select id, user_id from push_subscription where endpoint = ${endpoint}`;
  expect(row).toBeTruthy();

  await page.getByTestId('push-test').click();
  await expect(page.getByTestId('push-msg')).toContainText('Test alert sent');
  await expect.poll(async () => (await sql`select count(*)::int n from message_log where channel = 'push' and template = 'push' and idempotency_key like ${`push:%:${row!.id}`} and status = 'sent'`)[0]!.n, { timeout: 30000 }).toBe(1);
  await sql`delete from push_subscription where endpoint = ${endpoint}`;
});

test('push: a driver problem alerts the office, and a dead subscription is removed', async ({ page }) => {
  await login(page);
  const live = FAKE_ENDPOINT();
  const dead = `https://fcm.googleapis.com/fcm/send/gone-${randomUUID()}`;
  for (const endpoint of [live, dead]) expect((await page.request.post('/api/push/subscribe', { data: { endpoint, keys: KEYS } })).ok()).toBe(true);
  const { runs } = await startStorm(page.request, `Push ${Date.now()}`, ['Rocky River']);
  const run = runs[0]!;
  const token = new URL(run.link).pathname.split('/').pop()!;
  await page.request.post(`/api/d/${token}/actions`, { data: { actions: [{ client_uuid: randomUUID(), at: new Date().toISOString(), kind: 'problem', run_stop_id: run.stops[0]!.id, problem: 'blocked', note: null }] } });
  await expect.poll(async () => (await sql`select count(*)::int n from push_subscription where endpoint = ${dead}`)[0]!.n, { timeout: 30000 }).toBe(0);
  const [sub] = await sql`select id from push_subscription where endpoint = ${live}`;
  const [msg] = await sql`select body, status from message_log where channel = 'push' and idempotency_key like ${`push:problem:%:${sub!.id}`}`;
  expect(msg).toMatchObject({ status: 'sent' });
  expect(msg!.body).toContain('blocked');
  expect((await page.request.post('/api/push/unsubscribe', { data: { endpoint: live } })).ok()).toBe(true);
  expect((await sql`select count(*)::int n from push_subscription where endpoint = ${live}`)[0]!.n).toBe(0);
});

test('push: the server only calls real push services', async ({ page, request }) => {
  await login(page);
  for (const endpoint of ['http://fcm.googleapis.com/x', 'https://169.254.169.254/latest/meta-data', 'https://localhost/x', 'https://evil.example.com/x', 'https://fcm.googleapis.com.evil.example.com/x']) {
    expect((await page.request.post('/api/push/subscribe', { data: { endpoint, keys: KEYS } })).status(), endpoint).toBe(422);
  }
  expect((await request.post('/api/push/subscribe', { data: { endpoint: FAKE_ENDPOINT(), keys: KEYS } })).status()).toBe(401);
});

test('pin photos: an office photo reaches the driver card and survives a reload with no signal', async ({ page, context }) => {
  await login(page);
  const { runs } = await startStorm(page.request, `Pin ${Date.now()}`, ['Rocky River']);
  const run = runs[0]!;
  const firstSite = run.stops[0]!.site_id;
  await page.goto(`/sites/${firstSite}`);
  const note = `Hydrant ${Date.now()}`;
  const pin = await (await page.request.post('/api/pins', { data: { site_id: firstSite, kind: 'hazard', note } })).json();
  await page.reload();
  const buffer = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: 200, g: 60, b: 60 } } }).jpeg().toBuffer();
  await page.getByTestId(`pin-photo-${pin.id}`).setInputFiles({ name: 'hydrant.jpg', mimeType: 'image/jpeg', buffer });
  await expect(page.getByTestId(`pin-thumb-${pin.id}`)).toBeVisible({ timeout: 20000 });
  const [row] = await sql`select photo_path from site_pin where id = ${pin.id}`;
  expect(row!.photo_path).toContain('/pins/');

  await page.goto(run.link);
  const img = page.getByTestId(`driver-pin-${pin.id}`);
  await expect(img).toBeVisible();
  const loaded = () => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0);
  await expect.poll(loaded).toBe(true);
  expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeLessThanOrEqual(1280);
  await waitOfflineReady(page);
  await page.waitForTimeout(500);
  await context.setOffline(true);
  await page.reload();
  await expect(img).toBeVisible();
  await expect.poll(loaded).toBe(true);
  await context.setOffline(false);
});

test('pin photos: a link for one run cannot fetch another company or run pin, and bad uploads are refused', async ({ page, browser, baseURL }) => {
  await login(page);
  const { runs } = await startStorm(page.request, `PinScope ${Date.now()}`, ['Rocky River']);
  const token = new URL(runs[0]!.link).pathname.split('/').pop()!;
  const [other] = await sql`select s.id from site s join route_stop rs on rs.site_id = s.id join route r on r.id = rs.route_id join tenant t on t.id = s.tenant_id where t.slug = 'lakeshore-demo' and r.name = 'West Lakewood' limit 1`;
  const pin = await (await page.request.post('/api/pins', { data: { site_id: other!.id, kind: 'pile' } })).json();
  const png = await sharp({ create: { width: 200, height: 200, channels: 3, background: '#333' } }).png().toBuffer();
  const up = await page.request.post(`/api/pins/${pin.id}/photo`, { multipart: { file: { name: 'a.png', mimeType: 'image/png', buffer: png } } });
  expect(up.ok(), await up.text()).toBe(true);
  expect((await page.request.get(`/api/d/${token}/pins/${pin.id}`)).status()).toBe(404);
  expect((await page.request.get(`/api/d/not-a-token/pins/${pin.id}`)).status()).toBe(410);
  const notImage = await page.request.post(`/api/pins/${pin.id}/photo`, { multipart: { file: { name: 'a.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('this is not an image') } } });
  expect(notImage.status()).toBe(422);

  const stranger = await browser.newContext({ baseURL });
  const email = `pin-${randomUUID()}@flake.test`;
  await stranger.request.post(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/signup`, { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! }, data: { email, password: 'flake-demo-only' } });
  await stranger.request.post('/api/dev/login', { data: { email } });
  await stranger.request.post('/api/onboarding', { data: { name: 'Other Plow' } });
  expect((await stranger.request.get(`/api/pins/${pin.id}/photo`, { maxRedirects: 0 })).status()).toBe(404);
  expect((await stranger.request.post(`/api/pins/${pin.id}/photo`, { multipart: { file: { name: 'a.png', mimeType: 'image/png', buffer: png } } })).status()).toBe(404);
  await stranger.close();
});

test('wizard: choosing an address suggestion measures it, and a pin can carry a photo', async ({ page }) => {
  await login(page);
  const name = `Suggest ${Date.now()}`;
  await page.goto('/customers/new');
  await page.getByTestId('c-name').fill(name);
  await page.getByTestId('next').click();
  await page.getByTestId('address').pressSequentially('1470 Detroit', { delay: 20 });
  const first = page.getByTestId('address-suggestion').first();
  await expect(first).toBeVisible();
  const chosen = (await first.textContent())!.trim();
  await first.click();
  await expect(page.getByTestId('sqft')).toContainText('sq ft');
  await expect(page.getByTestId('address')).toHaveValue(chosen);
  await expect(page.getByTestId('address-suggestion')).toHaveCount(0);
  await page.getByTestId('next').click();
  await page.getByTestId('next').click();
  await page.getByTestId('add-pin').click();
  const buffer = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#357' } }).jpeg().toBuffer();
  await page.getByTestId('wizard-pin-photo').setInputFiles({ name: 'p.jpg', mimeType: 'image/jpeg', buffer });
  await page.getByTestId('next').click();
  await page.getByTestId('next').click();
  await page.getByTestId('send-quote').click();
  await expect(page.getByTestId('quote-sent')).toBeVisible();
  await expect.poll(async () => (await sql`select count(*)::int n from site_pin p join site s on s.id = p.site_id join customer c on c.id = s.customer_id where c.name = ${name} and p.photo_path is not null`)[0]!.n).toBe(1);
  const [site] = await sql`select s.address from site s join customer c on c.id = s.customer_id where c.name = ${name}`;
  expect(site!.address).toBe(chosen);
});

test('suggestions need a signed-in office user', async ({ request }) => {
  expect((await request.post('/api/sites/suggest', { data: { q: '1470 Detroit' } })).status()).toBe(401);
});
