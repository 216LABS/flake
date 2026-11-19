import { expect, test } from '@playwright/test';
import { login, sql } from './helpers';

test('plan all routes (issue 68): splits one long route across two trucks, saves both at once, refuses a stale plan', async ({ page }) => {
  await login(page);
  const sites = await sql`select s.id from site s join tenant t on t.id = s.tenant_id where t.slug = 'lakeshore-demo' and s.active and s.priority = 3 order by s.lon limit 8`;
  test.skip(sites.length < 8, 'needs eight priority 3 sites in the seed');
  const ids = sites.map((s) => s.id as string);
  const tag = Date.now();
  const a = `Plan A ${tag}`;
  const b = `Plan B ${tag}`;
  expect((await page.request.post('/api/routes', { data: { name: a, site_ids: ids } })).ok()).toBe(true);
  expect((await page.request.post('/api/routes', { data: { name: b, site_ids: [] } })).ok()).toBe(true);
  const order = async (name: string) => (await sql`select rs.site_id from route_stop rs join route r on r.id = rs.route_id where r.name = ${name} order by rs.seq`).map((r) => r.site_id as string);
  try {
    await page.goto('/routes');
    await page.getByTestId('plan-all-link').click();
    await expect(page).toHaveURL(/\/routes\/plan$/);
    // Only the two test routes.
    for (const box of await page.getByTestId('plan-route').all()) {
      const label = (await box.locator('xpath=..').textContent()) ?? '';
      if (label.includes(String(tag)) !== (await box.isChecked())) await box.click();
    }
    if (await page.getByTestId('plan-unrouted').count()) await page.getByTestId('plan-unrouted').uncheck();
    await expect(page.getByTestId('plan-run')).toHaveText('Plan 8 lots across 2 trucks');
    await page.getByTestId('plan-run').click();
    await expect(page.getByTestId('plan-summary')).toContainText('lots change route');
    await expect(page.getByTestId('plan-truck')).toHaveCount(2);
    await expect(page.getByTestId('plan-moved').first()).toBeAttached();
    // Nothing saved yet.
    expect(await order(a)).toEqual(ids);
    expect(await order(b)).toEqual([]);

    await page.getByTestId('plan-accept').click();
    await page.getByTestId('confirm-yes').click();
    await expect(page).toHaveURL(/\/routes$/);
    const na = await order(a);
    const nb = await order(b);
    expect(nb.length).toBeGreaterThan(0);
    expect(na.length).toBeGreaterThan(0);
    expect([...na, ...nb].sort()).toEqual([...ids].sort());

    // A plan made before someone else edits a route is refused, not saved over their edit.
    await page.goto('/routes/plan');
    for (const box of await page.getByTestId('plan-route').all()) {
      const label = (await box.locator('xpath=..').textContent()) ?? '';
      if (label.includes(String(tag)) !== (await box.isChecked())) await box.click();
    }
    if (await page.getByTestId('plan-unrouted').count()) await page.getByTestId('plan-unrouted').uncheck();
    // Move everything back onto A so the planner has something to change.
    const [ra] = await sql`select id from route where name = ${a}`;
    const [rb] = await sql`select id from route where name = ${b}`;
    await page.request.patch(`/api/routes/${ra!.id}`, { data: { site_ids: ids } });
    await page.request.patch(`/api/routes/${rb!.id}`, { data: { site_ids: [] } });
    await page.getByTestId('plan-run').click();
    await expect(page.getByTestId('plan-accept')).toBeVisible();
    await page.request.patch(`/api/routes/${ra!.id}`, { data: { site_ids: ids.slice(0, 7) } });
    await page.getByTestId('plan-accept').click();
    await page.getByTestId('confirm-yes').click();
    await expect(page.getByTestId('plan-error')).toContainText('A route changed after this plan was made');
    expect(await order(a)).toEqual(ids.slice(0, 7));
    expect(await order(b)).toEqual([]);

    // Office staff only.
    const guest = await page.context().browser()!.newContext();
    const origin = new URL(page.url()).origin;
    expect((await guest.request.post(`${origin}/api/routes/plan`, { data: { route_ids: [ra!.id, rb!.id] } })).status()).toBe(401);
    expect((await guest.request.post(`${origin}/api/routes/plan/accept`, { data: { routes: [{ id: ra!.id, site_ids: [], before: [] }] } })).status()).toBe(401);
    await guest.close();
  } finally {
    await sql`delete from route_stop where route_id in (select id from route where name in (${a}, ${b}))`;
    await sql`delete from route where name in (${a}, ${b})`;
  }
});
