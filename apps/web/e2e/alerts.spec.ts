import { expect, test } from '@playwright/test';
import { login, sql } from './helpers';

test('an alert can be dismissed from its page, once, and one that started a storm stays as it is', async ({ page }) => {
  await login(page);
  const [t] = await sql`select id from tenant where slug = 'lakeshore-demo'`;
  const sites = await sql`select id from site where tenant_id = ${t!.id} and active limit 2`;
  const [open] = await sql`insert into trigger_alert (tenant_id, kind, site_ids, detail) values (${t!.id}, 'forecast', ${sql.array(sites.map((s) => s.id))}::uuid[], ${sql.json({ max_in: 3.1, note: 'Dismiss test' })}) returning id`;
  const [used] = await sql`insert into trigger_alert (tenant_id, kind, site_ids, detail, status) values (${t!.id}, 'forecast', ${sql.array(sites.map((s) => s.id))}::uuid[], ${sql.json({ max_in: 2 })}, 'dispatched') returning id`;

  await page.goto(`/alerts/${open!.id}`);
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await page.waitForURL(/\/dashboard/);
  const status = async (id: string) => (await sql`select status from trigger_alert where id = ${id}`)[0]!.status;
  expect(await status(open!.id)).toBe('dismissed');

  // Twice is harmless; a dispatched alert refuses; nonsense ids are not found rather than a crash.
  expect((await page.request.patch(`/api/alerts/${open!.id}`, { data: { status: 'dismissed' } })).status()).toBe(200);
  expect((await page.request.patch(`/api/alerts/${used!.id}`, { data: { status: 'dismissed' } })).status()).toBe(409);
  expect(await status(used!.id)).toBe('dispatched');
  expect((await page.request.patch('/api/alerts/not-a-uuid', { data: { status: 'dismissed' } })).status()).toBe(404);
  expect((await page.request.patch('/api/alerts/00000000-0000-4000-8000-000000000000', { data: { status: 'dismissed' } })).status()).toBe(404);
  await sql`delete from trigger_alert where id in ${sql([open!.id, used!.id])}`;
});
