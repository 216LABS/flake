import { expect, test, type Page } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { login, startStorm, sql, waitOfflineReady } from './helpers';

const photo = async () => {
  const buffer = await sharp({ create: { width: 2600, height: 1950, channels: 3, background: { r: 140, g: 170, b: 200 } } })
    .withExif({ IFD0: { Make: 'FlakeE2E', Model: `cam-${randomUUID().slice(0, 6)}` } })
    .jpeg({ quality: 85 })
    .toBuffer();
  return { name: 'photo.jpg', mimeType: 'image/jpeg', buffer };
};

async function doStop(page: Page, firstStop: boolean) {
  await page.getByTestId('arrive').click();
  await expect(page.getByTestId('onsite')).toBeVisible();
  await page.getByTestId('before-photo').setInputFiles(await photo());
  await expect(page.getByText('✓ Before photo')).toBeVisible();
  if (firstStop) await page.getByTestId('depth-3').click();
  await page.getByTestId('after-photo').setInputFiles(await photo());
  await expect(page.getByText('✓ After photo')).toBeVisible();
  const before = await page.getByTestId('progress').textContent();
  await page.getByTestId('done').click();
  await expect(page.getByTestId('progress')).not.toHaveText(before!);
}

test('a link revoked while the driver has no signal still delivers the work done before it, and nothing after', async ({ page, context }) => {
  await login(page);
  const { id: stormId, runs } = await startStorm(page.request, `Revoked ${Date.now()}`, ['West Lakewood']);
  const run = runs[0]!;
  await page.goto(run.link);
  await expect(page.getByTestId('next-stop')).toBeVisible();
  await waitOfflineReady(page);

  await context.setOffline(true);
  await doStop(page, true);
  expect((await page.request.post(`/api/runs/${run.id}/revoke`)).ok()).toBe(true);
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));

  await expect.poll(async () => (await sql`select count(*)::int as n from visit_photo p join visit v on v.id = p.visit_id where v.storm_id = ${stormId}`)[0]!.n, { timeout: 60000 }).toBe(2);
  const visits = await sql`select departed_device_at from visit where storm_id = ${stormId}`;
  expect(visits).toHaveLength(1);
  expect(visits[0]!.departed_device_at).toBeTruthy();
  await expect(page.getByTestId('link-dead')).toBeVisible();
  await expect(page.getByTestId('link-dead-body')).toContainText('Ask your dispatcher');

  // The office hears about it.
  await expect.poll(async () => (await sql`select count(*)::int as n from message_log where template = 'owner_alert' and idempotency_key like ${`%late_upload:${run.id}%`}`)[0]!.n, { timeout: 30000 }).toBeGreaterThan(0);

  // A dead link can't add anything new or read the route.
  const token = new URL(run.link).pathname.split('/').pop()!;
  const later = await page.request.post(`/api/d/${token}/actions`, { data: { actions: [{ client_uuid: randomUUID(), at: new Date(Date.now() + 3600000).toISOString(), kind: 'arrive', run_stop_id: run.stops[1]!.id, visit_client_uuid: randomUUID(), gps: null }] } });
  expect((await later.json()).acks[0].status).toBe('rejected');
  expect((await page.request.get(`/api/d/${token}/run`)).status()).toBe(410);
});

test('offline: 3 stops with photos, a reload, then online: everything lands exactly once', async ({ page, context }) => {
  await login(page);
  const { id: stormId, runs } = await startStorm(page.request, `Offline ${Date.now()}`, ['West Lakewood']);
  await page.goto(runs[0]!.link);
  await expect(page.getByTestId('next-stop')).toBeVisible();
  await waitOfflineReady(page);

  await context.setOffline(true);
  await doStop(page, true);
  await expect(page.getByTestId('sync-badge')).toHaveAttribute('data-state', 'saved');
  await doStop(page, false);

  // A reload with no signal must keep the route and everything queued so far.
  await page.reload();
  await expect(page.getByTestId('next-stop')).toBeVisible();
  await expect(page.getByTestId('progress')).toHaveText(`2 of ${runs[0]!.stops.length} done`);
  await expect(page.getByTestId('sync-badge')).toHaveAttribute('data-state', 'saved');
  await doStop(page, false);
  await page.reload();
  await expect(page.getByTestId('progress')).toHaveText(`3 of ${runs[0]!.stops.length} done`);

  const before = await sql`select count(*)::int as n from visit where storm_id = ${stormId}`;
  expect(before[0]!.n).toBe(0);

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByTestId('sync-badge')).toHaveAttribute('data-state', 'synced', { timeout: 60000 });

  const check = async () => {
    const visits = await sql`select id, departed_device_at, depth_in from visit where storm_id = ${stormId}`;
    const photos = await sql`select p.phase, p.width, p.exif from visit_photo p join visit v on v.id = p.visit_id where v.storm_id = ${stormId}`;
    expect(visits).toHaveLength(3);
    expect(visits.every((v) => v.departed_device_at)).toBe(true);
    expect(photos).toHaveLength(6);
    expect(photos.filter((p) => p.phase === 'before')).toHaveLength(3);
    expect(photos.every((p) => (p.width as number) >= 2048)).toBe(true);
    expect(photos.every((p) => (p.exif as { Make?: string }).Make === 'FlakeE2E')).toBe(true);
  };
  await check();

  // Reloading and syncing again changes nothing.
  await page.reload();
  await expect(page.getByTestId('sync-badge')).toHaveAttribute('data-state', 'synced');
  await page.waitForTimeout(1000);
  await check();
});

