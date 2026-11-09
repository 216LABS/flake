import { expect, test } from '@playwright/test';
import { login, sql } from './helpers';

test('suggest order: shows a shorter order with times, saves only when accepted, and is stable when asked again', async ({ page }) => {
  await login(page);
  // Five sites of one priority, put in a zigzag west-east order on purpose.
  const sites = await sql`select s.id from site s join tenant t on t.id = s.tenant_id where t.slug = 'lakeshore-demo' and s.active and s.priority = 3 order by s.lon limit 5`;
  test.skip(sites.length < 5, 'needs five priority 3 sites in the seed');
  const zig = [0, 4, 1, 3, 2].map((i) => sites[i]!.id);
  const name = `Order test ${Date.now()}`;
  const made = await page.request.post('/api/routes', { data: { name, site_ids: zig } });
  expect(made.ok(), await made.text()).toBe(true);
  // A driverless route would stop other tests' storms from publishing, so it never outlives this test.
  try {
    await page.goto('/routes');
    const card = page.getByTestId('route-card').filter({ has: page.getByLabel(`Add a site to ${name}`) });
    await card.getByTestId('suggest-open').click();
    const panel = card.getByTestId('suggest-panel');
    await expect(panel.getByTestId('suggest-summary')).toContainText('Saves about');
    await expect(panel.getByTestId('suggest-list').getByRole('listitem')).toHaveCount(5);
    await expect(panel.getByTestId('suggest-list')).toContainText('4:00 AM');

    // Nothing is saved yet.
    const order = async () => (await sql`select rs.site_id from route_stop rs join route r on r.id = rs.route_id where r.name = ${name} order by rs.seq`).map((r) => r.site_id);
    expect(await order()).toEqual(zig);

    // A later start moves the times; then accept.
    await panel.getByLabel('First stop at').fill('05:30');
    await expect(panel.getByTestId('suggest-list')).toContainText('5:30 AM');
    await panel.getByTestId('suggest-accept').click();
    await expect(panel).toHaveCount(0);
    await expect.poll(order).not.toEqual(zig);
    expect(new Set(await order())).toEqual(new Set(zig));

    // Asked again, it leaves the order alone.
    await card.getByTestId('suggest-open').click();
    await expect(card.getByTestId('suggest-summary')).toHaveText('This order is already about as short as it gets.');
    await expect(card.getByTestId('suggest-accept')).toHaveCount(0);

    // Only office staff can ask.
    const [r] = await sql`select id from route where name = ${name}`;
    const guest = await page.context().browser()!.newContext();
    expect((await guest.request.post(`${new URL(page.url()).origin}/api/routes/${r!.id}/suggest`, { data: { site_ids: zig } })).status()).toBe(401);
    await guest.close();
  } finally {
    await sql`delete from route_stop where route_id in (select id from route where name = ${name})`;
    await sql`delete from route where name = ${name}`;
  }
});
