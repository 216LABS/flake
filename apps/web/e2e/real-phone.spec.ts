import { expect, test } from '@playwright/test';
import { closeRunningStorms, login, sql, startStorm } from './helpers';

/**
 * What a real phone does that the other driver tests don't: location turned on partway through a route, and a page left
 * open since before a fix went out (found walking the app after issue 184).
 */
test.describe('real phone conditions', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'geolocation permissions are emulated in Chromium');
  test.afterAll(async () => closeRunningStorms());

  test('location allowed partway through: the first visit has none, the next has the lot', async ({ page, browser, baseURL }) => {
    await login(page);
    const { runs } = await startStorm(page.request, `Real phone ${Date.now()}`, ['Rocky River']);
    const run = runs[0]!;
    const [s1, s2] = run.stops as { id: string; site_id: string }[];
    const sites = await sql`select id, lat, lon from site where id in ${sql([s1!.site_id, s2!.site_id])}`;
    const lot = (id: string) => sites.find((s) => s.id === id)!;
    const ctx = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
    const phone = await ctx.newPage();
    try {
      await phone.goto(run.link);
      await expect(phone.getByTestId('next-stop')).toBeVisible();
      // Not allowed yet: the arrival goes through at once, with no location rather than a guess.
      await phone.getByTestId('arrive').click();
      await expect(phone.getByTestId('onsite')).toBeVisible({ timeout: 15000 });
      await phone.getByTestId('depth-2').click();
      await phone.getByTestId('done').click();
      await expect.poll(async () => (await sql`select count(*)::int n from visit where run_stop_id = ${s1!.id} and departed_device_at is not null`)[0]!.n, { timeout: 20000 }).toBe(1);
      const [v1] = await sql`select arrive_lat, gps_match from visit where run_stop_id = ${s1!.id}`;
      expect(v1).toEqual({ arrive_lat: null, gps_match: false });

      // The driver turns location on and drives to the next lot.
      const next = lot(s2!.site_id);
      await ctx.setGeolocation({ latitude: next.lat as number, longitude: next.lon as number });
      await ctx.grantPermissions(['geolocation']);
      await expect(phone.getByTestId('location-off')).toBeHidden();
      await phone.getByTestId('arrive').click();
      await expect(phone.getByTestId('onsite')).toBeVisible({ timeout: 15000 });
      await expect.poll(async () => (await sql`select gps_match from visit where run_stop_id = ${s2!.id}`)[0]?.gps_match ?? null, { timeout: 20000 }).toBe(true);
    } finally {
      await ctx.close();
    }
  });

  test('no fix at Arrive but one at Done: the office sees where the phone was at Done', async ({ page, browser, baseURL }) => {
    await login(page);
    const { runs } = await startStorm(page.request, `Done GPS ${Date.now()}`, ['Rocky River']);
    const run = runs[0]!;
    const stop = run.stops[0]!;
    const [lot] = await sql`select lat, lon from site where id = ${stop.site_id}`;
    const ctx = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
    const phone = await ctx.newPage();
    try {
      await phone.goto(run.link);
      await phone.getByTestId('arrive').click();
      await expect(phone.getByTestId('onsite')).toBeVisible({ timeout: 15000 });
      await ctx.setGeolocation({ latitude: lot!.lat as number, longitude: lot!.lon as number });
      await ctx.grantPermissions(['geolocation']);
      await phone.getByTestId('depth-2').click();
      await phone.getByTestId('done').click();
      await expect.poll(async () => (await sql`select depart_lat from visit where run_stop_id = ${stop.id}`)[0]?.depart_lat ?? null, { timeout: 20000 }).not.toBeNull();
      const detail = await (await page.request.get(`/api/run-stops/${stop.id}`)).json();
      expect(detail.visits[0].gps).toBeNull();
      expect(detail.visits[0].done_gps.matched).toBe(true);
    } finally {
      await ctx.close();
    }
  });

  test('a re-plan starts from the lot just finished, not a truck report from before it', async ({ page }) => {
    await login(page);
    const { runs } = await startStorm(page.request, `Replan stale ${Date.now()}`, ['West Lakewood']);
    const run = runs[0]!;
    const stops = await sql`select rs.id, s.lat, s.lon from run_stop rs join site s on s.id = rs.site_id where rs.storm_run_id = ${run.id} order by rs.seq`;
    const [tenant] = await sql`select tenant_id from storm_run where id = ${run.id}`;
    // The phone last reported an hour ago, from the yard; since then the first lot was finished.
    await sql`insert into driver_position (tenant_id, storm_run_id, lat, lon, acc_m, device_at) values (${tenant!.tenant_id}, ${run.id}, ${(stops[0]!.lat as number) + 0.05}, ${stops[0]!.lon}, 10, now() - interval '1 hour')`;
    await sql`update run_stop set status = 'done', updated_at = now() where id = ${stops[0]!.id}`;
    const plan = await (await page.request.get(`/api/runs/${run.id}/plan`)).json();
    expect(plan.from).toBe('last_done');
    // A newer report than the finished lot is still used.
    await sql`insert into driver_position (tenant_id, storm_run_id, lat, lon, acc_m, device_at) values (${tenant!.tenant_id}, ${run.id}, ${stops[1]!.lat}, ${stops[1]!.lon}, 10, now() + interval '1 minute')`;
    expect((await (await page.request.get(`/api/runs/${run.id}/plan`)).json()).from).toBe('truck');
  });

  test('a page open since before a new version reloads when the driver comes back, but never mid-visit', async ({ page, browser, baseURL }) => {
    await login(page);
    const { runs } = await startStorm(page.request, `New version ${Date.now()}`, ['Rocky River']);
    const run = runs[0]!;
    const ctx = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
    const phone = await ctx.newPage();
    try {
      await phone.goto(run.link);
      await expect(phone.getByTestId('next-stop')).toBeVisible();
      // A deploy happens: the server now reports a different version than the page was built with.
      await phone.route('**/api/d/*/run', async (r) => {
        const res = await r.fetch();
        await r.fulfill({ response: res, json: { ...(await res.json()), build: 'newer' } });
      });
      const back = () => phone.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      // On site, back from the camera: no reload, the visit stays put.
      await phone.getByTestId('arrive').click();
      await expect(phone.getByTestId('onsite')).toBeVisible({ timeout: 15000 });
      await expect.poll(async () => phone.evaluate(() => fetch(location.pathname.replace('/d/', '/api/d/') + '/run').then((r) => r.json()).then((j) => j.build)), { timeout: 15000 }).toBe('newer');
      await phone.waitForTimeout(9000); // the 8 s poll picks up the new version
      await phone.evaluate(() => ((window as unknown as { marker: number }).marker = 1));
      await back();
      await phone.waitForTimeout(1000);
      expect(await phone.evaluate(() => (window as unknown as { marker?: number }).marker)).toBe(1);
      // Done, then back from the maps app: the page reloads to the new version and shows the next stop.
      await phone.getByTestId('depth-2').click();
      await phone.getByTestId('done').click();
      await expect(phone.getByTestId('next-stop')).toBeVisible({ timeout: 15000 });
      await phone.waitForTimeout(500);
      const reloaded = phone.waitForEvent('load');
      await back();
      await reloaded;
      expect(await phone.evaluate(() => (window as unknown as { marker?: number }).marker)).toBeUndefined();
      await expect(phone.getByTestId('next-stop')).toBeVisible({ timeout: 15000 });
    } finally {
      await ctx.close();
    }
  });
});