test('tap targets are at least 60 px, and a stop takes 5 taps or fewer plus 2 photos', async ({ page }) => {
  await login(page);
  const { runs } = await startStorm(page.request, `Targets ${Date.now()}`, ['Rocky River']);
  await page.goto(runs[0]!.link);
  await expect(page.getByTestId('next-stop')).toBeVisible();

  const assertTargets = async () => {
    const small = await page.evaluate(() =>
      [...document.querySelectorAll('button, label, a')]
        .filter((el) => (el as HTMLElement).offsetParent !== null)
        .map((el) => ({ text: el.textContent?.slice(0, 30), box: el.getBoundingClientRect() }))
        .filter(({ box }) => box.height < 60 || box.width < 60)
        .map(({ text, box }) => `${text}: ${Math.round(box.width)}x${Math.round(box.height)}`),
    );
    expect(small).toEqual([]);
  };
  await assertTargets();

  let taps = 0;
  const tap = async (id: string) => {
    taps++;
    await page.getByTestId(id).click();
  };
  await tap('arrive');
  await expect(page.getByTestId('onsite')).toBeVisible();
  await assertTargets();
  await page.getByTestId('before-photo').setInputFiles(await photo());
  taps++;
  await tap('depth-3');
  await page.getByTestId('after-photo').setInputFiles(await photo());
  taps++;
  await tap('done');
  await expect(page.getByTestId('progress')).toContainText('1 of');
  expect(taps).toBeLessThanOrEqual(5);
  await assertTargets();
});

test('Done is blocked until depth on the first stop, and Undo reopens the stop', async ({ page }) => {
  await login(page);
  const { runs } = await startStorm(page.request, `Depth ${Date.now()}`, ['Rocky River']);
  await page.goto(runs[0]!.link);
  // The office chose English for this driver, so there's no language button to get in the way.
  await expect(page.getByTestId('arrive')).toHaveText('Arrive');
  await expect(page.getByTestId('lang')).toHaveCount(0);
  await expect(page.getByTestId('stop-n')).toHaveText(/^Stop 1 of \d+$/);
  const label = await page.getByTestId('stop-label').textContent();
  await page.getByTestId('arrive').click();
  await expect(page.getByTestId('done')).toBeDisabled();
  await page.getByTestId('depth-2').click();
  await expect(page.getByTestId('done')).toBeEnabled();
  await page.getByTestId('done').click();
  await expect(page.getByTestId('undo')).toBeVisible();
  await page.getByTestId('undo').click();
  await expect(page.getByTestId('stop-label')).toHaveText(label!);
});

test('a revoked link shows the friendly screen, not an error', async ({ page, request }) => {
  await login(page);
  const { runs } = await startStorm(page.request, `Revoke ${Date.now()}`, ['Rocky River']);
  const revoked = await page.request.post(`/api/runs/${runs[0]!.id}/revoke`);
  expect(revoked.ok()).toBe(true);
  void request;
  await page.goto(runs[0]!.link);
  await expect(page.getByTestId('link-dead')).toContainText('Ask your dispatcher for a new link');
});

test('the phone keeps the original image bytes through upload', async ({ page }) => {
  await login(page);
  const { id: stormId, runs } = await startStorm(page.request, `Bytes ${Date.now()}`, ['Rocky River']);
  await page.goto(runs[0]!.link);
  await page.getByTestId('arrive').click();
  const file = await photo();
  await page.getByTestId('before-photo').setInputFiles(file);
  const want = createHash('sha256').update(file.buffer).digest('hex');
  await expect.poll(async () => (await sql`select p.sha256 from visit_photo p join visit v on v.id = p.visit_id where v.storm_id = ${stormId}`)[0]?.sha256, { timeout: 30000 }).toBe(want);
});

test('a full-size phone photo over the host body limit goes straight to storage and still lands once, intact', async ({ page }) => {
  await login(page);
  const { id: stormId, runs } = await startStorm(page.request, `Big photo ${Date.now()}`, ['Rocky River']);
  await page.goto(runs[0]!.link);
  await page.getByTestId('arrive').click();
  // Random noise does not compress, so this is the size of a real 12 MP+ phone photo.
  const { randomBytes } = await import('node:crypto');
  const buffer = await sharp(randomBytes(2400 * 1800 * 3), { raw: { width: 2400, height: 1800, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
  expect(buffer.length).toBeGreaterThan(3.5 * 1024 * 1024);
  const used: string[] = [];
  page.on('request', (r) => { if (/\/photos(\/sign|\/finish)?$/.test(new URL(r.url()).pathname)) used.push(new URL(r.url()).pathname.split('/').pop()!); });
  await page.getByTestId('before-photo').setInputFiles({ name: 'big.jpg', mimeType: 'image/jpeg', buffer });
  const want = createHash('sha256').update(buffer).digest('hex');
  await expect.poll(async () => (await sql`select p.sha256 from visit_photo p join visit v on v.id = p.visit_id where v.storm_id = ${stormId}`).map((r) => r.sha256), { timeout: 60000 }).toEqual([want]);
  expect(used).toContain('sign');
  expect(used).toContain('finish');
  expect(used).not.toContain('photos');
});
