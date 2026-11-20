import { expect, test } from '@playwright/test';
import { login, sql, startStorm } from './helpers';

/**
 * Issue 184: a real driver's visit carried the spot where they got the link, not the lot. The phone's last fix was
 * reused after the driver came back from the maps app. A visit now gets a fresh position or none, never an old one.
 */
test.describe('issue 184: visit GPS is current or not recorded', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'geolocation permissions are emulated in Chromium');

  test('an old position from the dispatch yard is never stamped on the arrival', async ({ page, browser, baseURL }) => {
    await login(page);
    const { runs } = await startStorm(page.request, `GPS old ${Date.now()}`, ['Rocky River']);
    const run = runs[0]!;
    const stop = run.stops[0]!;
    const [lot] = await sql`select lat, lon from site where id = ${stop.site_id}`;
    // The yard, about 5 km from the lot.
    const yard = { latitude: (lot!.lat as number) + 0.045, longitude: lot!.lon as number };
    const ctx = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, geolocation: yard, permissions: ['geolocation'] });
    const phone = await ctx.newPage();
    await phone.clock.install();
    try {
      await phone.goto(run.link);
      await expect(phone.getByTestId('next-stop')).toBeVisible();
      await expect(phone.getByTestId('away')).toBeVisible({ timeout: 15000 });
      // A minute in the maps app, and the phone no longer gives a position.
      await phone.clock.fastForward('01:00');
      await ctx.clearPermissions();
      await phone.getByTestId('arrive').click();
      await expect(phone.getByTestId('onsite')).toBeVisible({ timeout: 15000 });
      await expect.poll(async () => (await sql`select count(*)::int n from visit where run_stop_id = ${stop.id}`)[0]!.n, { timeout: 20000 }).toBe(1);
      const [v] = await sql`select arrive_lat, arrive_lon from visit where run_stop_id = ${stop.id}`;
      expect(v).toEqual({ arrive_lat: null, arrive_lon: null });
    } finally {
      await ctx.close();
    }
  });

  test('back at the lot, the arrival records the lot, not the yard', async ({ page, browser, baseURL }) => {
    await login(page);
    const { runs } = await startStorm(page.request, `GPS new ${Date.now()}`, ['Rocky River']);
    const run = runs[0]!;
    const stop = run.stops[0]!;
    const [lot] = await sql`select lat, lon from site where id = ${stop.site_id}`;
    const yard = { latitude: (lot!.lat as number) + 0.045, longitude: lot!.lon as number };
    const ctx = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, geolocation: yard, permissions: ['geolocation'] });
    const phone = await ctx.newPage();
    await phone.clock.install();
    try {
      await phone.goto(run.link);
      await expect(phone.getByTestId('away')).toBeVisible({ timeout: 15000 });
      await phone.clock.fastForward('01:00');
      await ctx.setGeolocation({ latitude: lot!.lat as number, longitude: lot!.lon as number });
      await phone.getByTestId('arrive').click();
      await expect(phone.getByTestId('onsite')).toBeVisible({ timeout: 15000 });
      await expect.poll(async () => (await sql`select arrive_lat from visit where run_stop_id = ${stop.id}`)[0]?.arrive_lat ?? null, { timeout: 20000 }).not.toBeNull();
      const [v] = await sql`select arrive_lat, arrive_lon, gps_match from visit where run_stop_id = ${stop.id}`;
      expect(Math.abs((v!.arrive_lat as number) - (lot!.lat as number))).toBeLessThan(0.001);
      expect(v!.gps_match).toBe(true);
    } finally {
      await ctx.close();
    }
  });
});
