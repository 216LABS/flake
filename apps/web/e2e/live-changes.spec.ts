import { expect, test } from '@playwright/test';
import { login, sql, startStorm } from './helpers';

test('a customer calls mid-storm: the office adds their lot to a truck and the driver sees it within seconds', async ({ page, context }) => {
  await login(page);
  const { id, runs } = await startStorm(page.request, `Add stop ${Date.now()}`, ['West Lakewood']);
  const run = runs[0]!;
  const phone = await context.newPage();
  await phone.goto(run.link);
  await expect(phone.getByTestId('next-stop')).toBeVisible();
  const before = run.stops.length;

  // A demo site that isn't on tonight's routes.
  const [extra] = await sql`select s.id, s.label from site s join tenant t on t.id = s.tenant_id where t.slug = 'lakeshore-demo' and s.active and s.id not in (select site_id from run_stop where storm_run_id = ${run.id}) order by s.label limit 1`;
  await page.goto(`/storms/${id}`);
  const column = page.getByTestId('run-column').first();
  await column.getByTestId('add-stop').selectOption(extra!.id as string);
  await expect(column.getByTestId('stop-card')).toHaveCount(before + 1);
  await expect(column.getByTestId('stop-card').last()).toContainText(extra!.label as string);

  // The driver's phone picks it up and says the route changed.
  await expect(phone.getByTestId('other-stop').filter({ hasText: extra!.label as string })).toBeVisible({ timeout: 20000 });
  await expect(phone.getByTestId('stop-n')).toHaveText(new RegExp(`of ${before + 1}$`));

  // Adding it twice is refused with a reason; a closed storm takes no new stops.
  const again = await page.request.post(`/api/runs/${run.id}/stops`, { data: { site_id: extra!.id } });
  expect(again.status()).toBe(409);
  expect((await again.json()).error).toContain('already in this storm');
  expect((await page.request.post('/api/runs/not-a-uuid/stops', { data: { site_id: extra!.id } })).status()).toBe(404);
  const guest = await page.context().browser()!.newContext();
  expect((await guest.request.post(`${new URL(page.url()).origin}/api/runs/${run.id}/stops`, { data: { site_id: extra!.id } })).status()).toBe(401);
  await guest.close();
});

test('the next stop shows how far away it is, and Arrive stays on the first screen', async ({ page, browser, baseURL }) => {
  await login(page);
  const { runs } = await startStorm(page.request, `Distance ${Date.now()}`, ['West Lakewood']);
  const run = runs[0]!;
  const [loc] = await sql`select lat, lon from site where id = ${run.stops[0]!.site_id}`;
  // About 1.1 km north of the first lot.
  const ctx = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, geolocation: { latitude: (loc!.lat as number) + 0.01, longitude: loc!.lon as number }, permissions: ['geolocation'] });
  const phone = await ctx.newPage();
  await phone.goto(run.link);
  await expect(phone.getByTestId('away')).toHaveText(/^0\.[67] mi away$/, { timeout: 30000 });
  const box = await phone.getByTestId('arrive').boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(844);
  await ctx.close();
});
