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

test('Done is blocked until depth on the first stop, Spanish works, and Undo reopens the stop', async ({ page }) => {
  await login(page);
  const { runs } = await startStorm(page.request, `Depth ${Date.now()}`, ['Rocky River']);
  await page.goto(runs[0]!.link);
  await page.getByTestId('lang').click();
  await expect(page.getByTestId('arrive')).toHaveText('Llegué');
  await page.getByTestId('lang').click();
  await expect(page.getByTestId('arrive')).toHaveText('Arrive');
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
