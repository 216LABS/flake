import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { login, sql, startStorm } from './helpers';

test('customer records page: visits with photos and salt, private to that customer, and a reset turns the old link off', async ({ page, browser, baseURL }) => {
  await login(page);
  const stormName = `Portal storm ${randomUUID().slice(0, 6)}`;
  const { runs } = await startStorm(page.request, stormName, ['West Lakewood']);
  const run = runs[0]!;
  // Other tests pile visits onto these lots, some dated ahead of now, and the page shows the 10 newest as cards. Use the
  // lot with the fewest visits newer than this one.
  const counts = await sql`select s.id, (select count(*)::int from visit v where v.site_id = s.id and v.arrived_device_at > now() - interval '30 minutes') as n from site s where s.id in ${sql(run.stops.map((x) => x.site_id))}`;
  const quietest = counts.sort((x, y) => x.n - y.n)[0]!.id;
  const stop = run.stops.find((x) => x.site_id === quietest)!;
  const [owner] = await sql`select s.customer_id, s.label, c.name from site s join customer c on c.id = s.customer_id where s.id = ${stop.site_id}`;
  const token = new URL(run.link).pathname.split('/').pop()!;
  const visit = randomUUID();
  const at = Date.now() - 30 * 60_000;
  const act = await page.request.post(`/api/d/${token}/actions`, {
    data: {
      actions: [
        { client_uuid: randomUUID(), at: new Date(at).toISOString(), kind: 'arrive', run_stop_id: stop.id, visit_client_uuid: visit, gps: null },
        { client_uuid: randomUUID(), at: new Date(at + 15 * 60_000).toISOString(), kind: 'done', run_stop_id: stop.id, visit_client_uuid: visit, services: ['plow', 'salt'], depth_in: 4, salt: [{ unit: 'bag50lb', qty: 6 }], gps: null },
      ],
    },
  });
  expect(act.ok(), await act.text()).toBe(true);
  const jpg = await sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 200, g: 210, b: 220 } } }).jpeg().toBuffer();
  const up = await page.request.post(`/api/d/${token}/photos`, { multipart: { file: { name: 'a.jpg', mimeType: 'image/jpeg', buffer: jpg }, client_uuid: randomUUID(), visit_client_uuid: visit, phase: 'after' } });
  expect(up.ok(), await up.text()).toBe(true);

  // The office copies the link from the customer page.
  await page.goto(`/customers/${owner!.customer_id}`);
  await page.getByTestId('portal-copy').click();
  const url = await page.getByTestId('portal-url').inputValue();
  expect(url).toContain('/c/');

  // The customer opens it with no login.
  const guest = await browser.newContext({ baseURL });
  const g = await guest.newPage();
  await g.goto(url);
  await expect(g.getByRole('heading', { level: 1 })).toContainText(owner!.name);
  const site = g.getByTestId('portal-site').filter({ hasText: owner!.label });
  const first = site.getByTestId('portal-visit').filter({ hasText: stormName });
  await expect(first).toContainText('Plowed, Salted');
  await expect(first).toContainText('4" of snow');
  await expect(first).toContainText('6 50 lb bags');
  const img = first.getByRole('img');
  await expect(img).toHaveCount(1);
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(0);

  // Someone else's photo, a made-up packet and a forged link all stay out of reach.
  const pathToken = new URL(url).pathname.split('/').pop()!;
  const [other] = await sql`select p.id from visit_photo p join visit v on v.id = p.visit_id join site s on s.id = v.site_id where s.customer_id <> ${owner!.customer_id} limit 1`;
  if (other) expect((await guest.request.get(`/api/c/${pathToken}/photo/${other.id}`, { maxRedirects: 0 })).status()).toBe(404);
  expect((await guest.request.get(`/api/c/${pathToken}/packet/${randomUUID()}`, { maxRedirects: 0 })).status()).toBe(404);
  const [idPart, v] = pathToken.split('.');
  expect((await guest.request.get(`/c/${idPart}.${v}.${'A'.repeat(32)}`)).status()).toBe(404);
  expect((await guest.request.get('/c/nonsense')).status()).toBe(404);

  // A new link turns the old one off.
  await page.getByTestId('portal-reset').click();
  await page.getByTestId('portal-reset-confirm').click();
  await expect(page.getByRole('status')).toContainText('old one no longer works');
  const fresh = await page.getByTestId('portal-url').inputValue();
  expect(fresh).not.toBe(url);
  expect((await guest.request.get(url)).status()).toBe(404);
  expect((await guest.request.get(fresh)).status()).toBe(200);

  // Email: sends when there is an address, explains when there isn't.
  const sent = await page.request.post(`/api/customers/${owner!.customer_id}/portal`, { data: { action: 'email' } });
  const [c] = await sql`select email from customer where id = ${owner!.customer_id}`;
  expect(sent.status()).toBe(c!.email ? 200 : 422);

  // Only the office can make links.
  expect((await guest.request.get(`/api/customers/${owner!.customer_id}/portal`)).status()).toBe(401);
  await guest.close();
});

test('a customer asks for another visit from their records page, and the office hears about it once', async ({ page, browser, baseURL }) => {
  await login(page);
  const [c] = await sql`select c.id, c.name, s.id as site_id, s.label from customer c join site s on s.customer_id = c.id join tenant t on t.id = c.tenant_id where t.slug = 'lakeshore-demo' order by c.name limit 1`;
  const { url } = await (await page.request.get(`/api/customers/${c!.id}/portal`)).json();
  const guest = await browser.newContext({ baseURL });
  const g = await guest.newPage();
  await g.goto(url);
  const box = g.getByTestId('request-visit');
  await box.getByTestId('request-note').fill('Drifting by the loading dock');
  await box.getByTestId('request-send').click();
  await expect(box.getByTestId('request-sent')).toBeVisible();
  const sent = async () => (await sql`select count(*)::int as n from message_log where template = 'owner_alert' and idempotency_key like ${`%visit_request:${c!.site_id}:%`} and body like '%loading dock%'`)[0]!.n;
  await expect.poll(sent, { timeout: 30000 }).toBeGreaterThan(0);
  // One request alerts every owner and dispatcher plus the office phone; wait until they've all gone out.
  let first = -1;
  await expect.poll(async () => {
    const now = await sent();
    const steady = now === first;
    first = now;
    return steady;
  }, { intervals: [2500], timeout: 30000 }).toBe(true);
  // Asking again within the hour doesn't alert the office twice.
  const token = new URL(url).pathname.split('/').pop()!;
  expect((await guest.request.post(`/api/c/${token}/request`, { data: { site_id: c!.site_id } })).ok()).toBe(true);
  await g.waitForTimeout(3000);
  expect(await sent()).toBe(first);
  // Another customer's lot, or a forged link, goes nowhere.
  const [other] = await sql`select s.id from site s where s.customer_id <> ${c!.id} limit 1`;
  expect((await guest.request.post(`/api/c/${token}/request`, { data: { site_id: other!.id } })).status()).toBe(404);
  expect((await guest.request.post('/api/c/nonsense/request', { data: { site_id: c!.site_id } })).status()).toBe(404);
  await guest.close();
});
