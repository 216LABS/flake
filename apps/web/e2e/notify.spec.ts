import { expect, test } from '@playwright/test';
import { closeRunningStorms, login, sql, startStorm } from './helpers';

/** "Notify customers" says who it couldn't reach, instead of "sending" to someone who gets nothing. */
test('notifying customers names the ones with no texts or email turned on', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const { id, runs } = await startStorm(page.request, `Notify ${Date.now()}`, ['West Lakewood']);
  const [a, b] = runs[0]!.stops;
  const cust = async (siteId: string) => (await sql`select customer_id from site where id = ${siteId}`)[0]!.customer_id as string;
  const [ca, cb] = [await cust(a!.site_id), await cust(b!.site_id)];
  const before = await sql`select id, email, notify_email, notify_sms from customer where id in (${ca}, ${cb})`;
  await sql`update customer set email = 'reach-me@example.com', notify_email = true where id = ${ca}`;
  await sql`update customer set notify_email = false, notify_sms = false where id = ${cb}`;

  const res = await page.request.post(`/api/storms/${id}/notify`, { data: { siteIds: [a!.site_id, b!.site_id], template: 'on_the_way' } });
  expect(await res.json()).toEqual({ queued: 1, unreachable: [b!.label] });

  // On the board: picking only the customer nobody can reach says so plainly.
  await page.goto(`/storms/${id}`);
  await page.getByTestId('notify-open').click();
  const panel = page.getByTestId('notify-panel');
  await panel.getByTestId('notify-template').selectOption('on_the_way');
  for (const box of await panel.locator('input[type="checkbox"]').all()) await box.uncheck();
  await panel.getByLabel(b!.label, { exact: true }).check();
  await panel.getByTestId('notify-send').click();
  await expect(page.getByTestId('board-notice')).toHaveText(`Nobody was sent this. Not sent to ${b!.label}: no texts or email turned on for that customer.`);
  await closeRunningStorms();
  for (const r of before) await sql`update customer set email = ${r.email}, notify_email = ${r.notify_email}, notify_sms = ${r.notify_sms} where id = ${r.id}`;
});
